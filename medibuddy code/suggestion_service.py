"""Autocomplete suggestion service.

Generates query suggestions as the user types, using the MiBuddy
Azure AI Foundry endpoint with a lightweight model (e.g. Llama 3.1 8B).

Same endpoint + API key as intent classifier and smart router,
just a different model deployment (SUGGESTION_MODEL_NAME).
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def get_suggestions(query: str) -> list[str]:
    """Generate autocomplete suggestions for the user's input.

    Args:
        query: Current text in the input field (may be empty).

    Returns:
        List of up to 5 suggestion strings.
    """
    from agentcore.services.deps import get_settings_service

    settings = get_settings_service().settings

    model_name = settings.suggestion_model_name
    endpoint = settings.mibuddy_endpoint
    api_key = settings.mibuddy_api_key

    if not model_name or not endpoint or not api_key:
        return []

    # Build prompt based on whether input is empty or has text
    if not query or not query.strip():
        system_prompt = (
            "You are a helpful AI assistant. Generate EXACTLY 5 trending conversational topics "
            "that users commonly ask about. Each topic should be a short question or statement. "
            "Return ONLY the 5 topics, one per line. No numbering, no bullets, no extra text."
        )
        user_prompt = "Generate 5 trending topics"
    else:
        system_prompt = (
            "You are an autocomplete assistant. Based on the user's partial input, "
            "generate EXACTLY 5 short helpful continuations or completions of what they might be trying to ask. "
            "Each suggestion should be a complete question or statement that starts with or includes the user's text. "
            "Return ONLY the 5 suggestions, one per line. No numbering, no bullets, no extra text."
        )
        user_prompt = query

    try:
        import httpx

        # Use the Azure AI Foundry chat completions endpoint
        url = f"{endpoint.rstrip('/')}/openai/deployments/{model_name}/chat/completions?api-version={settings.mibuddy_api_version}"

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "api-key": api_key,
                },
                json={
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": 200,
                    "temperature": 0.7,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        # Parse suggestions (one per line)
        suggestions = [
            line.strip().lstrip("0123456789.-) ")
            for line in content.strip().split("\n")
            if line.strip() and len(line.strip()) > 3
        ]

        return suggestions[:5]

    except Exception as e:
        logger.debug(f"[Suggestions] Failed: {e}")
        return []
