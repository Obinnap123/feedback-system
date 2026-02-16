from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field
from models import UserRole

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
