"""Web search handler using Google Gemini with Google Search grounding.

Uses the model from the registry (WEB_SEARCH_MODEL_NAME) for credentials.
Falls back to GEMINI_API_KEY from .env if no registry model found.

When user selects this model from dropdown → normal chat (no search tool)
When intent is web_search → uses GoogleSearch grounding tool
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _get_settings():
    from agentcore.services.deps import get_settings_service
    return get_settings_service().settings


async def _get_web_search_api_key() -> tuple[str, str]:
    """Get Gemini API key and model name.

    Priority:
    1. From model registry (WEB_SEARCH_MODEL_NAME)
    2. From .env (GEMINI_API_KEY + GEMINI_MODEL)

    Returns (api_key, model_name)
    """
    settings = _get_settings()
    model_name_setting = settings.web_search_model_name

    # Try registry first
    if model_name_setting:
        try:
            from agentcore.services.model_service_client import fetch_registry_models_async

            all_models = await fetch_registry_models_async(active_only=True)
            name_lower = model_name_setting.lower()

            for m in all_models:
                display = (m.get("display_name") or "").lower()
                model_n = (m.get("model_name") or "").lower()
                if name_lower == display or name_lower == model_n or name_lower in display:
                    model_id = str(m.get("id", ""))
                    logger.info(f"[WebSearch] Found registry model: {m.get('display_name')} (id={model_id})")

                    # Fetch decrypted config
                    import httpx
                    url = settings.model_service_url
                    svc_key = settings.model_service_api_key
                    headers = {"x-api-key": svc_key} if svc_key else {}
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        resp = await client.get(f"{url}/v1/registry/models/{model_id}/config", headers=headers)
                        if resp.status_code == 200:
                            config = resp.json()
                            api_key = config.get("api_key", "")
                            model_name = config.get("model_name", "gemini-2.0-flash")
                            if api_key:
                                return api_key, model_name
        except Exception as e:
            logger.warning(f"[WebSearch] Failed to fetch from registry: {e}")

    # Fallback to .env
    api_key = settings.gemini_api_key
    model_name = settings.gemini_model or "gemini-2.0-flash"

    if not api_key:
        raise ValueError("Web search not configured. Register a Gemini model with WEB_SEARCH_MODEL_NAME or set GEMINI_API_KEY.")

    return api_key, model_name


async def handle_web_search(query: str, system_message: str = "") -> dict:
    """Call Gemini with Google Search grounding tool.

    Returns dict with keys: response_text, model_name
    """
    from google import genai
    from google.genai import types

    try:
        api_key, model_name = await _get_web_search_api_key()
        logger.info(f"[WebSearch] Using model={model_name}")

        client = genai.Client(vertexai=True, api_key=api_key)

        contents = [
            types.Content(role="user", parts=[types.Part(text=query)]),
        ]
        if system_message:
            contents.append(
                types.Content(role="user", parts=[types.Part(text=f"SYSTEM INSTRUCTIONS:\n{system_message}")])
            )

        tools = [types.Tool(google_search=types.GoogleSearch())]

        config = types.GenerateContentConfig(
            temperature=1,
            top_p=0.95,
            max_output_tokens=65535,
            safety_settings=[
                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
            ],
            tools=tools,
        )

        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=config,
        )

        if (
            response.candidates
            and response.candidates[0].content
            and response.candidates[0].content.parts
        ):
            return {"response_text": response.text, "model_name": model_name}
        else:
            return {"response_text": "Unable to retrieve web search results. Please try again.", "model_name": model_name}

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"[WebSearch] Failed: {e}")
        return {"response_text": "Web search encountered an error. Please try again.", "model_name": "gemini"}


async def handle_web_search_stream(query: str, system_message: str = "", event_manager=None) -> dict:
    """Stream web search response."""
    from google import genai
    from google.genai import types

    try:
        api_key, model_name = await _get_web_search_api_key()
        client = genai.Client(vertexai=True, api_key=api_key)

        contents = [
            types.Content(role="user", parts=[types.Part(text=query)]),
        ]
        if system_message:
            contents.append(
                types.Content(role="user", parts=[types.Part(text=f"SYSTEM INSTRUCTIONS:\n{system_message}")])
            )

        tools = [types.Tool(google_search=types.GoogleSearch())]

        config = types.GenerateContentConfig(
            temperature=1,
            top_p=0.95,
            max_output_tokens=65535,
            safety_settings=[
                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
            ],
            tools=tools,
        )

        full_response = ""
        for chunk in client.models.generate_content_stream(
            model=model_name,
            contents=contents,
            config=config,
        ):
            if not chunk.candidates or not chunk.candidates[0].content or not chunk.candidates[0].content.parts:
                continue
            text = chunk.text
            if text:
                full_response += text
                if event_manager:
                    event_manager.on_token(data={"chunk": text})

        return {"response_text": full_response, "model_name": model_name}

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"[WebSearch] Stream failed: {e}")
        error_msg = "Web search encountered an error. Please try again."
        if event_manager:
            event_manager.on_token(data={"chunk": error_msg})
        return {"response_text": error_msg, "model_name": "gemini"}
