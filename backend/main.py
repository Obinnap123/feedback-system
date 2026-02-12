from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
import secrets

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import Feedback, FeedbackToken, User, UserRole
from utils import clean_feedback_text, enforce_toxicity_guard


SECRET_KEY = "change-me"
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
    email: EmailStr
    password: str = Field(min_length=6)
    role: UserRole = UserRole.STUDENT


class RegisterResponse(BaseModel):
    id: int
    email: EmailStr
    role: UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class FeedbackSubmitRequest(BaseModel):
    token: str
    rating: int
    text: Optional[str] = None
    sentiment_score: Optional[float] = 0.0


class FeedbackSubmitResponse(BaseModel):
    id: int
    message: str


class AdminDashboardResponse(BaseModel):
    total_feedbacks: int
    avg_rating: Optional[float]
    toxicity_hit_rate: float


class LecturerOption(BaseModel):
    id: int
    email: EmailStr


class TokenGenerateRequest(BaseModel):
    course_code: str = Field(min_length=2, max_length=50)
    lecturer_id: int
    quantity: int = Field(default=1, ge=1, le=500)


class TokenGenerateResponse(BaseModel):
    course_code: str
    lecturer_id: int
    tokens: List[str]


class LecturerRatingResponse(BaseModel):
    lecturer: str
    avg_rating: float
    total_feedbacks: int


class ToxicityLogEntry(BaseModel):
    keyword: str
    count: int
    last_seen: Optional[str] = None


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
    return db.query(User).filter(User.email == email).first()


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


@app.post("/auth/register", response_model=RegisterResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> RegisterResponse:
    if get_user_by_email(db, payload.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already registered",
        )

    user = User(
        email=payload.email,
        hashed_password=pwd_context.hash(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return RegisterResponse(id=user.id, email=user.email, role=user.role)


@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = get_user_by_email(db, payload.email)
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


@app.post("/feedback/submit", response_model=FeedbackSubmitResponse)
def submit_feedback(payload: FeedbackSubmitRequest, db: Session = Depends(get_db)) -> FeedbackSubmitResponse:
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

    enforce_toxicity_guard(payload.text)

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

    db.add(feedback)
    db.commit()
    db.refresh(feedback)

    return FeedbackSubmitResponse(id=feedback.id, message="Feedback submitted")


@app.get("/dashboard/admin", response_model=AdminDashboardResponse)
def admin_dashboard(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AdminDashboardResponse:
    total_feedbacks = db.query(func.count(Feedback.id)).scalar() or 0
    avg_rating = db.query(func.avg(Feedback.rating)).scalar()
    flagged_count = (
        db.query(func.count(Feedback.id))
        .filter(Feedback.is_flagged.is_(True))
        .scalar()
        or 0
    )
    toxicity_hit_rate = (flagged_count / total_feedbacks) if total_feedbacks else 0.0

    return AdminDashboardResponse(
        total_feedbacks=total_feedbacks,
        avg_rating=avg_rating,
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


def _generate_unique_token(db: Session) -> str:
    while True:
        token = secrets.token_urlsafe(16)
        exists = db.query(FeedbackToken).filter(FeedbackToken.token == token).first()
        if not exists:
            return token


@app.post("/dashboard/admin/tokens", response_model=TokenGenerateResponse)
def generate_tokens(
    payload: TokenGenerateRequest,
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> TokenGenerateResponse:
    lecturer = db.query(User).filter(User.id == payload.lecturer_id).first()
    if not lecturer or lecturer.role != UserRole.LECTURER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid lecturer selected",
        )

    course_code = payload.course_code.strip().upper()
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
        tokens.append(token_value)

    db.commit()

    return TokenGenerateResponse(
        course_code=course_code,
        lecturer_id=payload.lecturer_id,
        tokens=tokens,
    )


@app.get("/dashboard/admin/ratings", response_model=List[LecturerRatingResponse])
def admin_ratings(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[LecturerRatingResponse]:
    rows = (
        db.query(
            User.email,
            func.coalesce(func.avg(Feedback.rating), 0).label("avg_rating"),
            func.count(Feedback.id).label("total_feedbacks"),
        )
        .outerjoin(Feedback, Feedback.lecturer_id == User.id)
        .filter(User.role == UserRole.LECTURER)
        .group_by(User.id, User.email)
        .order_by(User.email.asc())
        .all()
    )

    return [
        LecturerRatingResponse(
            lecturer=row.email,
            avg_rating=float(row.avg_rating or 0),
            total_feedbacks=int(row.total_feedbacks or 0),
        )
        for row in rows
    ]


@app.get("/dashboard/admin/toxicity-log", response_model=List[ToxicityLogEntry])
def admin_toxicity_log(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[ToxicityLogEntry]:
    flagged_count = (
        db.query(func.count(Feedback.id))
        .filter(Feedback.is_flagged.is_(True))
        .scalar()
        or 0
    )
    if not flagged_count:
        return []
    return [ToxicityLogEntry(keyword="flagged", count=flagged_count, last_seen=None)]


@app.get("/dashboard/lecturer", response_model=LecturerDashboardResponse)
def lecturer_dashboard(
    semester: Optional[str] = None,
    course_code: Optional[str] = None,
    user: User = Depends(require_role(UserRole.LECTURER)),
    db: Session = Depends(get_db),
) -> LecturerDashboardResponse:
    now = datetime.now(timezone.utc)
    base_query = db.query(Feedback).filter(Feedback.lecturer_id == user.id)
    normalized_course = course_code.strip().upper() if course_code else None
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
    available_courses = [item.course_code for item in course_breakdown]

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
