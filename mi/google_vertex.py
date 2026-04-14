"""Google Vertex AI provider for chat models.

Supports TWO authentication modes:
  1. Service account JSON (file path or inline) — full Vertex AI access, needs project_id
  2. Vertex AI Express API key (starts with "AQ.") — simpler, no project_id required

Register a model with:
  provider: "google_vertex"
  model_name: "gemini-2.5-flash" (or any Vertex AI model)
  api_key: path/inline service account JSON OR Vertex Express API key (AQ.*)
  provider_config: {
    "project_id": "your-gcp-project",     # required for service account auth
    "location": "us-central1"
  }
"""

import json
import logging
import os
import tempfile
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.providers.base import BaseProvider, register_provider

logger = logging.getLogger(__name__)


def _is_express_api_key(value: str) -> bool:
    """Detect Vertex AI Express API key (e.g. 'AQ.Ab8RN6IC...')."""
    if not value:
        return False
    v = value.strip()
    # Express keys are ~40+ chars, start with 'AQ.' and are NOT JSON nor file paths
    return v.startswith("AQ.") and not v.startswith("{") and not os.path.exists(v)


class _VertexExpressChatModel(BaseChatModel):
    """Minimal BaseChatModel wrapper using google-genai SDK with vertexai=True + api_key.

    Used when the user provides a Vertex AI Express API key instead of a service account.
    Avoids the service-account-only limitation of langchain-google-vertexai.ChatVertexAI.
    """

    model: str
    api_key: str
    temperature: float | None = None
    max_output_tokens: int | None = None
    top_p: float | None = None
    top_k: int | None = None

    @property
    def _llm_type(self) -> str:
        return "google-vertex-express"

    def _convert_messages(self, messages):
        from google.genai import types
        contents = []
        system_text = ""
        for msg in messages:
            text = msg.content if isinstance(msg.content, str) else str(msg.content)
            if isinstance(msg, SystemMessage):
                system_text += text + "\n"
            elif isinstance(msg, HumanMessage):
                role = "user"
                if system_text:
                    text = f"SYSTEM INSTRUCTIONS:\n{system_text}\n\n{text}"
                    system_text = ""
                contents.append(types.Content(role=role, parts=[types.Part(text=text)]))
            elif isinstance(msg, AIMessage):
                contents.append(types.Content(role="model", parts=[types.Part(text=text)]))
        return contents

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        from google import genai
        from google.genai import types

        client = genai.Client(vertexai=True, api_key=self.api_key)
        config = types.GenerateContentConfig(
            temperature=self.temperature if self.temperature is not None else 1.0,
            top_p=self.top_p if self.top_p is not None else 0.95,
            max_output_tokens=self.max_output_tokens or 8192,
        )
        response = client.models.generate_content(
            model=self.model,
            contents=self._convert_messages(messages),
            config=config,
        )
        text = response.text or ""
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        # google-genai SDK is sync; run in a thread
        import asyncio
        return await asyncio.to_thread(self._generate, messages, stop, run_manager, **kwargs)


def _resolve_credentials(api_key_or_path: str):
    """Resolve service account credentials from path or inline JSON."""
    from google.oauth2 import service_account

    sa_path = api_key_or_path
    temp_file = None

    # If api_key is inline JSON, write to temp file
    if api_key_or_path.strip().startswith("{"):
        try:
            sa_data = json.loads(api_key_or_path)
            temp_file = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
            json.dump(sa_data, temp_file)
            temp_file.close()
            sa_path = temp_file.name
        except json.JSONDecodeError:
            pass

    if not os.path.exists(sa_path):
        raise ValueError(f"Service account file not found: {sa_path}")

    credentials = service_account.Credentials.from_service_account_file(
        sa_path,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )

    # Clean up temp file
    if temp_file:
        try:
            os.unlink(temp_file.name)
        except OSError:
            pass

    return credentials


@register_provider("google_vertex")
class GoogleVertexProvider(BaseProvider):
    """Google Vertex AI provider using service account authentication."""

    async def list_models(self, provider_config: dict[str, Any]) -> list[str]:
        """Return commonly available Vertex AI Gemini models."""
        return [
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.0-flash",
            "gemini-1.5-pro",
            "gemini-1.5-flash",
            "gemini-2.5-flash-image",
        ]

    def build_model(
        self,
        model: str,
        provider_config: dict[str, Any],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        top_k: int | None = None,
        n: int | None = None,
        streaming: bool = False,
        seed: int | None = None,
        json_mode: bool = False,
        model_kwargs: dict[str, Any] | None = None,
    ) -> BaseChatModel:
        api_key = provider_config.get("api_key", "")
        project_id = provider_config.get("project_id", "")
        location = provider_config.get("location", "us-central1")

        # Mode 1: Vertex AI Express API key (e.g. "AQ.Ab8RN6IC...") — no project_id needed
        if _is_express_api_key(api_key):
            logger.info("Using Vertex AI Express API key auth for model=%s", model)
            return _VertexExpressChatModel(
                model=model,
                api_key=api_key,
                temperature=temperature,
                max_output_tokens=max_tokens,
                top_p=top_p,
                top_k=top_k,
            )

        # Mode 2: Service account JSON — requires project_id
        from langchain_google_vertexai import ChatVertexAI

        if not project_id:
            raise ValueError(
                "provider_config.project_id is required for Vertex AI service account auth. "
                "Or use a Vertex AI Express API key (starts with 'AQ.')."
            )

        kwargs: dict[str, Any] = {
            "model_name": model,
            "project": project_id,
            "location": location,
            "streaming": streaming,
        }

        if api_key:
            credentials = _resolve_credentials(api_key)
            kwargs["credentials"] = credentials

        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_tokens:
            kwargs["max_output_tokens"] = max_tokens
        if top_p is not None:
            kwargs["top_p"] = top_p
        if top_k is not None:
            kwargs["top_k"] = top_k
        if model_kwargs:
            kwargs["model_kwargs"] = model_kwargs

        return ChatVertexAI(**kwargs)
