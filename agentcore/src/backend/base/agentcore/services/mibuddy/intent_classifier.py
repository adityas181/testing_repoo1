"""Intent classification service for orchestrator chat routing.

Classifies user queries into intents (general_chat, web_search, image_generation)
using an LLM from the model registry via the Model microservice.
"""

from __future__ import annotations

import json
import logging
from enum import Enum
from uuid import UUID

from langchain_core.messages import HumanMessage, SystemMessage

from agentcore.services.model_service_client import MicroserviceChatModel

logger = logging.getLogger(__name__)


class Intent(str, Enum):
    GENERAL_CHAT = "general_chat"
    WEB_SEARCH = "web_search"
    IMAGE_GENERATION = "image_generation"
    KNOWLEDGE_BASE_SEARCH = "knowledge_base_search"


def _build_classification_prompt() -> str:
    """Build the intent classification prompt, dynamically including company KB info."""
    from agentcore.services.deps import get_settings_service
    settings = get_settings_service().settings

    company_name = settings.company_kb_name
    company_keywords = settings.company_kb_keywords

    kb_intent = ""
    if company_name and company_keywords:
        examples = ", ".join(f'"{kw.strip()}"' for kw in company_keywords.split(",")[:5])
        kb_intent = f"""
4. "knowledge_base_search": Use this if the user asks about {company_name} (the company), its policies, internal documents, employees, corporate information, or anything specifically related to {company_name}.
   Keywords that indicate this intent: {examples}.
   Examples: "What is {company_name}'s leave policy?", "Who is the CEO of {company_name}?", "{company_name} revenue"."""

    return f"""You are an intelligent intent classifier for an AI assistant.
Your job is to analyze the user's query and categorize it into EXACTLY one of the following categories:

1. "image_generation": Use this if the user requests to create, generate, draw, render, modify, edit, or transform any image, picture, photo, logo, or diagram.
   Examples: "create an image of a dog", "generate a logo", "draw a sunset", "edit that image", "make the background blue".

2. "web_search": Use this if the user asks for *current* information, real-time data, news, weather, stock prices, sports scores, or explicitly asks to search the web/internet.
   Examples: "What is the weather in London?", "Latest news on AI", "Who won the game yesterday?", "Search for..."{kb_intent}

{"5" if kb_intent else "3"}. "general_chat": Use this for everything else. This includes general knowledge, coding help, writing, summarization, translation, math, casual conversation, and any question that can be answered from training knowledge.
   Examples: "Write a python script", "Summarize this text", "Translate hello to spanish", "Tell me a joke", "Explain quantum computing".

Output Format:
You must output ONLY a valid JSON object containing a single key "intent".
Example: {{"intent": "web_search"}}
Do not include any explanation or markdown formatting."""


class IntentClassifier:
    """Classifies user queries into intents using an LLM from the model registry."""

    def __init__(self, model_id: str | None = None):
        """Initialize the classifier.

        Args:
            model_id: UUID string of the registry model to use for classification.
                      If None, loads from settings (intent_classifier_model_id).
        """
        self._model_id = model_id
        self._model: MicroserviceChatModel | None = None

    def _get_model(self) -> MicroserviceChatModel:
        if self._model is not None:
            return self._model

        model_id = self._model_id
        if not model_id:
            from agentcore.services.deps import get_settings_service
            settings = get_settings_service()
            model_id = settings.settings.intent_classifier_model_id

        if not model_id:
            raise ValueError(
                "Intent classifier model not configured. "
                "Set INTENT_CLASSIFIER_MODEL_ID in settings."
            )

        from agentcore.services.deps import get_settings_service
        settings = get_settings_service()

        self._model = MicroserviceChatModel(
            service_url=settings.settings.model_service_url,
            service_api_key=settings.settings.model_service_api_key,
            registry_model_id=model_id,
            provider="openai",  # placeholder — resolved from registry by model service
            model=f"intent-classifier-{model_id[:8]}",
            temperature=0.0,
        )
        return self._model

    async def classify(self, query: str) -> Intent:
        """Classify a user query into an intent.

        Returns Intent.GENERAL_CHAT as fallback on any error.
        """
        try:
            model = self._get_model()
            prompt = _build_classification_prompt()
            messages = [
                SystemMessage(content=prompt),
                HumanMessage(content=query),
            ]
            result = await model.ainvoke(messages)
            content = result.content if hasattr(result, "content") else str(result)
            logger.info(f"Intent classifier raw response: {content!r}")

            # Robust JSON extraction — handle markdown code blocks or extra text
            json_str = content.strip()
            if "```" in json_str:
                # Extract JSON from markdown code block
                json_str = json_str.split("```")[1]
                if json_str.startswith("json"):
                    json_str = json_str[4:]
                json_str = json_str.strip()
            elif "{" in json_str:
                # Extract first JSON object
                start = json_str.index("{")
                end = json_str.rindex("}") + 1
                json_str = json_str[start:end]

            parsed = json.loads(json_str)
            intent_str = parsed.get("intent", "general_chat")
            logger.info(f"Intent classified: '{query[:60]}' -> {intent_str}")

            try:
                return Intent(intent_str)
            except ValueError:
                logger.warning(f"Unknown intent '{intent_str}' from classifier, defaulting to general_chat")
                return Intent.GENERAL_CHAT

        except ValueError as e:
            if "not configured" in str(e):
                logger.info("Intent classifier not configured, defaulting to general_chat")
            else:
                logger.error(f"Intent classification ValueError: {e}")
            return Intent.GENERAL_CHAT
        except Exception as e:
            logger.error(f"Intent classification failed: {e}")
            return Intent.GENERAL_CHAT
