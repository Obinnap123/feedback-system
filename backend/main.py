from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional
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


class LecturerDashboardResponse(BaseModel):
    total_feedbacks: int
    avg_rating: Optional[float]
    cleaned_comments: List[str]


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
    user: User = Depends(require_role(UserRole.LECTURER)),
    db: Session = Depends(get_db),
) -> LecturerDashboardResponse:
    total_feedbacks = (
        db.query(func.count(Feedback.id))
        .filter(Feedback.lecturer_id == user.id)
        .scalar()
        or 0
    )
    avg_rating = (
        db.query(func.avg(Feedback.rating))
        .filter(Feedback.lecturer_id == user.id)
        .scalar()
    )

    feedbacks = (
        db.query(Feedback)
        .filter(Feedback.lecturer_id == user.id)
        .order_by(Feedback.created_at.desc())
        .all()
    )
    cleaned_comments = [
        clean_feedback_text(f.text) for f in feedbacks if f.text and f.text.strip()
    ]

    return LecturerDashboardResponse(
        total_feedbacks=total_feedbacks,
        avg_rating=avg_rating,
        cleaned_comments=cleaned_comments,
    )
