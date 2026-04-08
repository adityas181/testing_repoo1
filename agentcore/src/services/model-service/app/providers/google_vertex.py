"""Google Vertex AI provider for chat models.

Uses service account authentication (not API key) for Vertex AI hosted Gemini models.
This is separate from the 'google' provider which uses Google AI Studio (API key auth).

Register a model with:
  provider: "google_vertex"
  model_name: "gemini-2.5-flash" (or any Vertex AI model)
  api_key: path to service account JSON file OR inline JSON content
  provider_config: {
    "project_id": "your-gcp-project",
    "location": "us-central1"
  }
"""

import json
import logging
import os
import tempfile
from typing import Any

from langchain_core.language_models import BaseChatModel

from app.providers.base import BaseProvider, register_provider

logger = logging.getLogger(__name__)


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
        from langchain_google_vertexai import ChatVertexAI

        api_key = provider_config.get("api_key", "")
        project_id = provider_config.get("project_id", "")
        location = provider_config.get("location", "us-central1")

        if not project_id:
            raise ValueError("provider_config.project_id is required for Vertex AI")

        kwargs: dict[str, Any] = {
            "model_name": model,
            "project": project_id,
            "location": location,
            "streaming": streaming,
        }

        # Resolve service account credentials
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
