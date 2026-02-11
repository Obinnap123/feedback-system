from __future__ import annotations

import enum

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class UserRole(str, enum.Enum):
    STUDENT = "STUDENT"
    LECTURER = "LECTURER"
    ADMIN = "ADMIN"


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
