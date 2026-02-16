import axios, { AxiosInstance, AxiosRequestConfig } from "axios";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export const buildAuthHeaders = (token?: string) => {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

export default api;
