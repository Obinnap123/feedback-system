import { AxiosResponse } from "axios";
import api, { buildAuthHeaders } from "./api";
import {
    AdminDashboardResponse,
    LecturerOption,
    LecturerRatingResponse,
    LeaderboardEntry,
    ToxicityLogEntry,
    ToxicityFeedEntry,
    CourseAssignmentResponse,
    TokenGenerateRequest,
    TokenGenerateResponse,
    TokenListResponse,
    TokenTrackerResponse,
} from "../types/dashboard";

export const adminService = {
    fetchDashboard: (token: string): Promise<AxiosResponse<AdminDashboardResponse>> => {
        return api.get("/dashboard/admin", { headers: buildAuthHeaders(token) });
    },

    listLecturers: (token: string): Promise<AxiosResponse<LecturerOption[]>> => {
        return api.get("/dashboard/admin/lecturers", { headers: buildAuthHeaders(token) });
    },

    fetchRatings: (token: string): Promise<AxiosResponse<LecturerRatingResponse[]>> => {
        return api.get("/dashboard/admin/ratings", { headers: buildAuthHeaders(token) });
    },

    fetchLeaderboard: (token: string): Promise<AxiosResponse<LeaderboardEntry[]>> => {
        return api.get("/dashboard/admin/leaderboard", { headers: buildAuthHeaders(token) });
    },

    fetchToxicityLog: (token: string): Promise<AxiosResponse<ToxicityLogEntry[]>> => {
        return api.get("/dashboard/admin/toxicity-log", { headers: buildAuthHeaders(token) });
    },

    fetchToxicityFeed: (token: string): Promise<AxiosResponse<ToxicityFeedEntry[]>> => {
        return api.get("/dashboard/admin/toxicity-feed", { headers: buildAuthHeaders(token) });
    },

    fetchCourseAssignments: (token: string): Promise<AxiosResponse<CourseAssignmentResponse[]>> => {
        return api.get("/dashboard/admin/course-assignments", { headers: buildAuthHeaders(token) });
    },

    createCourseAssignment: (
        token: string,
        payload: { lecturer_id: number; course_code: string }
    ): Promise<AxiosResponse<CourseAssignmentResponse>> => {
        return api.post("/dashboard/admin/course-assignments", payload, {
            headers: buildAuthHeaders(token),
        });
    },

    fetchTokens: (
        token: string,
        params: { course_code?: string; lecturer_id?: number; semester?: string } = {}
    ): Promise<AxiosResponse<TokenListResponse[]>> => {
        return api.get("/dashboard/admin/tokens", {
            headers: buildAuthHeaders(token),
            params,
        });
    },

    fetchTokenTracker: (token: string): Promise<AxiosResponse<TokenTrackerResponse[]>> => {
        return api.get("/dashboard/admin/tokens/tracker", {
            headers: buildAuthHeaders(token),
        });
    },

    exportTokenList: (
        token: string,
        params: { course_code?: string; lecturer_id?: number; semester?: string } = {}
    ): Promise<AxiosResponse<Blob>> => {
        return api.get("/dashboard/admin/export/token-list", {
            headers: buildAuthHeaders(token),
            params,
            responseType: "blob",
        });
    },

    exportSemesterSummary: (
        token: string,
        params: { semester?: string } = {}
    ): Promise<AxiosResponse<Blob>> => {
        return api.get("/dashboard/admin/export/semester-summary", {
            headers: buildAuthHeaders(token),
            params,
            responseType: "blob",
        });
    },

    deleteCourseAssignment: (
        token: string,
        assignmentId: number
    ): Promise<AxiosResponse<{ message: string }>> => {
        return api.delete(`/dashboard/admin/course-assignments/${assignmentId}`, {
            headers: buildAuthHeaders(token),
        });
    },

    generateTokens: (
        token: string,
        payload: TokenGenerateRequest
    ): Promise<AxiosResponse<TokenGenerateResponse>> => {
        return api.post("/dashboard/admin/tokens", payload, {
            headers: buildAuthHeaders(token),
        });
    },
};
