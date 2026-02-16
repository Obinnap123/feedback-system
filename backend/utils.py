from __future__ import annotations

import re
import json
from typing import Optional, Any

from better_profanity import profanity
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from models import AdminAuditLog, Feedback, FeedbackFlagReview, ToxicityRejectedAttempt

profanity.load_censor_words()


def log_admin_action(
    db: Session,
    admin_id: int,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    record = AdminAuditLog(
        admin_id=admin_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=json.dumps(details) if details else None,
    )
    db.add(record)


def pending_alerts_count(db: Session) -> int:
    feedback_pending = (
        db.query(func.count(Feedback.id))
        .outerjoin(FeedbackFlagReview, FeedbackFlagReview.feedback_id == Feedback.id)
        .filter(Feedback.is_flagged.is_(True), FeedbackFlagReview.id.is_(None))
        .scalar()
        or 0
    )
    rejected_pending = (
        db.query(func.count(ToxicityRejectedAttempt.id))
        .filter(ToxicityRejectedAttempt.is_reviewed.is_(False))
        .scalar()
        or 0
    )
    return int(feedback_pending) + int(rejected_pending)

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


    return profanity.censor(text)


def default_session_label(course_code: str, session_key: str) -> str:
    return f"{course_code} Lecture {session_key}"


def normalize_course_code(course_code: str) -> str:
    return "".join(course_code.strip().upper().split())


def normalize_session_key(session_key: Optional[str]) -> str:
    from datetime import datetime, timezone
    if not session_key:
        return datetime.now(timezone.utc).date().isoformat()
    try:
        return datetime.strptime(session_key.strip(), "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid session key. Use YYYY-MM-DD",
        ) from exc


# Semester Logic
from datetime import datetime, timezone, timedelta
from typing import Tuple, List

def semester_index(semester_type: str, year: int) -> int:
    return year * 2 + (1 if semester_type == "HARMATTAN" else 0)


def semester_from_index(index: int) -> Tuple[str, int]:
    year = index // 2
    if index % 2 == 0:
        return "RAIN", year
    return "HARMATTAN", year


def semester_from_date(value: datetime) -> Tuple[str, int]:
    if value.month >= 10:
        return "HARMATTAN", value.year
    if value.month <= 3:
        return "HARMATTAN", value.year - 1
    return "RAIN", value.year


def semester_label(semester_type: str, year: int) -> str:
    if semester_type == "HARMATTAN":
        return f"Harmattan {year}/{year + 1}"
    return f"Rain {year}"


def semester_window(semester_type: str, year: int) -> Tuple[datetime, datetime]:
    if semester_type == "HARMATTAN":
        return (
            datetime(year, 10, 1, tzinfo=timezone.utc),
            datetime(year + 1, 4, 1, tzinfo=timezone.utc),
        )
    return (
        datetime(year, 4, 1, tzinfo=timezone.utc),
        datetime(year, 10, 1, tzinfo=timezone.utc),
    )


def semester_range_label(start: datetime, end: datetime) -> str:
    end_inclusive = end - timedelta(days=1)
    return f"{start:%b %d, %Y} - {end_inclusive:%b %d, %Y}"


def semester_value(semester_type: str, year: int) -> str:
    return f"{semester_type}-{year}"


def parse_semester(value: str) -> Optional[Tuple[str, int]]:
    try:
        semester_type, year_text = value.strip().upper().split("-", 1)
        if semester_type not in {"HARMATTAN", "RAIN"}:
            return None
        return semester_type, int(year_text)
    except Exception:
        return None


def resolve_semester(semester: Optional[str]) -> Tuple[str, int, datetime, datetime]:
    now = datetime.now(timezone.utc)
    parsed = parse_semester(semester) if semester else None
    if semester and not parsed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid semester format. Use HARMATTAN-YYYY or RAIN-YYYY",
        )
    if parsed:
        sem_type, sem_year = parsed
    else:
        sem_type, sem_year = semester_from_date(now)
    start, end = semester_window(sem_type, sem_year)
    return sem_type, sem_year, start, end
