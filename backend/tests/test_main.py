from datetime import datetime, timezone

import pytest

try:
    from backend.dependencies import create_access_token, pwd_context
    from backend.models import CourseAssignment, Feedback, User, UserRole
    from backend.tests.conftest import TestingSessionLocal
except ImportError:
    from dependencies import create_access_token, pwd_context
    from models import CourseAssignment, Feedback, User, UserRole
    from tests.conftest import TestingSessionLocal


def test_health_check(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "message": "Feedback System API is running"}


def test_lecturer_dashboard_uses_selected_previous_and_total_metrics(client):
    db = TestingSessionLocal()
    lecturer_id = None
    lecturer_email = ""
    try:
        lecturer = User(
            email="lecturer.metrics@example.com",
            hashed_password=pwd_context.hash("password123"),
            role=UserRole.LECTURER,
        )
        db.add(lecturer)
        db.commit()
        db.refresh(lecturer)
        lecturer_id = lecturer.id
        lecturer_email = lecturer.email

        db.add(CourseAssignment(lecturer_id=lecturer.id, course_code="CSC401"))
        db.add_all(
            [
                Feedback(
                    lecturer_id=lecturer.id,
                    course_code="CSC401",
                    rating=4,
                    text="Current semester comment",
                    created_at=datetime(2025, 4, 20, tzinfo=timezone.utc),
                ),
                Feedback(
                    lecturer_id=lecturer.id,
                    course_code="CSC401",
                    rating=2,
                    text="Another current semester comment",
                    created_at=datetime(2025, 5, 10, tzinfo=timezone.utc),
                ),
                Feedback(
                    lecturer_id=lecturer.id,
                    course_code="CSC401",
                    rating=5,
                    text="Previous semester comment",
                    created_at=datetime(2025, 2, 18, tzinfo=timezone.utc),
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    token = create_access_token({"sub": str(lecturer_id), "role": UserRole.LECTURER.value})
    response = client.get(
        "/dashboard/lecturer",
        headers={"Authorization": f"Bearer {token}"},
        params={"semester": "RAIN-2025", "course_code": "CSC401"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["viewed_lecturer_id"] == lecturer_id
    assert body["viewed_lecturer_email"] == lecturer_email
    assert body["current_feedbacks"] == 2
    assert body["previous_feedbacks"] == 1
    assert body["total_feedbacks"] == 3
    assert body["current_avg_rating"] == 3.0
    assert body["previous_avg_rating"] == 5.0
    assert body["total_avg_rating"] == pytest.approx(11 / 3, rel=1e-6)
    assert body["cleaned_comments"] == [
        "Another current semester comment",
        "Current semester comment",
    ]
    assert body["course_breakdown"] == [
        {"course_code": "CSC401", "avg_rating": 3.0, "count": 2}
    ]


def test_admin_can_view_lecturer_dashboard_with_explicit_lecturer_id(client):
    db = TestingSessionLocal()
    admin_id = None
    lecturer_id = None
    lecturer_email = ""
    try:
        admin = User(
            email="admin.viewer@example.com",
            hashed_password=pwd_context.hash("password123"),
            role=UserRole.ADMIN,
        )
        lecturer = User(
            email="lecturer.viewer@example.com",
            hashed_password=pwd_context.hash("password123"),
            role=UserRole.LECTURER,
        )
        db.add_all([admin, lecturer])
        db.commit()
        db.refresh(admin)
        db.refresh(lecturer)
        admin_id = admin.id
        lecturer_id = lecturer.id
        lecturer_email = lecturer.email

        db.add(
            Feedback(
                lecturer_id=lecturer.id,
                course_code="CSC499",
                rating=4,
                text="Admin visible comment",
                created_at=datetime(2025, 4, 12, tzinfo=timezone.utc),
            )
        )
        db.commit()
    finally:
        db.close()

    admin_token = create_access_token({"sub": str(admin_id), "role": UserRole.ADMIN.value})

    missing_param = client.get(
        "/dashboard/lecturer",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert missing_param.status_code == 400

    response = client.get(
        "/dashboard/lecturer",
        headers={"Authorization": f"Bearer {admin_token}"},
        params={"lecturer_id": lecturer_id, "semester": "RAIN-2025"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["viewed_lecturer_id"] == lecturer_id
    assert body["viewed_lecturer_email"] == lecturer_email
    assert body["current_feedbacks"] == 1
