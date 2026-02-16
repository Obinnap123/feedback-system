import hmac
import hashlib
from datetime import datetime, timezone
from typing import Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database import get_db
from models import (
    User,
    UserRole,
    Feedback,
    FeedbackToken,
    StudentSessionSubmission,
    TokenSession,
    ToxicityRejectedAttempt,
)
from schemas import FeedbackSubmitRequest, FeedbackSubmitResponse, TokenStatusResponse
from dependencies import get_current_user, require_role, ANON_KEY_SECRET
from utils import toxicity_reason, default_session_label

router = APIRouter(prefix="/feedback", tags=["Feedback"])


def _anon_student_key(student_id: int, course_code: str, session_key: str) -> str:
    payload = f"{student_id}:{course_code}:{session_key}".encode("utf-8")
    return hmac.new(
        ANON_KEY_SECRET.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()


def _resolve_token_session(db: Session, token_record: FeedbackToken) -> Tuple[str, str]:
    metadata = (
        db.query(TokenSession).filter(TokenSession.token_id == token_record.id).first()
    )
    if metadata:
        return metadata.session_key, metadata.session_label

    fallback_key = (
        token_record.created_at.astimezone(timezone.utc).date().isoformat()
        if token_record.created_at
        else datetime.now(timezone.utc).date().isoformat()
    )
    return fallback_key, default_session_label(token_record.course_code, fallback_key)


@router.get("/token-status", response_model=TokenStatusResponse)
def feedback_token_status(
    token: str,
    student: User = Depends(require_role(UserRole.STUDENT)),
    db: Session = Depends(get_db),
) -> TokenStatusResponse:
    token_record = (
        db.query(FeedbackToken)
        .filter(FeedbackToken.token == token.strip())
        .first()
    )
    if not token_record:
        return TokenStatusResponse(
            token=token.strip(),
            valid=False,
            is_used=False,
            can_submit=False,
            reason="Invalid feedback token",
        )

    session_key, session_label = _resolve_token_session(db, token_record)
    anon_key = _anon_student_key(student.id, token_record.course_code, session_key)
    already_submitted = (
        db.query(StudentSessionSubmission.id)
        .filter(
            StudentSessionSubmission.anon_student_key == anon_key,
            StudentSessionSubmission.course_code == token_record.course_code,
            StudentSessionSubmission.session_key == session_key,
        )
        .first()
        is not None
    )
    lecturer = db.query(User).filter(User.id == token_record.lecturer_id).first()

    if token_record.is_used:
        return TokenStatusResponse(
            token=token_record.token,
            valid=True,
            is_used=True,
            can_submit=False,
            course_code=token_record.course_code,
            lecturer_email=lecturer.email if lecturer else None,
            session_key=session_key,
            session_label=session_label,
            reason="This token has already been used",
        )

    if already_submitted:
        return TokenStatusResponse(
            token=token_record.token,
            valid=True,
            is_used=False,
            can_submit=False,
            course_code=token_record.course_code,
            lecturer_email=lecturer.email if lecturer else None,
            session_key=session_key,
            session_label=session_label,
            reason="You already submitted feedback for this lecture session",
        )

    return TokenStatusResponse(
        token=token_record.token,
        valid=True,
        is_used=False,
        can_submit=True,
        course_code=token_record.course_code,
        lecturer_email=lecturer.email if lecturer else None,
        session_key=session_key,
        session_label=session_label,
    )


@router.post("/submit", response_model=FeedbackSubmitResponse)
def submit_feedback(
    payload: FeedbackSubmitRequest,
    student: User = Depends(require_role(UserRole.STUDENT)),
    db: Session = Depends(get_db),
) -> FeedbackSubmitResponse:
    token_record = (
        db.query(FeedbackToken)
        .filter(FeedbackToken.token == payload.token)
        .first()
    )
    if not token_record or token_record.is_used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or already used feedback token",
        )

    session_key, _session_label = _resolve_token_session(db, token_record)
    anon_key = _anon_student_key(student.id, token_record.course_code, session_key)
    existing_submission = (
        db.query(StudentSessionSubmission)
        .filter(
            StudentSessionSubmission.anon_student_key == anon_key,
            StudentSessionSubmission.course_code == token_record.course_code,
            StudentSessionSubmission.session_key == session_key,
        )
        .first()
    )
    if existing_submission:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already submitted feedback for this lecture session.",
        )

    reason = toxicity_reason(payload.text)
    if reason:
        rejected_attempt = ToxicityRejectedAttempt(
            token_id=token_record.id,
            lecturer_id=token_record.lecturer_id,
            course_code=token_record.course_code,
            text=(payload.text or "").strip(),
            reason=reason,
            is_reviewed=False,
        )
        db.add(rejected_attempt)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "We could not submit this yet. Please rephrase a few words to keep feedback respectful "
                "and focused on teaching clarity, pace, or materials. Your token remains valid."
            ),
        )

    feedback = Feedback(
        lecturer_id=token_record.lecturer_id,
        token_id=token_record.id,
        course_code=token_record.course_code,
        rating=payload.rating,
        text=payload.text,
        sentiment_score=payload.sentiment_score or 0.0,
        is_flagged=False,
    )
    token_record.is_used = True
    token_record.used_at = datetime.now(timezone.utc)
    submission_lock = StudentSessionSubmission(
        anon_student_key=anon_key,
        course_code=token_record.course_code,
        session_key=session_key,
        token_id=token_record.id,
    )

    db.add(feedback)
    db.add(submission_lock)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already submitted feedback for this lecture session.",
        ) from exc
    db.refresh(feedback)
    submission_lock.feedback_id = feedback.id
    db.commit()

    return FeedbackSubmitResponse(
        id=feedback.id,
        message="Feedback submitted",
        is_flagged=False,
    )
