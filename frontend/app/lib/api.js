import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
});

export const submitFeedback = (payload, token) =>
  api.post("/feedback/submit", payload, {
    headers: buildAuthHeaders(token),
  });

export const fetchFeedbackTokenStatus = (authToken, feedbackToken) =>
  api.get("/feedback/token-status", {
    headers: buildAuthHeaders(authToken),
    params: { token: feedbackToken },
  });

const buildAuthHeaders = (token) =>
  token ? { Authorization: `Bearer ${token}` } : undefined;

export const loginUser = (payload) => api.post("/auth/login", payload);
export const registerUser = (payload) => api.post("/auth/register", payload);

export const fetchAdminDashboard = (token) =>
  api.get("/dashboard/admin", { headers: buildAuthHeaders(token) });

export const fetchLecturerDashboard = (token, params = {}) =>
  api.get("/dashboard/lecturer", {
    headers: buildAuthHeaders(token),
    params,
  });

export const fetchAdminRatings = (token) =>
  api.get("/dashboard/admin/ratings", { headers: buildAuthHeaders(token) });

export const fetchToxicityLog = (token) =>
  api.get("/dashboard/admin/toxicity-log", { headers: buildAuthHeaders(token) });

export const fetchAdminLecturers = (token) =>
  api.get("/dashboard/admin/lecturers", { headers: buildAuthHeaders(token) });

export const generateFeedbackTokens = (token, payload) =>
  api.post("/dashboard/admin/tokens", payload, {
    headers: buildAuthHeaders(token),
  });

export const fetchCourseAssignments = (token) =>
  api.get("/dashboard/admin/course-assignments", {
    headers: buildAuthHeaders(token),
  });

export const createCourseAssignment = (token, payload) =>
  api.post("/dashboard/admin/course-assignments", payload, {
    headers: buildAuthHeaders(token),
  });

export const deleteCourseAssignment = (token, assignmentId) =>
  api.delete(`/dashboard/admin/course-assignments/${assignmentId}`, {
    headers: buildAuthHeaders(token),
  });

export const fetchTokenTracker = (token) =>
  api.get("/dashboard/admin/tokens/tracker", {
    headers: buildAuthHeaders(token),
  });

export const fetchAdminLeaderboard = (token, params = {}) =>
  api.get("/dashboard/admin/leaderboard", {
    headers: buildAuthHeaders(token),
    params,
  });

export const fetchToxicityFeed = (token) =>
  api.get("/dashboard/admin/toxicity-feed", {
    headers: buildAuthHeaders(token),
  });

export const dismissToxicityFlag = (token, feedbackId, payload = {}) =>
  api.post(`/dashboard/admin/toxicity-feed/${feedbackId}/dismiss`, payload, {
    headers: buildAuthHeaders(token),
  });

export const dismissRejectedAttempt = (token, attemptId, payload = {}) =>
  api.post(
    `/dashboard/admin/toxicity-feed/rejected-attempts/${attemptId}/dismiss`,
    payload,
    {
      headers: buildAuthHeaders(token),
    },
  );

export const exportSemesterSummary = (token, params = {}) =>
  api.get("/dashboard/admin/export/semester-summary", {
    headers: buildAuthHeaders(token),
    params,
    responseType: "blob",
  });

export const exportTokenList = (token, params = {}) =>
  api.get("/dashboard/admin/export/token-list", {
    headers: buildAuthHeaders(token),
    params,
    responseType: "blob",
  });

export default api;
