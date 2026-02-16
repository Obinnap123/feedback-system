import csv
import io
import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import (
    User,
    UserRole,
    Feedback,
    FeedbackFlagReview,
    FeedbackToken,
    ToxicityRejectedAttempt,
    CourseAssignment,
    FlagReviewAction,
)
from schemas import (
    AdminDashboardResponse,
    KPICard,
    LecturerOption,
    LecturerRatingResponse,
    LeaderboardEntry,
    ToxicityLogEntry,
    ToxicityFeedEntry,
    DismissFlagRequest,
    ActionResponse,
    LecturerDashboardResponse,
    CourseBreakdown,
    SemesterOption,
)
from dependencies import get_current_user, require_role
from utils import (
    log_admin_action,
    pending_alerts_count,
    resolve_semester,
    semester_label,
    semester_range_label,
    semester_value,
    semester_index,
    semester_from_date,
    semester_from_index,
    semester_window,
    parse_semester,
    normalize_course_code,
)

router = APIRouter(prefix="/dashboard", tags=["Analytics"])


@router.get("/admin", response_model=AdminDashboardResponse)
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
    pending_alerts = pending_alerts_count(db)
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


@router.get("/admin/lecturers", response_model=List[LecturerOption])
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


@router.get("/admin/kpis", response_model=AdminDashboardResponse)
def admin_kpis(
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AdminDashboardResponse:
    return admin_dashboard(_user=user, db=db)


@router.get("/admin/ratings", response_model=List[LecturerRatingResponse])
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


@router.get("/admin/leaderboard", response_model=List[LeaderboardEntry])
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


@router.get("/admin/toxicity-log", response_model=List[ToxicityLogEntry])
def admin_toxicity_log(
    _user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> List[ToxicityLogEntry]:
    flagged_count = pending_alerts_count(db)
    if not flagged_count:
        return []
    return [ToxicityLogEntry(keyword="flagged", count=flagged_count, last_seen=None)]


@router.get("/admin/toxicity-feed", response_model=List[ToxicityFeedEntry])
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


@router.post(
    "/admin/toxicity-feed/{feedback_id}/dismiss",
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
    log_admin_action(
        db,
        admin_id=user.id,
        action="FLAG_DISMISSED",
        entity_type="feedback",
        entity_id=str(feedback.id),
        details={"course_code": feedback.course_code, "lecturer_id": feedback.lecturer_id},
    )
    db.commit()
    return ActionResponse(message="Flag dismissed")


@router.post(
    "/admin/toxicity-feed/rejected-attempts/{attempt_id}/dismiss",
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
    log_admin_action(
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


@router.get("/admin/export/semester-summary")
def export_semester_summary(
    semester: Optional[str] = None,
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    sem_type, sem_year, start, end = resolve_semester(semester)
    sem_label = semester_label(sem_type, sem_year)
    sem_range = semester_range_label(start, end)

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
    filename = f"semester-summary-{semester_value(sem_type, sem_year).lower()}.csv"
    log_admin_action(
        db,
        admin_id=user.id,
        action="EXPORT_SEMESTER_SUMMARY",
        entity_type="export",
        entity_id=filename,
        details={"semester": semester_value(sem_type, sem_year)},
    )
    db.commit()
    return StreamingResponse(
        iter([payload]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/lecturer", response_model=LecturerDashboardResponse)
def lecturer_dashboard(
    semester: Optional[str] = None,
    course_code: Optional[str] = None,
    user: User = Depends(require_role(UserRole.LECTURER)),
    db: Session = Depends(get_db),
) -> LecturerDashboardResponse:
    now = datetime.now(timezone.utc)
    base_query = db.query(Feedback).filter(Feedback.lecturer_id == user.id)
    normalized_course = normalize_course_code(course_code) if course_code else None
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
    
    # Calculate semester range
    min_created = (
        scoped_query.with_entities(func.min(Feedback.created_at)).scalar()
    )
    max_created = (
        scoped_query.with_entities(func.max(Feedback.created_at)).scalar()
    )

    if min_created and max_created:
        start_type, start_year = semester_from_date(min_created)
        end_type, end_year = semester_from_date(max_created)
    else:
        start_type, start_year = semester_from_date(now)
        end_type, end_year = semester_from_date(now)

    start_index = semester_index(start_type, start_year)
    end_index = semester_index(end_type, end_year)
    if end_index < start_index:
        start_index, end_index = end_index, start_index

    available_semesters: List[SemesterOption] = []
    for index in range(start_index, end_index + 1):
        sem_type, sem_year = semester_from_index(index)
        sem_start, sem_end = semester_window(sem_type, sem_year)
        available_semesters.append(
            SemesterOption(
                value=semester_value(sem_type, sem_year),
                label=semester_label(sem_type, sem_year),
                range=semester_range_label(sem_start, sem_end),
            )
        )

    parsed = parse_semester(semester) if semester else None
    if parsed:
        selected_type, selected_year = parsed
    else:
        selected_type, selected_year = semester_from_date(now)

    selected_index = semester_index(selected_type, selected_year)
    selected_start, selected_end = semester_window(selected_type, selected_year)
    selected_label = semester_label(selected_type, selected_year)
    selected_range = semester_range_label(selected_start, selected_end)
    selected_value = semester_value(selected_type, selected_year)

    prev_type, prev_year = semester_from_index(selected_index - 1)
    prev_start, prev_end = semester_window(prev_type, prev_year)
    prev_label = semester_label(prev_type, prev_year)
    prev_range = semester_range_label(prev_start, prev_end)

    if not any(option.value == selected_value for option in available_semesters):
        available_semesters.append(
            SemesterOption(
                value=selected_value,
                label=selected_label,
                range=selected_range,
            )
        )
        available_semesters.sort(
            key=lambda option: semester_index(
                *parse_semester(option.value)  # type: ignore[arg-type]
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

    current_val = float(current_avg) if current_avg is not None else 0.0
    prev_val = float(previous_avg) if previous_avg is not None else 0.0
    insight_delta = current_val - prev_val if previous_avg is not None else None

    # Get recent comments (limit 50 for dashboard)
    recent_comments = (
        scoped_query.filter(Feedback.text.isnot(None))
        .filter(Feedback.created_at >= selected_start)
        .filter(Feedback.created_at < selected_end)
        .order_by(Feedback.created_at.desc())
        .limit(50)
        .all()
    )
    cleaned_comments = [
        comment.text.strip() for comment in recent_comments if comment.text 
        and not comment.is_flagged # Ensure we don't show flagged content
    ]

    return LecturerDashboardResponse(
        total_feedbacks=int(current_feedbacks),
        avg_rating=float(current_avg) if current_avg is not None else None,
        cleaned_comments=cleaned_comments,
        current_semester=selected_label,
        current_semester_range=selected_range,
        previous_semester=prev_label,
        previous_semester_range=prev_range,
        current_avg_rating=float(current_avg) if current_avg is not None else None,
        previous_avg_rating=float(previous_avg) if previous_avg is not None else None,
        current_feedbacks=int(current_feedbacks),
        previous_feedbacks=int(previous_feedbacks),
        total_avg_rating=float(current_avg) if current_avg is not None else None,
        rating_distribution=rating_distribution,
        positive_pct=positive_pct,
        neutral_pct=neutral_pct,
        negative_pct=negative_pct,
        insight_delta=insight_delta,
        course_breakdown=course_breakdown,
        available_courses=sorted(list(seen_courses)),
        available_semesters=available_semesters,
        selected_semester=selected_value,
        selected_course=normalized_course,
        last_synced_at=now.isoformat(),
    )
