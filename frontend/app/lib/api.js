import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
});

export const submitFeedback = (payload) => api.post("/feedback/submit", payload);

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

export default api;
