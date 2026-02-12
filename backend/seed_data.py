from __future__ import annotations

import argparse
import random
from datetime import datetime, timedelta, timezone

from database import SessionLocal
from models import Feedback, User, UserRole
from sqlalchemy.orm import Session


def _random_date(start: datetime, end: datetime) -> datetime:
    delta = end - start
    if delta.days <= 1:
        return start
    return start + timedelta(days=random.randint(0, delta.days - 1))


def _choose_lecturer(db: Session, email: str | None) -> User | None:
    query = db.query(User).filter(User.role == UserRole.LECTURER)
    if email:
        query = query.filter(User.email == email.lower())
    return query.first()


def seed(email: str | None) -> None:
    db = SessionLocal()
    try:
        lecturer = _choose_lecturer(db, email)
        if not lecturer:
            print("ERROR: Lecturer not found. Register a lecturer or pass --email.")
            return

        db.query(Feedback).filter(Feedback.lecturer_id == lecturer.id).delete()
        db.commit()

        previous_start = datetime(2025, 4, 1, tzinfo=timezone.utc)
        previous_end = datetime(2025, 10, 1, tzinfo=timezone.utc)
        current_start = datetime(2025, 10, 1, tzinfo=timezone.utc)
        current_end = datetime(2026, 4, 1, tzinfo=timezone.utc)

        csc_comments = [
            "Great practical examples used in class.",
            "The lecturer explains difficult ideas clearly.",
            "Very organized and approachable.",
            "Strong delivery and useful assignments.",
        ]
        gst_comments = [
            "Class is okay but needs better structure.",
            "Some topics were rushed and unclear.",
            "Average teaching, could be more engaging.",
            "Needs better pacing in lecture sessions.",
        ]

        # Previous semester (Rain 2025): create baseline for delta.
        for _ in range(10):
            db.add(
                Feedback(
                    lecturer_id=lecturer.id,
                    course_code="CSC401",
                    rating=random.choice([3, 3, 4, 4, 4]),
                    text=random.choice(csc_comments),
                    sentiment_score=random.uniform(0.55, 0.8),
                    is_flagged=False,
                    created_at=_random_date(previous_start, previous_end),
                )
            )

        for _ in range(5):
            db.add(
                Feedback(
                    lecturer_id=lecturer.id,
                    course_code="GST111",
                    rating=random.choice([2, 2, 3, 3, 3]),
                    text=random.choice(gst_comments),
                    sentiment_score=random.uniform(0.3, 0.55),
                    is_flagged=False,
                    created_at=_random_date(previous_start, previous_end),
                )
            )

        # Current semester (Harmattan 2025/2026): main presentation contrast.
        for _ in range(20):
            db.add(
                Feedback(
                    lecturer_id=lecturer.id,
                    course_code="CSC401",
                    rating=random.choice([4, 4, 5, 5, 5]),
                    text=random.choice(csc_comments),
                    sentiment_score=random.uniform(0.75, 0.98),
                    is_flagged=False,
                    created_at=_random_date(current_start, current_end),
                )
            )

        for _ in range(10):
            db.add(
                Feedback(
                    lecturer_id=lecturer.id,
                    course_code="GST111",
                    rating=random.choice([2, 2, 3, 3, 3]),
                    text=random.choice(gst_comments),
                    sentiment_score=random.uniform(0.25, 0.6),
                    is_flagged=False,
                    created_at=_random_date(current_start, current_end),
                )
            )

        db.commit()
        print("Seed complete:")
        print("Rain 2025 -> CSC401=10, GST111=5")
        print("Harmattan 2025/2026 -> CSC401=20, GST111=10")
        print(f"Lecturer: {lecturer.email}")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed lecturer feedback data by course.")
    parser.add_argument("--email", help="Lecturer email to seed")
    args = parser.parse_args()
    seed(args.email)


if __name__ == "__main__":
    main()
