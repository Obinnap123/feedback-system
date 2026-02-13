"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  Factory,
  Link2,
  Percent,
  Search,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import {
  createCourseAssignment,
  deleteCourseAssignment,
  dismissRejectedAttempt,
  dismissToxicityFlag,
  exportSemesterSummary,
  exportTokenList,
  fetchAdminDashboard,
  fetchAdminLeaderboard,
  fetchAdminLecturers,
  fetchCourseAssignments,
  fetchTokenTracker,
  fetchToxicityFeed,
  generateFeedbackTokens,
} from "../lib/api";

type AdminMetrics = {
  total_feedbacks: number;
  global_average: number | null;
  participation_rate: number;
  pending_alerts: number;
  avg_rating?: number | null;
};

type LecturerOption = {
  id: number;
  email: string;
};

type CourseAssignment = {
  id: number;
  lecturer_id: number;
  lecturer_email: string;
  course_code: string;
  created_at: string;
};

type TokenTrackerRow = {
  course_code: string;
  used_tokens: number;
  total_tokens: number;
  usage_pct: number;
};

type LeaderboardEntry = {
  rank: number;
  lecturer_id: number;
  lecturer: string;
  avg_rating: number;
  total_feedbacks: number;
};

type ToxicityFeedEntry = {
  item_type: "feedback" | "rejected_attempt";
  item_id: number;
  lecturer_id: number;
  lecturer_email: string;
  course_code: string;
  comment: string;
  created_at: string;
};

const formatRating = (value: number | null | undefined) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "-"
    : value.toFixed(2);

const formatPercent = (value: number | null | undefined) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "-"
    : `${value.toFixed(1)}%`;

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatDetail = (detail: unknown): string | null => {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          const maybeMsg = (item as { msg?: unknown }).msg;
          return typeof maybeMsg === "string" ? maybeMsg : null;
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));
    return messages.length ? messages.join("; ") : null;
  }
  if (detail && typeof detail === "object") {
    if ("msg" in detail) {
      const maybeMsg = (detail as { msg?: unknown }).msg;
      if (typeof maybeMsg === "string") return maybeMsg;
    }
    return JSON.stringify(detail);
  }
  return null;
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "Unable to complete request.";
  }

  const maybeAny = error as {
    response?: { data?: { detail?: unknown; error?: unknown } };
    message?: string;
  };
  const detailMessage = formatDetail(maybeAny.response?.data?.detail);
  const errorMessage = formatDetail(maybeAny.response?.data?.error);

  return (
    detailMessage ||
    errorMessage ||
    maybeAny.message ||
    "Unable to complete request."
  );
};

const getFilenameFromHeader = (
  headerValue: string | undefined,
  fallback: string,
) => {
  if (!headerValue) return fallback;
  const match = headerValue.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
};

const toBlob = (payload: unknown, fallbackType = "text/csv;charset=utf-8;") => {
  if (payload instanceof Blob) return payload;
  if (typeof payload === "string") {
    return new Blob([payload], { type: fallbackType });
  }
  return new Blob([JSON.stringify(payload ?? "")], { type: fallbackType });
};

const downloadBlob = (blobLike: unknown, filename: string, mimeType?: string) => {
  const blob = toBlob(blobLike, mimeType);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const getAsyncErrorMessage = async (error: unknown): Promise<string> => {
  const maybeAny = error as {
    response?: { data?: unknown };
  };
  const data = maybeAny?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      if (!text) return getErrorMessage(error);
      try {
        const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
        return formatDetail(parsed.detail) || formatDetail(parsed.error) || getErrorMessage(error);
      } catch {
        return text;
      }
    } catch {
      return getErrorMessage(error);
    }
  }
  return getErrorMessage(error);
};

type AdminDashboardProps = {
  embedded?: boolean;
};

