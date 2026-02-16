export interface KPICard {
    key: string;
    label: string;
    value: string;
    icon: string;
}

export interface AdminDashboardResponse {
    total_feedbacks: number;
    global_average: number | null;
    participation_rate: number;
    pending_alerts: number;
    kpi_cards: KPICard[];
    avg_rating: number | null;
    toxicity_hit_rate: number;
}

export interface LecturerOption {
    id: number;
    email: string;
}

export interface LecturerRatingResponse {
    lecturer: string;
    avg_rating: number;
    total_feedbacks: number;
}

export interface LeaderboardEntry {
    rank: number;
    lecturer_id: number;
    lecturer: string;
    avg_rating: number;
    total_feedbacks: number;
}

export interface ToxicityLogEntry {
    keyword: string;
    count: number;
    last_seen: string | null;
}

export interface ToxicityFeedEntry {
    item_type: "feedback" | "rejected_attempt";
    item_id: number;
    lecturer_id: number;
    lecturer_email: string;
    course_code: string;
    comment: string;
    created_at: string;
}

export interface CourseAssignmentResponse {
    id: number;
    lecturer_id: number;
    lecturer_email: string;
    course_code: string;
    created_at: string;
}

export interface TokenListResponse {
    token: string;
    course_code: string;
    lecturer_id: number;
    lecturer_email: string;
    session_key: string;
    session_label: string;
    is_used: boolean;
    created_at: string;
    used_at: string | null;
}

export interface TokenTrackerResponse {
    course_code: string;
    used_tokens: number;
    total_tokens: number;
    usage_pct: number;
}

export interface CourseBreakdown {
    course_code: string;
    avg_rating: number | null;
    count: number;
}

export interface SemesterOption {
    value: string;
    label: string;
    range: string;
}

export interface LecturerDashboardResponse {
    total_feedbacks: number;
    avg_rating: number | null;
    cleaned_comments: string[];
    current_semester: string;
    current_semester_range: string;
    previous_semester: string;
    previous_semester_range: string;
    current_avg_rating: number | null;
    previous_avg_rating: number | null;
    current_feedbacks: number;
    previous_feedbacks: number;
    total_avg_rating: number | null;
    rating_distribution: number[];
    positive_pct: number;
    neutral_pct: number;
    negative_pct: number;
    insight_delta: number | null;
    course_breakdown: CourseBreakdown[];
    available_courses: string[];
    available_semesters: SemesterOption[];
    selected_semester: string;
    selected_course: string | null;
    last_synced_at: string;
}
export interface TokenGenerateRequest {
    lecturer_id: number;
    course_code: string;
    session_key: string;
    session_label?: string;
    quantity: number;
}

export interface TokenGenerateResponse {
    course_code: string;
    lecturer_id: number;
    session_key: string;
    session_label: string;
    tokens: string[];
}
