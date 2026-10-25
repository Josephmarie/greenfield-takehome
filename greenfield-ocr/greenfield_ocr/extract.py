"""Model calls: classification and structured extraction.

Prompt caching is applied to the static system prefix (the extraction rules)
and to the tool definition. Across the three documents in this exercise the
cached prefix is the majority of the input tokens, so the second and third
documents read it from cache instead of reprocessing it.
"""

from __future__ import annotations

import json
import os

from anthropic import Anthropic

from .prompts import CLASSIFY_PROMPT, EXTRACTION_RULES, TOOLS
from .schemas import Classification

ANTHROPIC_MODEL = "claude-sonnet-4-6"
BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6"


def model_credentials_configured() -> bool:
    return bool(
        _bedrock_token()
        or os.environ.get("ANTHROPIC_API_KEY", "").strip()
    )


def _bedrock_token() -> str:
    token = os.environ.get("AWS_BEARER_TOKEN_BEDROCK", "").strip()
    if token.lower().startswith("bedrock:"):
        token = token.partition(":")[2].strip()
    return token


def _uses_bedrock() -> bool:
    return bool(_bedrock_token())


def model_configuration_error() -> str | None:
    if _uses_bedrock():
        if not (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")):
            return "Set AWS_REGION (or AWS_DEFAULT_REGION) when using Amazon Bedrock."
        return None
    if os.environ.get("ANTHROPIC_API_KEY", "").strip():
        return None
    return "Configure AWS_BEARER_TOKEN_BEDROCK for Bedrock or ANTHROPIC_API_KEY for Claude API."


def _model() -> str:
    default = BEDROCK_MODEL if _uses_bedrock() else ANTHROPIC_MODEL
    return os.environ.get("GREENFIELD_MODEL") or default


def _client():
    error = model_configuration_error()
    if error:
        raise RuntimeError(error)

    if _uses_bedrock():
        bedrock_token = _bedrock_token()
        region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
        from anthropic import AnthropicBedrock

        return AnthropicBedrock(api_key=bedrock_token, aws_region=region)

    return Anthropic()  # reads ANTHROPIC_API_KEY from the environment


def _image_block(image_b64: str) -> dict:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": image_b64},
    }


def classify(image_b64: str) -> Classification:
    resp = _client().messages.create(
        model=_model(),
        temperature=0,
        max_tokens=300,
        messages=[{"role": "user", "content": [_image_block(image_b64),
                                               {"type": "text", "text": CLASSIFY_PROMPT}]}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return Classification(**json.loads(text))


def extract_raw(image_b64: str, doc_type: str) -> dict:
    """Return the model's structured tool input for the given document type."""
    tool = TOOLS[doc_type]
    resp = _client().messages.create(
        model=_model(),
        temperature=0,
        max_tokens=3000,
        system=[{
            "type": "text",
            "text": EXTRACTION_RULES,
            "cache_control": {"type": "ephemeral"},  # <- cacheable static prefix
        }],
        tools=[{**tool, "cache_control": {"type": "ephemeral"}}],
        tool_choice={"type": "tool", "name": tool["name"]},
        messages=[{"role": "user", "content": [_image_block(image_b64),
                                               {"type": "text", "text": f"Extract this {doc_type}."}]}],
    )
    for block in resp.content:
        if block.type == "tool_use":
            return block.input
    raise RuntimeError("Model did not return a tool_use block")
