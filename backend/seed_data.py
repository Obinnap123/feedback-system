from __future__ import annotations

import argparse
import random
import secrets
from datetime import datetime, timedelta, timezone

from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
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


pwd_context = CryptContext(schemes=["bcrypt", "pbkdf2_sha256"], deprecated="auto")

DEMO_ADMIN_EMAIL = "admin.demo@feedback.com"
DEMO_ADMIN_PASSWORD = "admin1234"

DEMO_LECTURERS = [
    ("ada.obi@feedback.com", ["CSC401", "CSC405"]),
    ("sam.okafor@feedback.com", ["GST111", "MTH201"]),
    ("zainab.sani@feedback.com", ["PHY101", "CHM102"]),
]

POSITIVE_COMMENTS = [
    "Very clear explanation and practical examples.",
    "Excellent course delivery and helpful office hours.",
    "Good pacing and quality materials.",
]
NEUTRAL_COMMENTS = [
    "The class is okay but could be more interactive.",
    "Average delivery; slides were useful though.",
]
NEGATIVE_COMMENTS = [
    "Lectures felt rushed and difficult to follow.",
    "Needs better structure and clearer expectations.",
]
TOXIC_COMMENTS = [
    "This lecture was damn annoying.",
    "The class was stupid and useless.",
    "Worst lecturer ever, nonsense delivery.",
]


def _default_session_label(course_code: str, session_key: str) -> str:
    return f"{course_code} Lecture {session_key}"


def _random_date(start: datetime, end: datetime) -> datetime:
    delta = end - start
    if delta.days <= 1:
        return start
    return start + timedelta(days=random.randint(0, delta.days - 1))


def _ensure_user(db: Session, email: str, role: UserRole, password: str) -> User:
    normalized = email.strip().lower()
    user = db.query(User).filter(User.email == normalized).first()
    if user:
        if user.role != role:
            user.role = role
            db.flush()
        return user

    user = User(
        email=normalized,
        hashed_password=pwd_context.hash(password),
        role=role,
    )
    db.add(user)
    db.flush()
    return user


def _clear_demo_data(db: Session, lecturer_ids: list[int]) -> None:
    if not lecturer_ids:
        return

    feedback_ids = [
        item[0]
        for item in db.query(Feedback.id)
        .filter(Feedback.lecturer_id.in_(lecturer_ids))
        .all()
    ]
    if feedback_ids:
        db.query(FeedbackFlagReview).filter(
            FeedbackFlagReview.feedback_id.in_(feedback_ids)
        ).delete(synchronize_session=False)

    token_ids = [
        item[0]
        for item in db.query(FeedbackToken.id)
        .filter(FeedbackToken.lecturer_id.in_(lecturer_ids))
        .all()
    ]

    if token_ids:
        db.query(StudentSessionSubmission).filter(
            StudentSessionSubmission.token_id.in_(token_ids)
        ).delete(synchronize_session=False)
        db.query(TokenSession).filter(TokenSession.token_id.in_(token_ids)).delete(
            synchronize_session=False
        )
    db.query(Feedback).filter(Feedback.lecturer_id.in_(lecturer_ids)).delete(
        synchronize_session=False
    )
    db.query(ToxicityRejectedAttempt).filter(
        ToxicityRejectedAttempt.lecturer_id.in_(lecturer_ids)
    ).delete(synchronize_session=False)
    db.query(FeedbackToken).filter(FeedbackToken.lecturer_id.in_(lecturer_ids)).delete(
        synchronize_session=False
    )
    db.query(CourseAssignment).filter(
        CourseAssignment.lecturer_id.in_(lecturer_ids)
    ).delete(synchronize_session=False)
    db.query(AdminAuditLog).delete(synchronize_session=False)


