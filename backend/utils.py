from __future__ import annotations

from better_profanity import profanity
from fastapi import HTTPException, status


profanity.load_censor_words()


def is_toxic_text(text: str | None) -> bool:
    if not text:
        return False
    return profanity.contains_profanity(text)


def enforce_toxicity_guard(text: str | None) -> None:
    if not text:
        return
    if is_toxic_text(text):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Feedback contains unprofessional language. Please rephrase.",
        )


def clean_feedback_text(text: str | None) -> str | None:
    if text is None:
        return None
    return profanity.censor(text)
