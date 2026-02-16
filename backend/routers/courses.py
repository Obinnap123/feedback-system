import csv
import io
import json
import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from database import get_db
from models import (
    User,
    UserRole,
    CourseAssignment,
    FeedbackToken,
    TokenSession,
)
from schemas import (
    CourseAssignmentCreateRequest,
    CourseAssignmentResponse,
    ActionResponse,
    TokenGenerateRequest,
    TokenGenerateResponse,
    TokenListResponse,
    TokenTrackerResponse,
)
from dependencies import get_current_user, require_role
from utils import (
    log_admin_action,
    normalize_course_code,
    normalize_session_key,
    default_session_label,
    resolve_semester,
)

router = APIRouter(prefix="/dashboard/admin", tags=["Courses & Tokens"])


def _generate_unique_token(db: Session) -> str:
    while True:
        token = secrets.token_urlsafe(16)
        exists = db.query(FeedbackToken).filter(FeedbackToken.token == token).first()
        if not exists:
            return token


@router.get("/course-assignments", response_model=List[CourseAssignmentResponse])
def list_course_assignments(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[CourseAssignmentResponse]:
    rows = (
        db.query(CourseAssignment, User.email)
        .join(User, User.id == CourseAssignment.lecturer_id)
        .order_by(CourseAssignment.course_code.asc(), User.email.asc())
        .all()
    )
    return [
        CourseAssignmentResponse(
            id=assignment.id,
            lecturer_id=assignment.lecturer_id,
            lecturer_email=email,
            course_code=assignment.course_code,
            created_at=assignment.created_at.isoformat(),
        )
        for assignment, email in rows
    ]


@router.post("/course-assignments", response_model=CourseAssignmentResponse)
def create_course_assignment(
    payload: CourseAssignmentCreateRequest,
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> CourseAssignmentResponse:
    lecturer = db.query(User).filter(User.id == payload.lecturer_id).first()
    if not lecturer or lecturer.role != UserRole.LECTURER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid lecturer selected",
        )

    course_code = normalize_course_code(payload.course_code)
    existing = (
        db.query(CourseAssignment)
        .filter(
            CourseAssignment.lecturer_id == payload.lecturer_id,
            CourseAssignment.course_code == course_code,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Course is already assigned to this lecturer",
        )

    assignment = CourseAssignment(
        lecturer_id=payload.lecturer_id,
        course_code=course_code,
    )
    db.add(assignment)
    log_admin_action(
        db,
        admin_id=user.id,
        action="COURSE_ASSIGNED",
        entity_type="course_assignment",
        entity_id=f"{payload.lecturer_id}:{course_code}",
        details={"lecturer_id": payload.lecturer_id, "course_code": course_code},
    )
    db.commit()
    db.refresh(assignment)
    return CourseAssignmentResponse(
        id=assignment.id,
        lecturer_id=assignment.lecturer_id,
        lecturer_email=lecturer.email,
        course_code=assignment.course_code,
        created_at=assignment.created_at.isoformat(),
    )


@router.delete("/course-assignments/{assignment_id}", response_model=ActionResponse)
def delete_course_assignment(
    assignment_id: int,
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> ActionResponse:
    assignment = db.query(CourseAssignment).filter(CourseAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course assignment not found",
        )
    log_admin_action(
        db,
        admin_id=user.id,
        action="COURSE_UNASSIGNED",
        entity_type="course_assignment",
        entity_id=str(assignment.id),
        details={
            "lecturer_id": assignment.lecturer_id,
            "course_code": assignment.course_code,
        },
    )
    db.delete(assignment)
    db.commit()
    return ActionResponse(message="Course assignment removed")


@router.post("/tokens", response_model=TokenGenerateResponse)
def generate_tokens(
    payload: TokenGenerateRequest,
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> TokenGenerateResponse:
    lecturer = db.query(User).filter(User.id == payload.lecturer_id).first()
    if not lecturer or lecturer.role != UserRole.LECTURER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid lecturer selected",
        )

    course_code = normalize_course_code(payload.course_code)
    assignment = (
        db.query(CourseAssignment)
        .filter(
            CourseAssignment.lecturer_id == payload.lecturer_id,
            CourseAssignment.course_code == course_code,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assign this course to the lecturer before generating tokens",
        )

    session_key = normalize_session_key(payload.session_key)
    session_label = (
        payload.session_label.strip()
        if payload.session_label and payload.session_label.strip()
        else default_session_label(course_code, session_key)
    )

    tokens: List[str] = []

    for _ in range(payload.quantity):
        token_value = _generate_unique_token(db)
        token_record = FeedbackToken(
            token=token_value,
            lecturer_id=payload.lecturer_id,
            course_code=course_code,
            is_used=False,
        )
        db.add(token_record)
        db.flush()
        db.add(
            TokenSession(
                token_id=token_record.id,
                course_code=course_code,
                session_key=session_key,
                session_label=session_label,
            )
        )
        tokens.append(token_value)

    log_admin_action(
        db,
        admin_id=user.id,
        action="TOKEN_BATCH_GENERATED",
        entity_type="token_batch",
        entity_id=f"{course_code}:{session_key}",
        details={
            "course_code": course_code,
            "lecturer_id": payload.lecturer_id,
            "quantity": payload.quantity,
            "session_key": session_key,
            "session_label": session_label,
        },
    )
    db.commit()

    return TokenGenerateResponse(
        course_code=course_code,
        lecturer_id=payload.lecturer_id,
        session_key=session_key,
        session_label=session_label,
        tokens=tokens,
    )


@router.get("/tokens", response_model=List[TokenListResponse])
def list_tokens(
    course_code: Optional[str] = None,
    lecturer_id: Optional[int] = None,
    semester: Optional[str] = None,
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[TokenListResponse]:
    query = (
        db.query(FeedbackToken, User.email, TokenSession.session_key, TokenSession.session_label)
        .join(User, User.id == FeedbackToken.lecturer_id)
        .outerjoin(TokenSession, TokenSession.token_id == FeedbackToken.id)
    )
    if course_code:
        query = query.filter(FeedbackToken.course_code == normalize_course_code(course_code))
    if lecturer_id:
        query = query.filter(FeedbackToken.lecturer_id == lecturer_id)
    if semester:
        _, _, start, end = resolve_semester(semester)
        query = query.filter(FeedbackToken.created_at >= start, FeedbackToken.created_at < end)

    rows = query.order_by(FeedbackToken.created_at.desc()).all()
    return [
        TokenListResponse(
            token=token.token,
            course_code=token.course_code,
            lecturer_id=token.lecturer_id,
            lecturer_email=email,
            session_key=(
                session_key
                or (
                    token.created_at.astimezone(timezone.utc).date().isoformat()
                    if token.created_at
                    else datetime.now(timezone.utc).date().isoformat()
                )
            ),
            session_label=(
                session_label
                or default_session_label(
                    token.course_code,
                    token.created_at.astimezone(timezone.utc).date().isoformat()
                    if token.created_at
                    else datetime.now(timezone.utc).date().isoformat(),
                )
            ),
            is_used=token.is_used,
            created_at=token.created_at.isoformat(),
            used_at=token.used_at.isoformat() if token.used_at else None,
        )
        for token, email, session_key, session_label in rows
    ]


@router.get("/tokens/tracker", response_model=List[TokenTrackerResponse])
def token_tracker(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[TokenTrackerResponse]:
    used_expr = case((FeedbackToken.is_used.is_(True), 1), else_=0)
    rows = (
        db.query(
            FeedbackToken.course_code,
            func.sum(used_expr).label("used_tokens"),
            func.count(FeedbackToken.id).label("total_tokens"),
        )
        .group_by(FeedbackToken.course_code)
        .order_by(FeedbackToken.course_code.asc())
        .all()
    )
    return [
        TokenTrackerResponse(
            course_code=row.course_code,
            used_tokens=int(row.used_tokens or 0),
            total_tokens=int(row.total_tokens or 0),
            usage_pct=((int(row.used_tokens or 0) / int(row.total_tokens or 1)) * 100.0),
        )
        for row in rows
    ]


@router.get("/export/token-list")
def export_token_list(
    course_code: Optional[str] = None,
    lecturer_id: Optional[int] = None,
    semester: Optional[str] = None,
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    query = (
        db.query(FeedbackToken, User.email, TokenSession.session_key, TokenSession.session_label)
        .join(User, User.id == FeedbackToken.lecturer_id)
        .outerjoin(TokenSession, TokenSession.token_id == FeedbackToken.id)
    )
    if course_code:
        query = query.filter(FeedbackToken.course_code == normalize_course_code(course_code))
    if lecturer_id:
        query = query.filter(FeedbackToken.lecturer_id == lecturer_id)
    if semester:
        _, _, start, end = resolve_semester(semester)
        query = query.filter(FeedbackToken.created_at >= start, FeedbackToken.created_at < end)

    rows = query.order_by(FeedbackToken.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "token",
            "course_code",
            "lecturer_id",
            "lecturer_email",
            "session_key",
            "session_label",
            "is_used",
            "created_at",
            "used_at",
        ]
    )
    for token, email, session_key, session_label in rows:
        resolved_session_key = (
            session_key
            or (
                token.created_at.astimezone(timezone.utc).date().isoformat()
                if token.created_at
                else datetime.now(timezone.utc).date().isoformat()
            )
        )
        resolved_session_label = (
            session_label or default_session_label(token.course_code, resolved_session_key)
        )
        writer.writerow(
            [
                token.token,
                token.course_code,
                token.lecturer_id,
                email,
                resolved_session_key,
                resolved_session_label,
                "yes" if token.is_used else "no",
                token.created_at.isoformat(),
                token.used_at.isoformat() if token.used_at else "",
            ]
        )

    payload = output.getvalue()
    log_admin_action(
        db,
        admin_id=user.id,
        action="EXPORT_TOKEN_LIST",
        entity_type="export",
        entity_id="token-list.csv",
        details={
            "course_code": normalize_course_code(course_code) if course_code else None,
            "lecturer_id": lecturer_id,
            "semester": semester,
        },
    )
    db.commit()
    return StreamingResponse(
        iter([payload]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="token-list.csv"'},
    )
