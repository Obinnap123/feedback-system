from __future__ import annotations

import csv
import hashlib
import hmac
import io
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
import secrets
import json

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database import Base, engine, get_db
from models import (
    AdminAuditLog,
    CourseAssignment,
    Feedback,
    FeedbackFlagReview,
    FeedbackToken,
    FlagReviewAction,
    StudentSessionSubmission,
    TokenSession,
    ToxicityRejectedAttempt,
    User,
    UserRole,
)
from utils import clean_feedback_text, toxicity_reason


SECRET_KEY = "change-me"
ANON_KEY_SECRET = "change-me-anon-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

pwd_context = CryptContext(schemes=["bcrypt", "pbkdf2_sha256"], deprecated="auto")
auth_scheme = HTTPBearer()

app = FastAPI(title="Feedback System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# For local/dev convenience. Replace with Alembic migrations for production.
Base.metadata.create_all(bind=engine)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6)


class RegisterResponse(BaseModel):
    id: int
    email: str
    role: UserRole


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class FeedbackSubmitRequest(BaseModel):
    token: str
    rating: int = Field(ge=1, le=5)
    text: Optional[str] = None
    sentiment_score: Optional[float] = 0.0


class FeedbackSubmitResponse(BaseModel):
    id: int
    message: str
    is_flagged: bool


class KPICard(BaseModel):
    key: str
    label: str
    value: str
    icon: str


class AdminDashboardResponse(BaseModel):
    total_feedbacks: int
    global_average: Optional[float]
    participation_rate: float
    pending_alerts: int
    kpi_cards: List[KPICard]
    # Legacy fields retained for compatibility with existing clients.
    avg_rating: Optional[float]
    toxicity_hit_rate: float


class LecturerOption(BaseModel):
    id: int
    email: str


class CourseAssignmentCreateRequest(BaseModel):
    lecturer_id: int
    course_code: str = Field(min_length=2, max_length=50)


class CourseAssignmentResponse(BaseModel):
    id: int
    lecturer_id: int
    lecturer_email: str
    course_code: str
    created_at: str


class ActionResponse(BaseModel):
    message: str


class TokenGenerateRequest(BaseModel):
    course_code: str = Field(min_length=2, max_length=50)
    lecturer_id: int
    quantity: int = Field(default=1, ge=1, le=500)
    session_key: Optional[str] = Field(default=None, max_length=32)
    session_label: Optional[str] = Field(default=None, max_length=120)


class TokenGenerateResponse(BaseModel):
    course_code: str
    lecturer_id: int
    session_key: str
    session_label: str
    tokens: List[str]


class TokenTrackerResponse(BaseModel):
    course_code: str
    used_tokens: int
    total_tokens: int
    usage_pct: float


class TokenListResponse(BaseModel):
    token: str
    course_code: str
    lecturer_id: int
    lecturer_email: str
    session_key: str
    session_label: str
    is_used: bool
    created_at: str
    used_at: Optional[str]


class TokenStatusResponse(BaseModel):
    token: str
    valid: bool
    is_used: bool
    can_submit: bool
    course_code: Optional[str] = None
    lecturer_email: Optional[str] = None
    session_key: Optional[str] = None
    session_label: Optional[str] = None
    reason: Optional[str] = None


class LecturerRatingResponse(BaseModel):
    lecturer: str
    avg_rating: float
    total_feedbacks: int


class LeaderboardEntry(BaseModel):
    rank: int
    lecturer_id: int
    lecturer: str
    avg_rating: float
    total_feedbacks: int


class ToxicityLogEntry(BaseModel):
    keyword: str
    count: int
    last_seen: Optional[str] = None


class ToxicityFeedEntry(BaseModel):
    item_type: str
    item_id: int
    lecturer_id: Optional[int] = None
    lecturer_email: str
    course_code: str
    comment: str
    created_at: str


class DismissFlagRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class SemesterOption(BaseModel):
    value: str
    label: str
    range: str


class CourseBreakdown(BaseModel):
    course_code: str
    avg_rating: Optional[float]
    count: int