def _seed_for_assignment(
    db: Session,
    lecturer_id: int,
    course_code: str,
    previous_start: datetime,
    previous_end: datetime,
    current_start: datetime,
    current_end: datetime,
) -> tuple[int, int, int, int]:
    total_tokens = random.randint(24, 34)
    used_tokens = int(total_tokens * random.uniform(0.55, 0.82))
    pending_flagged = 0
    dismissed_flags = 0

    tokens: list[FeedbackToken] = []
    for _ in range(total_tokens):
        token = FeedbackToken(
            token=f"demo-{course_code.lower()}-{secrets.token_urlsafe(10)}",
            lecturer_id=lecturer_id,
            course_code=course_code,
            is_used=False,
            created_at=_random_date(previous_start, current_end),
        )
        db.add(token)
        tokens.append(token)
    db.flush()
    for token in tokens:
        session_key = (
            token.created_at.astimezone(timezone.utc).date().isoformat()
            if token.created_at
            else datetime.now(timezone.utc).date().isoformat()
        )
        db.add(
            TokenSession(
                token_id=token.id,
                course_code=course_code,
                session_key=session_key,
                session_label=_default_session_label(course_code, session_key),
            )
        )

    selected_tokens = random.sample(tokens, used_tokens)
    for index, token in enumerate(selected_tokens):
        in_current = index % 3 != 0
        created_at = (
            _random_date(current_start, current_end)
            if in_current
            else _random_date(previous_start, previous_end)
        )

        sentiment_roll = random.random()
        if sentiment_roll < 0.58:
            rating = random.choice([4, 5])
            text = random.choice(POSITIVE_COMMENTS)
            is_flagged = False
        elif sentiment_roll < 0.88:
            rating = random.choice([3, 4])
            text = random.choice(NEUTRAL_COMMENTS)
            is_flagged = False
        else:
            rating = random.choice([1, 2])
            text = random.choice(NEGATIVE_COMMENTS)
            is_flagged = False

        if index % 11 == 0:
            text = random.choice(TOXIC_COMMENTS)
            is_flagged = True

        feedback = Feedback(
            lecturer_id=lecturer_id,
            token_id=token.id,
            course_code=course_code,
            rating=rating,
            text=text,
            sentiment_score=float(rating) / 5.0,
            is_flagged=is_flagged,
            created_at=created_at,
        )
        db.add(feedback)
        db.flush()

        token.is_used = True
        token.used_at = created_at

        if is_flagged and index % 22 == 0:
            feedback.is_flagged = False
            review = FeedbackFlagReview(
                feedback_id=feedback.id,
                reviewed_by=lecturer_id,
                action=FlagReviewAction.DISMISSED,
                note="Demo dismissed for false positive",
                reviewed_at=created_at + timedelta(minutes=20),
            )
            db.add(review)
            dismissed_flags += 1
        elif is_flagged:
            pending_flagged += 1

    return total_tokens, used_tokens, pending_flagged, dismissed_flags


def seed(clear_existing: bool) -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        previous_start = datetime(2025, 4, 1, tzinfo=timezone.utc)
        previous_end = datetime(2025, 10, 1, tzinfo=timezone.utc)
        current_start = datetime(2025, 10, 1, tzinfo=timezone.utc)
        current_end = datetime(2026, 4, 1, tzinfo=timezone.utc)

        admin = _ensure_user(
            db,
            email=DEMO_ADMIN_EMAIL,
            role=UserRole.ADMIN,
            password=DEMO_ADMIN_PASSWORD,
        )

        lecturer_users: list[User] = []
        for lecturer_email, _ in DEMO_LECTURERS:
            lecturer_users.append(
                _ensure_user(
                    db,
                    email=lecturer_email,
                    role=UserRole.LECTURER,
                    password="lecturer1234",
                )
            )
        db.flush()

        lecturer_id_by_email = {user.email: user.id for user in lecturer_users}
        lecturer_ids = [user.id for user in lecturer_users]

        if clear_existing:
            _clear_demo_data(db, lecturer_ids)

        total_assignments = 0
        total_tokens = 0
        total_used = 0
        total_pending = 0
        total_dismissed = 0

        for lecturer_email, courses in DEMO_LECTURERS:
            lecturer_id = lecturer_id_by_email[lecturer_email]
            for course_code in courses:
                assignment = CourseAssignment(
                    lecturer_id=lecturer_id,
                    course_code=course_code,
                    created_at=_random_date(previous_start, current_start),
                )
                db.add(assignment)
                total_assignments += 1

                (
                    assignment_tokens,
                    assignment_used,
                    assignment_pending,
                    assignment_dismissed,
                ) = _seed_for_assignment(
                    db=db,
                    lecturer_id=lecturer_id,
                    course_code=course_code,
                    previous_start=previous_start,
                    previous_end=previous_end,
                    current_start=current_start,
                    current_end=current_end,
                )
                total_tokens += assignment_tokens
                total_used += assignment_used
                total_pending += assignment_pending
                total_dismissed += assignment_dismissed

        db.commit()
        participation = (total_used / total_tokens * 100.0) if total_tokens else 0.0

        print("Admin dashboard demo seed complete.")
        print(f"Admin login: {admin.email} / {DEMO_ADMIN_PASSWORD}")
        print(f"Lecturers seeded: {len(lecturer_users)}")
        print(f"Course assignments: {total_assignments}")
        print(f"Tokens: used {total_used} / total {total_tokens} ({participation:.1f}%)")
        print(f"Pending flagged comments: {total_pending}")
        print(f"Dismissed flagged comments: {total_dismissed}")
        print("Semesters covered: Rain 2025 and Harmattan 2025/2026")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed demo data for the admin dashboard."
    )
    parser.add_argument(
        "--no-clear",
        action="store_true",
        help="Do not clear prior demo records for demo lecturers before seeding.",
    )
    args = parser.parse_args()
    seed(clear_existing=not args.no_clear)


if __name__ == "__main__":
    main()
