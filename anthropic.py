import logging
from functools import cached_property
from typing import Any

import anthropic
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models import BaseChatModel

from app.providers.base import BaseProvider, register_provider

logger = logging.getLogger(__name__)


def _is_azure_foundry_url(url: str | None) -> bool:
    """Azure AI Foundry hosts Claude at *.services.ai.azure.com/anthropic."""
    return bool(url) and "services.ai.azure.com" in url


class _ChatAnthropicFoundry(ChatAnthropic):
    """ChatAnthropic that routes through anthropic.AnthropicFoundry.

    Azure AI Foundry speaks an Anthropic-compatible API but expects the
    `api-key` header (not `x-api-key`) and its URL path joins differently.
    Swapping the underlying client is enough — request/response shapes match.
    """

    @cached_property
    def _client(self) -> anthropic.Client:
        base_url = self.anthropic_api_url
        if base_url and not base_url.endswith("/"):
            base_url = base_url + "/"
        return anthropic.AnthropicFoundry(
            api_key=self.anthropic_api_key.get_secret_value(),
            base_url=base_url,
            max_retries=self.max_retries,
        )

    @cached_property
    def _async_client(self) -> anthropic.AsyncClient:
        base_url = self.anthropic_api_url
        if base_url and not base_url.endswith("/"):
            base_url = base_url + "/"
        return anthropic.AsyncAnthropicFoundry(
            api_key=self.anthropic_api_key.get_secret_value(),
            base_url=base_url,
            max_retries=self.max_retries,
        )

# Anthropic doesn't have a public list-models API; maintain a static list.
_ANTHROPIC_MODELS = [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
]


@register_provider("anthropic")
class AnthropicProvider(BaseProvider):
    """Anthropic Claude provider (native). Does not support embeddings."""

    async def list_models(self, provider_config: dict[str, Any]) -> list[str]:
        return list(_ANTHROPIC_MODELS)

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
        base_url = provider_config.get("base_url")

        kwargs: dict[str, Any] = {
            "model": model,
            "api_key": api_key,
            "streaming": streaming,
            # Anthropic requires max_tokens — default to 4096 if not set
            "max_tokens": max_tokens or 4096,
        }

        if base_url:
            kwargs["base_url"] = base_url
        if temperature is not None:
            kwargs["temperature"] = temperature
        if top_p is not None:
            kwargs["top_p"] = top_p
        if top_k is not None:
            kwargs["top_k"] = top_k

        # Extract Anthropic-specific reasoning param (extended thinking)
        # thinking must be a top-level ChatAnthropic parameter, not inside model_kwargs.
        if model_kwargs:
            extracted = dict(model_kwargs)
            thinking = extracted.pop("thinking", None)
            # Drop unrelated params meant for other providers
            extracted.pop("thinking_config", None)
            if thinking:
                kwargs["thinking"] = thinking
                # Anthropic requires temperature=1 when extended thinking is enabled
                kwargs["temperature"] = 1
                # max_tokens must be greater than budget_tokens
                budget = thinking.get("budget_tokens", 0) if isinstance(thinking, dict) else 0
                if budget and kwargs["max_tokens"] <= budget:
                    kwargs["max_tokens"] = budget + 4096
            if extracted:
                kwargs["model_kwargs"] = extracted

        if _is_azure_foundry_url(base_url):
            return _ChatAnthropicFoundry(**kwargs)
        return ChatAnthropic(**kwargs)