class LecturerDashboardResponse(BaseModel):
    total_feedbacks: int
    avg_rating: Optional[float]
    cleaned_comments: List[str]
    current_semester: str
    current_semester_range: str
    previous_semester: str
    previous_semester_range: str
    current_avg_rating: Optional[float]
    previous_avg_rating: Optional[float]
    current_feedbacks: int
    previous_feedbacks: int
    total_avg_rating: Optional[float]
    rating_distribution: List[int]
    positive_pct: float
    neutral_pct: float
    negative_pct: float
    insight_delta: Optional[float]
    course_breakdown: List[CourseBreakdown]
    available_courses: List[str]
    available_semesters: List[SemesterOption]
    selected_semester: str
    selected_course: Optional[str]
    last_synced_at: str


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == email.strip().lower()).first()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(auth_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
            )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    return user


def require_role(*roles: UserRole):
    def _role_dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )
        return user

    return _role_dependency


def _semester_index(semester_type: str, year: int) -> int:
    return year * 2 + (1 if semester_type == "HARMATTAN" else 0)


def _semester_from_index(index: int) -> Tuple[str, int]:
    year = index // 2
    if index % 2 == 0:
        return "RAIN", year
    return "HARMATTAN", year


def _semester_from_date(value: datetime) -> Tuple[str, int]:
    if value.month >= 10:
        return "HARMATTAN", value.year
    if value.month <= 3:
        return "HARMATTAN", value.year - 1
    return "RAIN", value.year


def _semester_label(semester_type: str, year: int) -> str:
    if semester_type == "HARMATTAN":
        return f"Harmattan {year}/{year + 1}"
    return f"Rain {year}"


def _semester_window(semester_type: str, year: int) -> Tuple[datetime, datetime]:
    if semester_type == "HARMATTAN":
        return (
            datetime(year, 10, 1, tzinfo=timezone.utc),
            datetime(year + 1, 4, 1, tzinfo=timezone.utc),
        )
    return (
        datetime(year, 4, 1, tzinfo=timezone.utc),
        datetime(year, 10, 1, tzinfo=timezone.utc),
    )


def _semester_range_label(start: datetime, end: datetime) -> str:
    end_inclusive = end - timedelta(days=1)
    return f"{start:%b %d, %Y} - {end_inclusive:%b %d, %Y}"


def _semester_value(semester_type: str, year: int) -> str:
    return f"{semester_type}-{year}"


def _parse_semester(value: str) -> Optional[Tuple[str, int]]:
    try:
        semester_type, year_text = value.strip().upper().split("-", 1)
        if semester_type not in {"HARMATTAN", "RAIN"}:
            return None
        return semester_type, int(year_text)
    except Exception:
        return None


def _normalize_course_code(course_code: str) -> str:
    return "".join(course_code.strip().upper().split())


def _normalize_login_identifier(identifier: str) -> str:
    cleaned = identifier.strip().lower()
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email or matric number is required",
        )
    if "@" in cleaned:
        return cleaned
    compact = "".join(ch for ch in cleaned if ch.isalnum() or ch in {"-", "_", "."})
    if not compact:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid matric number format",
        )
    return f"{compact}@student.local"


def _normalize_session_key(session_key: Optional[str]) -> str:
    if not session_key:
        return datetime.now(timezone.utc).date().isoformat()
    try:
        return datetime.strptime(session_key.strip(), "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid session key. Use YYYY-MM-DD",
        ) from exc


def _default_session_label(course_code: str, session_key: str) -> str:
    return f"{course_code} Lecture {session_key}"


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
    return fallback_key, _default_session_label(token_record.course_code, fallback_key)


def _log_admin_action(
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


def _resolve_semester(semester: Optional[str]) -> Tuple[str, int, datetime, datetime]:
    now = datetime.now(timezone.utc)
    parsed = _parse_semester(semester) if semester else None
    if semester and not parsed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid semester format. Use HARMATTAN-YYYY or RAIN-YYYY",
        )
    if parsed:
        sem_type, sem_year = parsed
    else:
        sem_type, sem_year = _semester_from_date(now)
    start, end = _semester_window(sem_type, sem_year)
    return sem_type, sem_year, start, end


def _pending_alerts_count(db: Session) -> int:
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