export default function AdminDashboard({ embedded = false }: AdminDashboardProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [lecturers, setLecturers] = useState<LecturerOption[]>([]);
  const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
  const [trackerRows, setTrackerRows] = useState<TokenTrackerRow[]>([]);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardEntry[]>([]);
  const [toxicityRows, setToxicityRows] = useState<ToxicityFeedEntry[]>([]);

  const [assignmentCourseCode, setAssignmentCourseCode] = useState("");
  const [assignmentLecturerId, setAssignmentLecturerId] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);

  const [tokenCourseCode, setTokenCourseCode] = useState("");
  const [tokenLecturerId, setTokenLecturerId] = useState("");
  const [tokenQuantity, setTokenQuantity] = useState(10);
  const [generatedTokens, setGeneratedTokens] = useState<string[]>([]);
  const [isGeneratingTokens, setIsGeneratingTokens] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const [isExportingSemester, setIsExportingSemester] = useState(false);
  const [isExportingTokenList, setIsExportingTokenList] = useState(false);
  const [downloadingCourseCode, setDownloadingCourseCode] = useState<string | null>(null);
  const [exportSemester, setExportSemester] = useState("");
  const [exportCourseCode, setExportCourseCode] = useState("");

  const getAuthToken = () => {
    if (typeof document === "undefined") return "";
    const cookies = document.cookie.split("; ").map((item) => item.trim());
    const tokenCookie = cookies.find(
      (cookie) =>
        cookie.startsWith("access_token=") ||
        cookie.startsWith("token=") ||
        cookie.startsWith("jwt="),
    );
    if (tokenCookie) {
      return tokenCookie.split("=")[1] || "";
    }
    if (typeof localStorage !== "undefined") {
      return (
        localStorage.getItem("access_token") ||
        localStorage.getItem("token") ||
        localStorage.getItem("jwt") ||
        ""
      );
    }
    return "";
  };

  const handleUnauthorized = useCallback((reasons: unknown[]) => {
    const hasUnauthorized = reasons.some((reason) => {
      const candidate = reason as { response?: { status?: number } };
      return candidate.response?.status === 401;
    });
    if (hasUnauthorized) {
      router.push("/login");
      return true;
    }
    return false;
  }, [router]);

  const loadLeaderboard = useCallback(async (activeToken: string, search: string) => {
    setIsSearching(true);
    try {
      const response = await fetchAdminLeaderboard(activeToken, {
        search: search.trim() || undefined,
      });
      setLeaderboardRows(response.data || []);
    } catch (errorResponse) {
      if (handleUnauthorized([errorResponse])) return;
      setError(getErrorMessage(errorResponse));
      setLeaderboardRows([]);
    } finally {
      setIsSearching(false);
    }
  }, [handleUnauthorized]);

  const loadDashboard = useCallback(async (activeToken: string, search: string) => {
    setLoading(true);
    setError(null);

    const results = await Promise.allSettled([
      fetchAdminDashboard(activeToken),
      fetchAdminLecturers(activeToken),
      fetchCourseAssignments(activeToken),
      fetchTokenTracker(activeToken),
      fetchAdminLeaderboard(activeToken, { search: search.trim() || undefined }),
      fetchToxicityFeed(activeToken),
    ]);

    const rejectedReasons = results
      .filter((item): item is PromiseRejectedResult => item.status === "rejected")
      .map((item) => item.reason);
    if (handleUnauthorized(rejectedReasons)) {
      setLoading(false);
      return;
    }

    const [
      metricsResult,
      lecturersResult,
      assignmentsResult,
      trackerResult,
      leaderboardResult,
      toxicityResult,
    ] = results;

    if (metricsResult.status === "fulfilled") {
      setMetrics(metricsResult.value.data);
    } else {
      setMetrics(null);
      setError(getErrorMessage(metricsResult.reason));
    }

    if (lecturersResult.status === "fulfilled") {
      setLecturers(lecturersResult.value.data || []);
    } else {
      setLecturers([]);
    }

    if (assignmentsResult.status === "fulfilled") {
      setAssignments(assignmentsResult.value.data || []);
    } else {
      setAssignments([]);
    }

    if (trackerResult.status === "fulfilled") {
      setTrackerRows(trackerResult.value.data || []);
    } else {
      setTrackerRows([]);
    }

    if (leaderboardResult.status === "fulfilled") {
      setLeaderboardRows(leaderboardResult.value.data || []);
    } else {
      setLeaderboardRows([]);
    }

    if (toxicityResult.status === "fulfilled") {
      setToxicityRows(toxicityResult.value.data || []);
    } else {
      setToxicityRows([]);
    }

    setLoading(false);
  }, [handleUnauthorized]);

  useEffect(() => {
    const authToken = getAuthToken();
    if (!authToken) {
      router.push("/login");
      return;
    }
    setToken(authToken);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    void loadDashboard(token, "");
  }, [loadDashboard, token]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => {
      void loadLeaderboard(token, searchTerm);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadLeaderboard, searchTerm, token]);

  const refreshDashboard = useCallback(async () => {
    if (!token) return;
    await loadDashboard(token, searchTerm);
  }, [loadDashboard, searchTerm, token]);

  const handleCreateAssignment = async () => {
    if (!token) return;
    if (!assignmentCourseCode.trim() || !assignmentLecturerId) {
      setError("Select a lecturer and enter a course code.");
      return;
    }

    setIsAssigning(true);
    setError(null);
    try {
      await createCourseAssignment(token, {
        lecturer_id: Number(assignmentLecturerId),
        course_code: assignmentCourseCode.trim(),
      });
      setAssignmentCourseCode("");
      await refreshDashboard();
    } catch (errorResponse) {
      setError(getErrorMessage(errorResponse));
    } finally {
      setIsAssigning(false);
    }
  };

  const handleDeleteAssignment = async (assignmentId: number) => {
    if (!token) return;
    setError(null);
    try {
      await deleteCourseAssignment(token, assignmentId);
      await refreshDashboard();
    } catch (errorResponse) {
      setError(getErrorMessage(errorResponse));
    }
  };

  const handleGenerateTokens = async () => {
    if (!token) return;
    if (!tokenCourseCode.trim() || !tokenLecturerId) {
      setError("Select a lecturer and course for token generation.");
      return;
    }
    if (tokenQuantity < 1 || tokenQuantity > 500) {
      setError("Quantity must be between 1 and 500.");
      return;
    }

    setIsGeneratingTokens(true);
    setError(null);
    try {
      const response = await generateFeedbackTokens(token, {
        lecturer_id: Number(tokenLecturerId),
        course_code: tokenCourseCode.trim(),
        quantity: tokenQuantity,
      });
      setGeneratedTokens(response.data?.tokens || []);
      await refreshDashboard();
    } catch (errorResponse) {
      setError(getErrorMessage(errorResponse));
    } finally {
      setIsGeneratingTokens(false);
    }
  };

  const handleSearchLeaderboard = async () => {
    if (!token) return;
    await loadLeaderboard(token, searchTerm);
  };

  const renderLecturerLabel = (lecturer: string) => {
    const query = searchTerm.trim();
    if (!query) return lecturer;
    const lowerLecturer = lecturer.toLowerCase();
    const lowerQuery = query.toLowerCase();
    if (!lowerLecturer.startsWith(lowerQuery)) return lecturer;
    const prefix = lecturer.slice(0, query.length);
    const rest = lecturer.slice(query.length);
    return (
      <>
        <span className="font-semibold text-emerald-300">{prefix}</span>
        {rest}
      </>
    );
  };

  const handleDismissFlag = async (feedbackId: number) => {
    if (!token) return;
    setError(null);
    try {
      await dismissToxicityFlag(token, feedbackId, {});
      await refreshDashboard();
    } catch (errorResponse) {
      setError(getErrorMessage(errorResponse));
    }
  };

  const handleDismissRejectedAttempt = async (attemptId: number) => {
    if (!token) return;
    setError(null);
    try {
      await dismissRejectedAttempt(token, attemptId, {});
      await refreshDashboard();
    } catch (errorResponse) {
      setError(getErrorMessage(errorResponse));
    }
  };

  const handleExportSemesterSummary = async () => {
    if (!token) return;
    setIsExportingSemester(true);
    setError(null);
    try {
      const response = await exportSemesterSummary(token, {
        semester: exportSemester.trim() || undefined,
      });
      const filename = getFilenameFromHeader(
        response.headers["content-disposition"],
        "semester-summary.csv",
      );
      downloadBlob(
        response.data,
        filename,
        response.headers["content-type"] || "text/csv;charset=utf-8;",
      );
    } catch (errorResponse) {
      setError(await getAsyncErrorMessage(errorResponse));
    } finally {
      setIsExportingSemester(false);
    }
  };

  const handleExportTokenList = async () => {
    if (!token) return;
    setIsExportingTokenList(true);
    setError(null);
    try {
      const response = await exportTokenList(token, {
        semester: exportSemester.trim() || undefined,
        course_code: exportCourseCode.trim() || undefined,
      });
      const filename = getFilenameFromHeader(
        response.headers["content-disposition"],
        "token-list.csv",
      );
      downloadBlob(
        response.data,
        filename,
        response.headers["content-type"] || "text/csv;charset=utf-8;",
      );
    } catch (errorResponse) {
      setError(await getAsyncErrorMessage(errorResponse));
    } finally {
      setIsExportingTokenList(false);
    }
  };

  const handleExportTokenListForCourse = async (courseCode: string) => {
    if (!token) return;
    setDownloadingCourseCode(courseCode);
    setError(null);
    try {
      const response = await exportTokenList(token, {
        semester: exportSemester.trim() || undefined,
        course_code: courseCode,
      });
      const filename = getFilenameFromHeader(
        response.headers["content-disposition"],
        `token-list-${courseCode.toLowerCase()}.csv`,
      );
      downloadBlob(
        response.data,
        filename,
        response.headers["content-type"] || "text/csv;charset=utf-8;",
      );
    } catch (errorResponse) {
      setError(await getAsyncErrorMessage(errorResponse));
    } finally {
      setDownloadingCourseCode(null);
    }
  };

  const globalAverage = metrics?.global_average ?? metrics?.avg_rating ?? null;
  const latestGeneratedCount = generatedTokens.length;
  const latestGeneratedPreview = generatedTokens.slice(0, 10);

  const kpiCards = [
    {
      label: "Total Feedbacks",
      value: metrics ? metrics.total_feedbacks.toLocaleString() : "-",
      Icon: Users,
      iconClass: "text-sky-300",
    },
    {
      label: "Global Average",
      value: formatRating(globalAverage),
      Icon: Star,
      iconClass: "text-amber-300",
    },
    {
      label: "Participation Rate",
      value: formatPercent(metrics?.participation_rate),
      Icon: Percent,
      iconClass: "text-emerald-300",
    },
    {
      label: "Pending Alerts",
      value: metrics ? metrics.pending_alerts.toLocaleString() : "-",
      Icon: AlertTriangle,
      iconClass: "text-rose-300",
    },
  ];

  return (
    <div
      className={
        embedded
          ? "text-slate-100"
          : "min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100"
      }
    >
      <div
        className={
          embedded
            ? "flex w-full flex-col gap-6 px-3 py-6 sm:gap-8 sm:px-4 sm:py-8 lg:px-6 lg:py-10"
            : "mx-auto flex w-full max-w-7xl flex-col gap-6 px-3 py-6 sm:gap-8 sm:px-4 sm:py-8 lg:px-6 lg:py-10"
        }
      >
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Admin Dashboard
          </p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            Operations Console
          </h1>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpiCards.map(({ label, value, Icon, iconClass }) => (
            <div
              key={label}
              className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/40"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">{label}</p>
                <Icon className={`h-5 w-5 ${iconClass}`} />
              </div>
              <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid items-start gap-6 xl:grid-cols-2">
          <div className="h-fit rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/40 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Course Assignment Manager</p>
                <h2 className="text-lg font-semibold text-white">
                  Link Lecturer to Course
                </h2>
              </div>
              <Link2 className="h-5 w-5 text-cyan-300" />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
              <select
                className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-500/30"
                value={assignmentLecturerId}
                onChange={(event) => setAssignmentLecturerId(event.target.value)}
              >
                <option value="">Select lecturer</option>
                {lecturers.map((lecturer) => (
                  <option key={lecturer.id} value={lecturer.id}>
                    {lecturer.email}
                  </option>
                ))}
              </select>
              <input
                className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-500/30"
                placeholder="Course code (e.g. CSC401)"
                value={assignmentCourseCode}
                onChange={(event) => setAssignmentCourseCode(event.target.value)}
              />
              <button
                type="button"
                onClick={handleCreateAssignment}
                disabled={isAssigning}
                className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2 xl:col-span-1"
              >
                {isAssigning ? "Linking..." : "Link"}
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/40 p-2">
              {assignments.length === 0 ? (
                <div className="py-6 text-center text-sm text-slate-500">
                  No assignments yet. Link a lecturer to a course to start issuing tokens.
                </div>
              ) : (
                <>
                  <div className="max-h-56 space-y-2 overflow-auto pr-1 scrollbar-hidden md:hidden">
                    {assignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="rounded-lg border border-slate-800/70 bg-slate-950/70 p-3"
                      >
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          {assignment.course_code}
                        </p>
                        <p className="mt-1 text-sm text-slate-200">{assignment.lecturer_email}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDate(assignment.created_at)}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleDeleteAssignment(assignment.id)}
                          className="mt-2 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="hidden max-h-56 overflow-auto pr-1 scrollbar-hidden md:block">
                    <table className="w-full min-w-[500px] text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-950/95 text-xs uppercase text-slate-400 backdrop-blur">
                        <tr>
                          <th className="py-2 pr-4">Course</th>
                          <th className="py-2 pr-4">Lecturer</th>
                          <th className="py-2 pr-4">Created</th>
                          <th className="py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-200">
                        {assignments.map((assignment) => (
                          <tr
                            key={assignment.id}
                            className="border-t border-slate-800/70"
                          >
                            <td className="py-3 pr-4">{assignment.course_code}</td>
                            <td className="py-3 pr-4">{assignment.lecturer_email}</td>
                            <td className="py-3 pr-4 text-slate-400">
                              {formatDate(assignment.created_at)}
                            </td>
                            <td className="py-3">
                              <button
                                type="button"
                                onClick={() => handleDeleteAssignment(assignment.id)}
                                className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="h-fit rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/40 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Token Factory & Tracker</p>
                <h2 className="text-lg font-semibold text-white">
                  Generate and Monitor Token Usage
                </h2>
              </div>
              <Factory className="h-5 w-5 text-indigo-300" />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Course code"
                value={tokenCourseCode}
                onChange={(event) => setTokenCourseCode(event.target.value)}
              />
              <select
                className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                value={tokenLecturerId}
                onChange={(event) => setTokenLecturerId(event.target.value)}
              >
                <option value="">Select lecturer</option>
                {lecturers.map((lecturer) => (
                  <option key={lecturer.id} value={lecturer.id}>
                    {lecturer.email}
                  </option>
                ))}
              </select>
              <input
                className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                type="number"
                min={1}
                max={500}
                value={tokenQuantity}
                onChange={(event) =>
                  setTokenQuantity(Number(event.target.value || 1))
                }
              />
              <button
                type="button"
                onClick={handleGenerateTokens}
                disabled={isGeneratingTokens}
                className="rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGeneratingTokens ? "Generating..." : "Generate Batch"}
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-800/70 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
                Latest Token Batch
              </p>
              {latestGeneratedCount === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  No batch generated in this session yet. Use course-level Download CSV for distribution.
                </p>
              ) : (
                <div className="mt-2">
                  <p className="text-sm text-emerald-200">
                    {latestGeneratedCount} tokens generated in the latest batch.
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
                      Preview first {latestGeneratedPreview.length} tokens
                    </summary>
                    <div className="mt-2 max-h-24 overflow-y-auto rounded-lg border border-slate-800/70 bg-slate-950/70 p-2 font-mono text-xs text-emerald-200">
                      {latestGeneratedPreview.map((tokenValue) => (
                        <div key={tokenValue}>{tokenValue}</div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/40 p-2">
              {trackerRows.length === 0 ? (
                <div className="py-6 text-center text-sm text-slate-500">
                  No token activity yet. Generate a token batch to populate usage tracking.
                </div>
              ) : (
                <>
                  <div className="max-h-64 space-y-2 overflow-auto pr-1 scrollbar-hidden md:hidden">
                    {trackerRows.map((row) => (
                      <div
                        key={row.course_code}
                        className="rounded-lg border border-slate-800/70 bg-slate-950/70 p-3"
                      >
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          {row.course_code}
                        </p>
                        <p className="mt-1 text-sm text-slate-200">
                          Used {row.used_tokens} / {row.total_tokens} ({formatPercent(row.usage_pct)})
                        </p>
                        <button
                          type="button"
                          onClick={() => handleExportTokenListForCourse(row.course_code)}
                          disabled={downloadingCourseCode === row.course_code}
                          className="mt-2 rounded-lg border border-indigo-400/50 px-3 py-1.5 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {downloadingCourseCode === row.course_code
                            ? "Exporting..."
                            : "Download CSV"}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="hidden max-h-64 overflow-auto pr-1 scrollbar-hidden md:block">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-950/95 text-xs uppercase text-slate-400 backdrop-blur">
                        <tr>
                          <th className="py-2 pr-4">Course</th>
                          <th className="py-2 pr-4">Used</th>
                          <th className="py-2 pr-4">Total</th>
                          <th className="py-2 pr-4">Used %</th>
                          <th className="py-2">Export</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-200">
                        {trackerRows.map((row) => (
                          <tr key={row.course_code} className="border-t border-slate-800/70">
                            <td className="py-3 pr-4">{row.course_code}</td>
                            <td className="py-3 pr-4">{row.used_tokens}</td>
                            <td className="py-3 pr-4">{row.total_tokens}</td>
                            <td className="py-3 pr-4">{formatPercent(row.usage_pct)}</td>
                            <td className="py-3">
                              <button
                                type="button"
                                onClick={() => handleExportTokenListForCourse(row.course_code)}
                                disabled={downloadingCourseCode === row.course_code}
                                className="rounded-lg border border-indigo-400/50 px-3 py-1.5 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {downloadingCourseCode === row.course_code
                                  ? "Exporting..."
                                  : "Download CSV"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/40 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-400">Global Search & Leaderboard</p>
              <h2 className="text-lg font-semibold text-white">
                Lecturer Ratings and Feedback Counts
              </h2>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <input
                className="w-full rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-500/30 sm:w-72"
                placeholder="Search lecturer email..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSearchLeaderboard();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleSearchLeaderboard}
                disabled={isSearching}
                className="rounded-xl border border-emerald-400/50 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Search
                </span>
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/40 p-2">
            {leaderboardRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">
                No lecturers found for this search yet.
              </div>
            ) : (
              <>
                <div className="max-h-64 space-y-2 overflow-auto pr-1 scrollbar-hidden md:hidden">
                  {leaderboardRows.map((row) => (
                    <div
                      key={row.lecturer_id}
                      className="rounded-lg border border-slate-800/70 bg-slate-950/70 p-3"
                    >
                      <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">#{row.rank}</p>
                      <p className="mt-1 text-sm text-slate-100">{renderLecturerLabel(row.lecturer)}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Avg: {formatRating(row.avg_rating)} | Feedbacks: {row.total_feedbacks}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="hidden max-h-64 overflow-auto pr-1 scrollbar-hidden md:block">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-950/95 text-xs uppercase text-slate-400 backdrop-blur">
                      <tr>
                        <th className="py-2 pr-4">Rank</th>
                        <th className="py-2 pr-4">Lecturer</th>
                        <th className="py-2 pr-4">Average Rating</th>
                        <th className="py-2">Total Feedbacks</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-200">
                      {leaderboardRows.map((row) => (
                        <tr key={row.lecturer_id} className="border-t border-slate-800/70">
                          <td className="py-3 pr-4 font-semibold text-emerald-300">
                            #{row.rank}
                          </td>
                          <td className="py-3 pr-4">{renderLecturerLabel(row.lecturer)}</td>
                          <td className="py-3 pr-4">{formatRating(row.avg_rating)}</td>
                          <td className="py-3">{row.total_feedbacks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/40 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">The Toxicity Feed</p>
              <h2 className="text-lg font-semibold text-white">
                AI-Flagged Comments Pending Review
              </h2>
            </div>
            <AlertTriangle className="h-5 w-5 text-rose-300" />
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/40 p-2">
            {toxicityRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">
                No pending alerts.
              </div>
            ) : (
              <>
                <div className="max-h-64 space-y-2 overflow-auto pr-1 scrollbar-hidden md:hidden">
                  {toxicityRows.map((row) => (
                    <div
                      key={`${row.item_type}-${row.item_id}`}
                      className="rounded-lg border border-slate-800/70 bg-slate-950/70 p-3"
                    >
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                        {row.item_type === "feedback" ? "Flagged feedback" : "Rejected attempt"}
                      </p>
                      <p className="text-sm text-slate-100">{row.comment || "-"}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {row.lecturer_email} | {row.course_code}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{formatDate(row.created_at)}</p>
                      <button
                        type="button"
                        onClick={() =>
                          row.item_type === "feedback"
                            ? handleDismissFlag(row.item_id)
                            : handleDismissRejectedAttempt(row.item_id)
                        }
                        className="mt-2 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Trash2 className="h-3.5 w-3.5" />
                          Dismiss
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="hidden max-h-64 overflow-auto pr-1 scrollbar-hidden md:block">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-950/95 text-xs uppercase text-slate-400 backdrop-blur">
                      <tr>
                        <th className="py-2 pr-4">Comment</th>
                        <th className="py-2 pr-4">Lecturer</th>
                        <th className="py-2 pr-4">Course</th>
                        <th className="py-2 pr-4">Created</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-200">
                      {toxicityRows.map((row) => (
                        <tr key={`${row.item_type}-${row.item_id}`} className="border-t border-slate-800/70">
                          <td className="max-w-[340px] py-3 pr-4 text-slate-100">
                            {row.comment || "-"}
                          </td>
                          <td className="py-3 pr-4">{row.lecturer_email}</td>
                          <td className="py-3 pr-4">{row.course_code}</td>
                          <td className="py-3 pr-4 text-slate-400">
                            {formatDate(row.created_at)}
                          </td>
                          <td className="py-3">
                            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                              {row.item_type === "feedback" ? "Feedback" : "Rejected"}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                row.item_type === "feedback"
                                  ? handleDismissFlag(row.item_id)
                                  : handleDismissRejectedAttempt(row.item_id)
                              }
                              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                            >
                              <span className="inline-flex items-center gap-1">
                                <Trash2 className="h-3.5 w-3.5" />
                                Dismiss
                              </span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/40 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Export Center</p>
              <h2 className="text-lg font-semibold text-white">
                Semester Summary and Token List
              </h2>
            </div>
            <button
              type="button"
              onClick={handleExportTokenList}
              disabled={isExportingTokenList}
              className="rounded-lg border border-sky-400/50 p-2 text-sky-300 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              title="Quick export token list"
              aria-label="Quick export token list"
            >
              <Download className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_auto_auto]">
            <input
              className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/30"
              placeholder="Semester (optional: HARMATTAN-2025 or RAIN-2025)"
              value={exportSemester}
              onChange={(event) => setExportSemester(event.target.value)}
            />
            <input
              className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/30"
              placeholder="Course code for token export (optional)"
              value={exportCourseCode}
              onChange={(event) => setExportCourseCode(event.target.value)}
            />
            <button
              type="button"
              onClick={handleExportSemesterSummary}
              disabled={isExportingSemester}
              className="rounded-xl border border-sky-400/50 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60 md:col-span-1"
            >
              {isExportingSemester ? "Exporting..." : "Semester Summary"}
            </button>
            <button
              type="button"
              onClick={handleExportTokenList}
              disabled={isExportingTokenList}
              className="rounded-xl border border-sky-400/50 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60 md:col-span-1"
            >
              {isExportingTokenList ? "Exporting..." : "Token List"}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Leave both fields empty to export all current records. Semester filters both exports; course code filters token export only.
          </p>
        </section>

        {loading && (
          <p className="text-sm text-slate-400">Refreshing dashboard data...</p>
        )}
      </div>
    </div>
  );
}
