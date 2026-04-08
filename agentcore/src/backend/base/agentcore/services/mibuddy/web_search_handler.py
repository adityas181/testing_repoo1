"""Web search handler using Google Gemini with Google Search grounding.

Uses the same approach as MiBuddy:
- google-genai SDK with vertexai=True
- Google Cloud API key for authentication
- GoogleSearch tool for web grounding
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _get_gemini_client():
    """Create a Google GenAI client using settings (same as MiBuddy)."""
    from google import genai
    from agentcore.services.deps import get_settings_service

    settings = get_settings_service()
    api_key = settings.settings.gemini_api_key
    if not api_key:
        raise ValueError("Gemini API key not configured. Set GEMINI_API_KEY in settings.")

    return genai.Client(
        vertexai=True,
        api_key=api_key,
    )


async def handle_web_search(query: str, system_message: str = "") -> dict:
    """Call Gemini with Google Search tool and return the response.

    Returns dict with keys: response_text, model_name
    """
    from google.genai import types

    try:
        from agentcore.services.deps import get_settings_service
        settings = get_settings_service()
        model_name = settings.settings.gemini_model or "gemini-2.0-flash"

        client = _get_gemini_client()

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
            return {
                "response_text": response.text,
                "model_name": model_name,
            }
        else:
            return {
                "response_text": "Unable to retrieve web search results. Please try again.",
                "model_name": model_name,
            }

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return {
            "response_text": "Web search encountered an error. Please try again or use a different approach.",
            "model_name": "gemini",
        }


async def handle_web_search_stream(
    query: str,
    system_message: str = "",
    event_manager=None,
) -> dict:
    """Stream web search response, forwarding tokens to event_manager.

    Returns dict with keys: response_text, model_name
    """
    from google.genai import types

    try:
        from agentcore.services.deps import get_settings_service
        settings = get_settings_service()
        model_name = settings.settings.gemini_model or "gemini-2.0-flash"

        client = _get_gemini_client()

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

        return {
            "response_text": full_response,
            "model_name": model_name,
        }

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Web search stream failed: {e}")
        error_msg = "Web search encountered an error. Please try again."
        if event_manager:
            event_manager.on_token(data={"chunk": error_msg})
        return {
            "response_text": error_msg,
            "model_name": "gemini",
        }