@app.post("/auth/register", response_model=RegisterResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> RegisterResponse:
    normalized_email = _normalize_login_identifier(payload.email)
    if get_user_by_email(db, normalized_email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email or matric number is already registered",
        )

    user = User(
        email=normalized_email,
        hashed_password=pwd_context.hash(payload.password),
        role=UserRole.STUDENT,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return RegisterResponse(id=user.id, email=user.email, role=user.role)


@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    normalized_email = _normalize_login_identifier(payload.email)
    user = get_user_by_email(db, normalized_email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    try:
        valid = pwd_context.verify(payload.password, user.hashed_password)
    except UnknownHashError:
        valid = False

    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    if pwd_context.needs_update(user.hashed_password):
        user.hashed_password = pwd_context.hash(payload.password)
        db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return TokenResponse(access_token=token)


@app.get("/feedback/token-status", response_model=TokenStatusResponse)
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


@app.post("/feedback/submit", response_model=FeedbackSubmitResponse)
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


@app.get("/dashboard/admin", response_model=AdminDashboardResponse)
def admin_dashboard(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AdminDashboardResponse:
    total_feedbacks = db.query(func.count(Feedback.id)).scalar() or 0
    avg_rating = db.query(func.avg(Feedback.rating)).scalar()
    total_tokens = db.query(func.count(FeedbackToken.id)).scalar() or 0
    used_tokens = (
        db.query(func.count(FeedbackToken.id))
        .filter(FeedbackToken.is_used.is_(True))
        .scalar()
        or 0
    )
    participation_rate = ((used_tokens / total_tokens) * 100.0) if total_tokens else 0.0
    pending_alerts = _pending_alerts_count(db)
    flagged_count = (
        db.query(func.count(Feedback.id))
        .filter(Feedback.is_flagged.is_(True))
        .scalar()
        or 0
    )
    toxicity_hit_rate = (flagged_count / total_feedbacks) if total_feedbacks else 0.0
    global_average = float(avg_rating) if avg_rating is not None else None

    cards = [
        KPICard(key="total_feedbacks", label="Total Feedbacks", value=str(total_feedbacks), icon="Users"),
        KPICard(
            key="global_average",
            label="Global Average",
            value=f"{global_average:.2f}" if global_average is not None else "-",
            icon="Star",
        ),
        KPICard(
            key="participation_rate",
            label="Participation Rate",
            value=f"{participation_rate:.1f}%",
            icon="Percent",
        ),
        KPICard(
            key="pending_alerts",
            label="Pending Alerts",
            value=str(pending_alerts),
            icon="AlertTriangle",
        ),
    ]

    return AdminDashboardResponse(
        total_feedbacks=total_feedbacks,
        global_average=global_average,
        participation_rate=participation_rate,
        pending_alerts=pending_alerts,
        kpi_cards=cards,
        avg_rating=global_average,
        toxicity_hit_rate=toxicity_hit_rate,
    )


@app.get("/dashboard/admin/lecturers", response_model=List[LecturerOption])
def list_lecturers(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[LecturerOption]:
    lecturers = (
        db.query(User)
        .filter(User.role == UserRole.LECTURER)
        .order_by(User.email.asc())
        .all()
    )
    return [LecturerOption(id=lecturer.id, email=lecturer.email) for lecturer in lecturers]


@app.get("/dashboard/admin/kpis", response_model=AdminDashboardResponse)
def admin_kpis(
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AdminDashboardResponse:
    return admin_dashboard(_user=user, db=db)


@app.get("/dashboard/admin/course-assignments", response_model=List[CourseAssignmentResponse])
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


@app.post("/dashboard/admin/course-assignments", response_model=CourseAssignmentResponse)
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

    course_code = _normalize_course_code(payload.course_code)
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
    _log_admin_action(
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


@app.delete("/dashboard/admin/course-assignments/{assignment_id}", response_model=ActionResponse)
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
    _log_admin_action(
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


def _generate_unique_token(db: Session) -> str:
    while True:
        token = secrets.token_urlsafe(16)
        exists = db.query(FeedbackToken).filter(FeedbackToken.token == token).first()
        if not exists:
            return token


@app.post("/dashboard/admin/tokens", response_model=TokenGenerateResponse)
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

    course_code = _normalize_course_code(payload.course_code)
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

    session_key = _normalize_session_key(payload.session_key)
    session_label = (
        payload.session_label.strip()
        if payload.session_label and payload.session_label.strip()
        else _default_session_label(course_code, session_key)
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

    _log_admin_action(
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


@app.get("/dashboard/admin/tokens", response_model=List[TokenListResponse])
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
        query = query.filter(FeedbackToken.course_code == _normalize_course_code(course_code))
    if lecturer_id:
        query = query.filter(FeedbackToken.lecturer_id == lecturer_id)
    if semester:
        _, _, start, end = _resolve_semester(semester)
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
                or _default_session_label(
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


@app.get("/dashboard/admin/tokens/tracker", response_model=List[TokenTrackerResponse])
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


@app.get("/dashboard/admin/ratings", response_model=List[LecturerRatingResponse])
def admin_ratings(
    search: Optional[str] = None,
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[LecturerRatingResponse]:
    query = (
        db.query(
            User.email,
            func.coalesce(func.avg(Feedback.rating), 0).label("avg_rating"),
            func.count(Feedback.id).label("total_feedbacks"),
        )
        .outerjoin(Feedback, Feedback.lecturer_id == User.id)
        .filter(User.role == UserRole.LECTURER)
    )
    if search:
        query = query.filter(User.email.ilike(f"%{search.strip()}%"))

    rows = query.group_by(User.id, User.email).order_by(User.email.asc()).all()

    return [
        LecturerRatingResponse(
            lecturer=row.email,
            avg_rating=float(row.avg_rating or 0),
            total_feedbacks=int(row.total_feedbacks or 0),
        )
        for row in rows
    ]


@app.get("/dashboard/admin/leaderboard", response_model=List[LeaderboardEntry])
def admin_leaderboard(
    search: Optional[str] = None,
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[LeaderboardEntry]:
    query = (
        db.query(
            User.id.label("lecturer_id"),
            User.email.label("lecturer"),
            func.coalesce(func.avg(Feedback.rating), 0).label("avg_rating"),
            func.count(Feedback.id).label("total_feedbacks"),
        )
        .outerjoin(Feedback, Feedback.lecturer_id == User.id)
        .filter(User.role == UserRole.LECTURER)
    )
    if search:
        query = query.filter(User.email.ilike(f"%{search.strip()}%"))

    rows = (
        query.group_by(User.id, User.email)
        .order_by(
            func.coalesce(func.avg(Feedback.rating), 0).desc(),
            func.count(Feedback.id).desc(),
            User.email.asc(),
        )
        .all()
    )

    return [
        LeaderboardEntry(
            rank=index,
            lecturer_id=row.lecturer_id,
            lecturer=row.lecturer,
            avg_rating=float(row.avg_rating or 0),
            total_feedbacks=int(row.total_feedbacks or 0),
        )
        for index, row in enumerate(rows, start=1)
    ]


@app.get("/dashboard/admin/toxicity-log", response_model=List[ToxicityLogEntry])
def admin_toxicity_log(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[ToxicityLogEntry]:
    flagged_count = _pending_alerts_count(db)
    if not flagged_count:
        return []
    return [ToxicityLogEntry(keyword="flagged", count=flagged_count, last_seen=None)]


@app.get("/dashboard/admin/toxicity-feed", response_model=List[ToxicityFeedEntry])
def toxicity_feed(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[ToxicityFeedEntry]:
    feedback_rows = (
        db.query(Feedback, User.email)
        .join(User, User.id == Feedback.lecturer_id)
        .outerjoin(FeedbackFlagReview, FeedbackFlagReview.feedback_id == Feedback.id)
        .filter(Feedback.is_flagged.is_(True), FeedbackFlagReview.id.is_(None))
        .order_by(Feedback.created_at.desc())
        .all()
    )
    feedback_items = [
        ToxicityFeedEntry(
            item_type="feedback",
            item_id=feedback.id,
            lecturer_id=feedback.lecturer_id,
            lecturer_email=email,
            course_code=feedback.course_code,
            comment=(feedback.text or "").strip(),
            created_at=feedback.created_at.isoformat(),
        )
        for feedback, email in feedback_rows
    ]
    rejected_rows = (
        db.query(ToxicityRejectedAttempt, User.email)
        .join(User, User.id == ToxicityRejectedAttempt.lecturer_id)
        .filter(ToxicityRejectedAttempt.is_reviewed.is_(False))
        .order_by(ToxicityRejectedAttempt.created_at.desc())
        .all()
    )
    rejected_items = [
        ToxicityFeedEntry(
            item_type="rejected_attempt",
            item_id=attempt.id,
            lecturer_id=attempt.lecturer_id,
            lecturer_email=email,
            course_code=attempt.course_code,
            comment=(attempt.text or "").strip(),
            created_at=attempt.created_at.isoformat(),
        )
        for attempt, email in rejected_rows
    ]

    merged = feedback_items + rejected_items
    merged.sort(key=lambda entry: entry.created_at, reverse=True)
    return merged


@app.post(
    "/dashboard/admin/toxicity-feed/{feedback_id}/dismiss",
    response_model=ActionResponse,
)
def dismiss_toxicity_flag(
    feedback_id: int,
    payload: Optional[DismissFlagRequest] = None,
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> ActionResponse:
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feedback item not found",
        )
    if not feedback.is_flagged:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Feedback is not currently flagged",
        )
    existing = (
        db.query(FeedbackFlagReview)
        .filter(FeedbackFlagReview.feedback_id == feedback.id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Feedback flag has already been reviewed",
        )

    review = FeedbackFlagReview(
        feedback_id=feedback.id,
        reviewed_by=user.id,
        action=FlagReviewAction.DISMISSED,
        note=payload.note.strip() if payload and payload.note else None,
    )
    feedback.is_flagged = False
    db.add(review)
    _log_admin_action(
        db,
        admin_id=user.id,
        action="FLAG_DISMISSED",
        entity_type="feedback",
        entity_id=str(feedback.id),
        details={"course_code": feedback.course_code, "lecturer_id": feedback.lecturer_id},
    )
    db.commit()
    return ActionResponse(message="Flag dismissed")


@app.post(
    "/dashboard/admin/toxicity-feed/rejected-attempts/{attempt_id}/dismiss",
    response_model=ActionResponse,
)
def dismiss_rejected_attempt(
    attempt_id: int,
    payload: Optional[DismissFlagRequest] = None,
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> ActionResponse:
    attempt = (
        db.query(ToxicityRejectedAttempt)
        .filter(ToxicityRejectedAttempt.id == attempt_id)
        .first()
    )
    if not attempt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rejected attempt not found",
        )
    if attempt.is_reviewed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rejected attempt has already been reviewed",
        )

    attempt.is_reviewed = True
    attempt.reviewed_at = datetime.now(timezone.utc)
    attempt.reviewed_by = user.id
    attempt.review_note = payload.note.strip() if payload and payload.note else None
    _log_admin_action(
        db,
        admin_id=user.id,
        action="REJECTED_ATTEMPT_DISMISSED",
        entity_type="rejected_attempt",
        entity_id=str(attempt.id),
        details={
            "course_code": attempt.course_code,
            "lecturer_id": attempt.lecturer_id,
        },
    )
    db.commit()
    return ActionResponse(message="Rejected attempt dismissed")


@app.get("/dashboard/admin/export/semester-summary")
def export_semester_summary(
    semester: Optional[str] = None,
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    sem_type, sem_year, start, end = _resolve_semester(semester)
    sem_label = _semester_label(sem_type, sem_year)
    sem_range = _semester_range_label(start, end)

    rows = (
        db.query(
            User.id.label("lecturer_id"),
            User.email.label("lecturer"),
            func.avg(Feedback.rating).label("avg_rating"),
            func.count(Feedback.id).label("total_feedbacks"),
        )
        .outerjoin(
            Feedback,
            (Feedback.lecturer_id == User.id)
            & (Feedback.created_at >= start)
            & (Feedback.created_at < end),
        )
        .filter(User.role == UserRole.LECTURER)
        .group_by(User.id, User.email)
        .order_by(User.email.asc())
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "semester",
            "range",
            "lecturer_id",
            "lecturer_email",
            "average_rating",
            "feedback_count",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                sem_label,
                sem_range,
                row.lecturer_id,
                row.lecturer,
                f"{float(row.avg_rating):.2f}" if row.avg_rating is not None else "",
                int(row.total_feedbacks or 0),
            ]
        )

    payload = output.getvalue()
    filename = f"semester-summary-{_semester_value(sem_type, sem_year).lower()}.csv"
    _log_admin_action(
        db,
        admin_id=user.id,
        action="EXPORT_SEMESTER_SUMMARY",
        entity_type="export",
        entity_id=filename,
        details={"semester": _semester_value(sem_type, sem_year)},
    )
    db.commit()
    return StreamingResponse(
        iter([payload]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/dashboard/admin/export/token-list")
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
        query = query.filter(FeedbackToken.course_code == _normalize_course_code(course_code))
    if lecturer_id:
        query = query.filter(FeedbackToken.lecturer_id == lecturer_id)
    if semester:
        _, _, start, end = _resolve_semester(semester)
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
            session_label or _default_session_label(token.course_code, resolved_session_key)
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
    _log_admin_action(
        db,
        admin_id=user.id,
        action="EXPORT_TOKEN_LIST",
        entity_type="export",
        entity_id="token-list.csv",
        details={
            "course_code": _normalize_course_code(course_code) if course_code else None,
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


@app.get("/dashboard/lecturer", response_model=LecturerDashboardResponse)
def lecturer_dashboard(
    semester: Optional[str] = None,
    course_code: Optional[str] = None,
    user: User = Depends(require_role(UserRole.LECTURER)),
    db: Session = Depends(get_db),
) -> LecturerDashboardResponse:
    now = datetime.now(timezone.utc)
    base_query = db.query(Feedback).filter(Feedback.lecturer_id == user.id)
    normalized_course = _normalize_course_code(course_code) if course_code else None
    scoped_query = base_query
    if normalized_course:
        scoped_query = scoped_query.filter(Feedback.course_code == normalized_course)

    breakdown_rows = (
        db.query(
            Feedback.course_code.label("course_code"),
            func.avg(Feedback.rating).label("avg_rating"),
            func.count(Feedback.id).label("count"),
        )
        .filter(Feedback.lecturer_id == user.id)
        .group_by(Feedback.course_code)
        .order_by(Feedback.course_code.asc())
        .all()
    )
    course_breakdown = [
        CourseBreakdown(
            course_code=row.course_code,
            avg_rating=float(row.avg_rating) if row.avg_rating is not None else None,
            count=int(row.count or 0),
        )
        for row in breakdown_rows
        if row.course_code
    ]
    assigned_courses = [
        row[0]
        for row in db.query(CourseAssignment.course_code)
        .filter(CourseAssignment.lecturer_id == user.id)
        .order_by(CourseAssignment.course_code.asc())
        .all()
    ]
    seen_courses = {item.course_code for item in course_breakdown}
    for code in assigned_courses:
        if code not in seen_courses:
            course_breakdown.append(
                CourseBreakdown(course_code=code, avg_rating=None, count=0)
            )
            seen_courses.add(code)
    course_breakdown.sort(key=lambda item: item.course_code)
    available_courses = sorted(seen_courses)

    min_created = (
        scoped_query.with_entities(func.min(Feedback.created_at)).scalar()
    )
    max_created = (
        scoped_query.with_entities(func.max(Feedback.created_at)).scalar()
    )

    if min_created and max_created:
        start_type, start_year = _semester_from_date(min_created)
        end_type, end_year = _semester_from_date(max_created)
    else:
        start_type, start_year = _semester_from_date(now)
        end_type, end_year = _semester_from_date(now)

    start_index = _semester_index(start_type, start_year)
    end_index = _semester_index(end_type, end_year)
    if end_index < start_index:
        start_index, end_index = end_index, start_index

    available_semesters: List[SemesterOption] = []
    for index in range(start_index, end_index + 1):
        sem_type, sem_year = _semester_from_index(index)
        sem_start, sem_end = _semester_window(sem_type, sem_year)
        available_semesters.append(
            SemesterOption(
                value=_semester_value(sem_type, sem_year),
                label=_semester_label(sem_type, sem_year),
                range=_semester_range_label(sem_start, sem_end),
            )
        )

    parsed = _parse_semester(semester) if semester else None
    if parsed:
        selected_type, selected_year = parsed
    else:
        selected_type, selected_year = _semester_from_date(now)

    selected_index = _semester_index(selected_type, selected_year)
    selected_start, selected_end = _semester_window(selected_type, selected_year)
    selected_label = _semester_label(selected_type, selected_year)
    selected_range = _semester_range_label(selected_start, selected_end)
    selected_value = _semester_value(selected_type, selected_year)

    prev_type, prev_year = _semester_from_index(selected_index - 1)
    prev_start, prev_end = _semester_window(prev_type, prev_year)
    prev_label = _semester_label(prev_type, prev_year)
    prev_range = _semester_range_label(prev_start, prev_end)

    if not any(option.value == selected_value for option in available_semesters):
        available_semesters.append(
            SemesterOption(
                value=selected_value,
                label=selected_label,
                range=selected_range,
            )
        )
        available_semesters.sort(
            key=lambda option: _semester_index(
                *_parse_semester(option.value)  # type: ignore[arg-type]
            )
        )

    current_feedbacks = (
        scoped_query.filter(Feedback.created_at >= selected_start)
        .filter(Feedback.created_at < selected_end)
        .count()
    )
    current_avg = (
        scoped_query.with_entities(func.avg(Feedback.rating))
        .filter(Feedback.created_at >= selected_start)
        .filter(Feedback.created_at < selected_end)
        .scalar()
    )
    previous_feedbacks = (
        scoped_query.filter(Feedback.created_at >= prev_start)
        .filter(Feedback.created_at < prev_end)
        .count()
    )
    previous_avg = (
        scoped_query.with_entities(func.avg(Feedback.rating))
        .filter(Feedback.created_at >= prev_start)
        .filter(Feedback.created_at < prev_end)
        .scalar()
    )
    distribution_rows = (
        scoped_query.with_entities(Feedback.rating, func.count(Feedback.id))
        .filter(Feedback.created_at >= selected_start)
        .filter(Feedback.created_at < selected_end)
        .group_by(Feedback.rating)
        .all()
    )
    distribution_map = {
        int(rating): int(count) for rating, count in distribution_rows if rating
    }
    rating_distribution = [distribution_map.get(value, 0) for value in range(1, 6)]
    distribution_total = sum(rating_distribution)
    negative_count = rating_distribution[0] + rating_distribution[1]
    neutral_count = rating_distribution[2]
    positive_count = rating_distribution[3] + rating_distribution[4]
    positive_pct = (positive_count / distribution_total * 100.0) if distribution_total else 0.0
    neutral_pct = (neutral_count / distribution_total * 100.0) if distribution_total else 0.0
    negative_pct = (negative_count / distribution_total * 100.0) if distribution_total else 0.0

    insight_delta = (
        float(current_avg) - float(previous_avg)
        if current_avg is not None and previous_avg is not None
        else None
    )

    total_feedbacks = scoped_query.count()
    total_avg = scoped_query.with_entities(func.avg(Feedback.rating)).scalar()

    feedbacks = (
        scoped_query.filter(Feedback.created_at >= selected_start)
        .filter(Feedback.created_at < selected_end)
        .order_by(Feedback.created_at.desc())
        .all()
    )
    cleaned_comments = [
        clean_feedback_text(f.text) for f in feedbacks if f.text and f.text.strip()
    ]

    return LecturerDashboardResponse(
        total_feedbacks=total_feedbacks,
        avg_rating=current_avg,
        cleaned_comments=cleaned_comments,
        current_semester=selected_label,
        current_semester_range=selected_range,
        previous_semester=prev_label,
        previous_semester_range=prev_range,
        current_avg_rating=current_avg,
        previous_avg_rating=previous_avg,
        current_feedbacks=current_feedbacks,
        previous_feedbacks=previous_feedbacks,
        total_avg_rating=total_avg,
        rating_distribution=rating_distribution,
        positive_pct=positive_pct,
        neutral_pct=neutral_pct,
        negative_pct=negative_pct,
        insight_delta=insight_delta,
        course_breakdown=course_breakdown,
        available_courses=available_courses,
        available_semesters=available_semesters,
        selected_semester=selected_value,
        selected_course=normalized_course,
        last_synced_at=now.isoformat(),
    )
