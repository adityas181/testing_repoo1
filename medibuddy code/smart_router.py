"""Smart Router — auto-selects the best model for a query.

When user selects "Smart Router" from the dropdown, this service
analyzes the query and picks the most suitable model from the registry.

Uses the same LLM as the intent classifier (INTENT_CLASSIFIER_MODEL_NAME + LTM API key).
Reads available models dynamically from the model registry.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


async def _get_available_models() -> list[dict]:
    """Get chat models from registry for routing decisions."""
    from agentcore.services.model_service_client import fetch_registry_models_async
    from agentcore.services.mibuddy.model_capabilities import detect_capabilities

    try:
        all_models = await fetch_registry_models_async(model_type="llm", active_only=True)
    except Exception:
        return []

    models = []
    for m in all_models:
        approval = str(m.get("approval_status", "approved")).lower()
        if approval != "approved":
            continue

        provider = m.get("provider", "")
        model_name = m.get("model_name", "")
        display_name = m.get("display_name", model_name)
        caps = detect_capabilities(provider, model_name, m.get("capabilities"))

        # Skip image-only and web-search-only models
        if caps.get("image_generation") and not caps.get("supports_tool_calling"):
            continue

        models.append({
            "id": str(m.get("id", "")),
            "display_name": display_name,
            "model_name": model_name,
            "provider": provider,
            "reasoning": caps.get("reasoning", False),
            "vision": caps.get("supports_vision", False),
            "tool_calling": caps.get("supports_tool_calling", False),
        })

    return models


def _build_routing_prompt(query: str, models: list[dict]) -> str:
    """Build the routing prompt with available models."""
    model_descriptions = []
    for i, m in enumerate(models, 1):
        traits = []
        if m.get("reasoning"):
            traits.append("reasoning/thinking")
        if m.get("vision"):
            traits.append("vision")
        if m.get("tool_calling"):
            traits.append("tool calling")
        traits_str = f" ({', '.join(traits)})" if traits else ""
        model_descriptions.append(f"{i}. **{m['display_name']}**{traits_str}")

    models_list = "\n".join(model_descriptions)
    model_names = ", ".join(f'"{m["display_name"]}"' for m in models)

    return f"""You are an intelligent LLM router. Pick the best model for the user's query.

### Available Models:
{models_list}

### Routing Rules:
- For complex reasoning, math, multi-step logic → pick a model with reasoning capability
- For general chat, greetings, simple questions → pick the fastest/simplest model
- For coding, technical queries → pick a model with tool calling
- For image analysis questions → pick a model with vision
- For follow-up questions → pick the same type of model as the previous answer would use

### User Query: "{query}"

Respond with ONLY a JSON object: {{"model": "<model display name>"}}
Choose from: {model_names}
Do not include any explanation."""


async def route_to_best_model(query: str) -> tuple[str, str] | None:
    """Analyze query and pick the best model from registry.

    Returns (model_id, display_name) or None if routing fails.
    """
    from agentcore.services.deps import get_settings_service

    settings = get_settings_service().settings

    # Get available models
    models = await _get_available_models()
    if not models:
        logger.warning("[SmartRouter] No models available in registry")
        return None

    # Build routing prompt
    prompt = _build_routing_prompt(query, models)

    # Use same LLM as intent classifier
    # Use smart_router_model_name, fallback to intent_classifier_model_name
    model_name = settings.smart_router_model_name or settings.intent_classifier_model_name
    if not model_name:
        logger.warning("[SmartRouter] No model configured for routing")
        return None

    endpoint = settings.mibuddy_endpoint
    api_key = settings.mibuddy_api_key

    if not endpoint or not api_key:
        logger.warning("[SmartRouter] MIBUDDY_ENDPOINT or MIBUDDY_API_KEY not set")
        return None

    try:
        from langchain_openai import AzureChatOpenAI
        llm = AzureChatOpenAI(
            azure_endpoint=endpoint,
            azure_deployment=model_name,
            api_version=settings.mibuddy_api_version,
            api_key=api_key,
            temperature=0.0,
                max_tokens=50,
            )

        from langchain_core.messages import HumanMessage, SystemMessage
        result = await llm.ainvoke([
            SystemMessage(content=prompt),
            HumanMessage(content=query),
        ])

        content = result.content if hasattr(result, "content") else str(result)
        logger.info(f"[SmartRouter] Raw response: {content!r}")

        # Parse response
        json_str = content.strip()
        if "{" in json_str:
            start = json_str.index("{")
            end = json_str.rindex("}") + 1
            json_str = json_str[start:end]

        parsed = json.loads(json_str)
        selected_name = parsed.get("model", "")

        # Find matching model
        for m in models:
            if m["display_name"].lower() == selected_name.lower():
                logger.info(f"[SmartRouter] Selected: {m['display_name']} (id={m['id']})")
                return m["id"], m["display_name"]

        # Fuzzy match
        for m in models:
            if selected_name.lower() in m["display_name"].lower() or m["display_name"].lower() in selected_name.lower():
                logger.info(f"[SmartRouter] Fuzzy match: {m['display_name']} (id={m['id']})")
                return m["id"], m["display_name"]

        logger.warning(f"[SmartRouter] Model '{selected_name}' not found in registry, using first model")
        return models[0]["id"], models[0]["display_name"]

    except Exception as e:
        logger.error(f"[SmartRouter] Failed: {e}")
        return None
