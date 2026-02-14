from __future__ import annotations

import re
from typing import Optional

from better_profanity import profanity
from fastapi import HTTPException, status


profanity.load_censor_words()

_LEETSPEAK_MAP = str.maketrans(
    {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "@": "a",
        "$": "s",
    }
)

# Broad abusive/disrespectful list to supplement profanity dictionary matching.
_DISRESPECTFUL_TERMS = (
    "idiot",
    "stupid",
    "dumb",
    "fool",
    "foolish",
    "nonsense",
    "rubbish",
    "useless",
    "trash",
    "hate you",
    "shut up",
    "messed up",
    "worst class ever",
    "worst lecture ever",
    "terrible class",
    "awful class",
    "horrible class",
)

_DISRESPECTFUL_PATTERNS = (
    r"\bmessed\s+up\s+(class|lecture|course|lecturer)\b",
    r"\b(one\s+of\s+the\s+most\s+messed\s+up\s+classes)\b",
    r"\b(worst|terrible|awful|horrible)\s+(class|lecture|course)\b",
    r"\b(useless|worthless)\s+(class|lecture|course|lecturer)\b",
    r"\bi\s+hate\s+(this|the)\s+(class|lecture|course|lecturer)\b",
)


def _normalize_for_moderation(text: str) -> str:
    normalized = text.lower().translate(_LEETSPEAK_MAP)
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def toxicity_reason(text: str | None) -> Optional[str]:
    if not text:
        return None

    if profanity.contains_profanity(text):
        return "PROFANITY"

    normalized = _normalize_for_moderation(text)
    for term in _DISRESPECTFUL_TERMS:
        escaped = re.escape(term)
        if re.search(rf"\b{escaped}\b", normalized):
            return "DISRESPECTFUL_LANGUAGE"

    for pattern in _DISRESPECTFUL_PATTERNS:
        if re.search(pattern, normalized):
            return "DISRESPECTFUL_LANGUAGE"
    return None


def is_toxic_text(text: str | None) -> bool:
    return toxicity_reason(text) is not None


def enforce_toxicity_guard(text: str | None) -> None:
    reason = toxicity_reason(text)
    if reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Feedback was blocked because it contains abusive/disrespectful language. "
                "Please rephrase and focus on teaching clarity, pace, and materials."
            ),
        )


def clean_feedback_text(text: str | None) -> str | None:
    if text is None:
        return None
    return profanity.censor(text)
