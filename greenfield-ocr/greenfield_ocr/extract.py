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

MODEL = os.environ.get("GREENFIELD_MODEL", "claude-sonnet-4-6")


def _client() -> Anthropic:
    return Anthropic()  # reads ANTHROPIC_API_KEY from the environment


def _image_block(image_b64: str) -> dict:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": image_b64},
    }


def classify(image_b64: str) -> Classification:
    resp = _client().messages.create(
        model=MODEL,
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
        model=MODEL,
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
