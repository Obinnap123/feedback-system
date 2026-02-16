export interface FeedbackSubmitRequest {
    token: string;
    rating: number;
    text?: string;
    sentiment_score?: number;
}

export interface FeedbackSubmitResponse {
    id: number;
    message: string;
    is_flagged: boolean;
}

export interface TokenStatusResponse {
    token: string;
    valid: boolean;
    is_used: boolean;
    can_submit: boolean;
    course_code?: string;
    lecturer_email?: string;
    session_key?: string;
    session_label?: string;
    reason?: string;
}
