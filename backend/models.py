from __future__ import annotations

import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class UserRole(str, enum.Enum):
    STUDENT = "STUDENT"
    LECTURER = "LECTURER"
    ADMIN = "ADMIN"


class FlagReviewAction(str, enum.Enum):
    DISMISSED = "DISMISSED"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole, name="user_role"), nullable=False, default=UserRole.STUDENT)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    lecturer_profile = relationship("LecturerProfile", back_populates="user", uselist=False)
    feedbacks_received = relationship(
        "Feedback", back_populates="lecturer", foreign_keys="Feedback.lecturer_id"
    )
    feedback_tokens = relationship(
        "FeedbackToken", back_populates="lecturer", foreign_keys="FeedbackToken.lecturer_id"
    )
    course_assignments = relationship(
        "CourseAssignment", back_populates="lecturer", foreign_keys="CourseAssignment.lecturer_id"
    )
    flag_reviews = relationship(
        "FeedbackFlagReview", back_populates="reviewer", foreign_keys="FeedbackFlagReview.reviewed_by"
    )
    admin_audit_logs = relationship(
        "AdminAuditLog", back_populates="admin", foreign_keys="AdminAuditLog.admin_id"
    )


class LecturerProfile(Base):
    __tablename__ = "lecturer_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    department = Column(String(255), nullable=False)
    bio = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="lecturer_profile")


class FeedbackToken(Base):
    __tablename__ = "feedback_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(128), unique=True, index=True, nullable=False)
    lecturer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_code = Column(String(50), nullable=False, index=True)
    is_used = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)

    lecturer = relationship("User", back_populates="feedback_tokens", foreign_keys=[lecturer_id])
    feedbacks = relationship("Feedback", back_populates="token")
    rejected_attempts = relationship("ToxicityRejectedAttempt", back_populates="token")
    session_metadata = relationship("TokenSession", back_populates="token", uselist=False)
    student_submissions = relationship(
        "StudentSessionSubmission", back_populates="token", foreign_keys="StudentSessionSubmission.token_id"
    )


class CourseAssignment(Base):
    __tablename__ = "course_assignments"
    __table_args__ = (
        UniqueConstraint("lecturer_id", "course_code", name="uq_course_assignments_lecturer_course"),
    )

    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_code = Column(String(50), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    lecturer = relationship("User", back_populates="course_assignments", foreign_keys=[lecturer_id])


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_id = Column(Integer, ForeignKey("feedback_tokens.id"), nullable=True, index=True)
    course_code = Column(String(50), nullable=False, index=True)
    rating = Column(Integer, nullable=False)
    text = Column(Text, nullable=True)
    sentiment_score = Column(Float, nullable=False, default=0.0)
    is_flagged = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    lecturer = relationship("User", back_populates="feedbacks_received", foreign_keys=[lecturer_id])
    token = relationship("FeedbackToken", back_populates="feedbacks")
    flag_review = relationship("FeedbackFlagReview", back_populates="feedback", uselist=False)


class FeedbackFlagReview(Base):
    __tablename__ = "feedback_flag_reviews"

    id = Column(Integer, primary_key=True, index=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id"), unique=True, nullable=False, index=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(
        Enum(FlagReviewAction, name="flag_review_action"),
        nullable=False,
        default=FlagReviewAction.DISMISSED,
    )
    note = Column(Text, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    feedback = relationship("Feedback", back_populates="flag_review")
    reviewer = relationship("User", back_populates="flag_reviews", foreign_keys=[reviewed_by])


class ToxicityRejectedAttempt(Base):
    __tablename__ = "toxicity_rejected_attempts"

    id = Column(Integer, primary_key=True, index=True)
    token_id = Column(Integer, ForeignKey("feedback_tokens.id"), nullable=False, index=True)
    lecturer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_code = Column(String(50), nullable=False, index=True)
    text = Column(Text, nullable=False)
    reason = Column(String(100), nullable=False, default="UNPROFESSIONAL_LANGUAGE")
    is_reviewed = Column(Boolean, nullable=False, default=False)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    review_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    token = relationship("FeedbackToken", back_populates="rejected_attempts", foreign_keys=[token_id])


class TokenSession(Base):
    __tablename__ = "token_sessions"

    id = Column(Integer, primary_key=True, index=True)
    token_id = Column(Integer, ForeignKey("feedback_tokens.id"), unique=True, nullable=False, index=True)
    course_code = Column(String(50), nullable=False, index=True)
    session_key = Column(String(32), nullable=False, index=True)
    session_label = Column(String(120), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    token = relationship("FeedbackToken", back_populates="session_metadata", foreign_keys=[token_id])


class StudentSessionSubmission(Base):
    __tablename__ = "student_session_submissions"
    __table_args__ = (
        UniqueConstraint(
            "anon_student_key",
            "course_code",
            "session_key",
            name="uq_student_session_submission_once",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    anon_student_key = Column(String(128), nullable=False, index=True)
    course_code = Column(String(50), nullable=False, index=True)
    session_key = Column(String(32), nullable=False, index=True)
    token_id = Column(Integer, ForeignKey("feedback_tokens.id"), nullable=False, index=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    token = relationship("FeedbackToken", back_populates="student_submissions", foreign_keys=[token_id])


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String(100), nullable=False, index=True)
    entity_type = Column(String(100), nullable=True, index=True)
    entity_id = Column(String(100), nullable=True, index=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    admin = relationship("User", back_populates="admin_audit_logs", foreign_keys=[admin_id])
