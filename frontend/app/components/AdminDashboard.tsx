"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { AlertTriangle, MessageSquare, Users } from "lucide-react";
import {
  fetchAdminDashboard,
  fetchAdminRatings,
  fetchToxicityLog,
  fetchAdminLecturers,
  generateFeedbackTokens,
} from "../lib/api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

type AdminMetrics = {
  total_feedbacks: number;
  avg_rating: number | null;
  toxicity_hit_rate: number;
};

type LecturerRating = {
  lecturer: string;
  avg_rating: number;
};

type ToxicityEntry = {
  keyword: string;
  count: number;
  last_seen?: string | null;
};

type LecturerOption = {
  id: number;
  email: string;
};

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const formatRating = (value: number | null) =>
  value === null || Number.isNaN(value) ? "-" : value.toFixed(2);

const parseRatings = (data: unknown): LecturerRating[] => {
  if (Array.isArray(data)) {
    return data
      .map((item) => ({
        lecturer:
          item?.lecturer ||
          item?.lecturer_name ||
          item?.name ||
          "Unknown",
        avg_rating: Number(item?.avg_rating ?? item?.average ?? 0),
      }))
      .filter((item) => !Number.isNaN(item.avg_rating));
  }

  if (data && typeof data === "object") {
    const maybeItems =
      (data as { items?: unknown[] }).items ||
      (data as { data?: unknown[] }).data ||
      (data as { ratings?: unknown[] }).ratings;
    if (Array.isArray(maybeItems)) {
      return parseRatings(maybeItems);
    }
  }

  return [];
};

const parseToxicityLog = (data: unknown): ToxicityEntry[] => {
  if (Array.isArray(data)) {
    return data.map((item) => ({
      keyword: item?.keyword || item?.phrase || item?.reason || "Unknown",
      count: Number(item?.count ?? item?.hits ?? 0),
      last_seen: item?.last_seen || item?.lastSeen || null,
    }));
  }

  if (data && typeof data === "object") {
    const maybeItems =
      (data as { items?: unknown[] }).items ||
      (data as { data?: unknown[] }).data ||
      (data as { logs?: unknown[] }).logs;
    if (Array.isArray(maybeItems)) {
      return parseToxicityLog(maybeItems);
    }
  }

  return [];
};

const parseLecturers = (data: unknown): LecturerOption[] => {
  if (Array.isArray(data)) {
    return data
      .map((item) => ({
        id: Number(item?.id ?? item?.lecturer_id ?? 0),
        email: item?.email || item?.lecturer_email || "Unknown",
      }))
      .filter((item) => Number.isFinite(item.id) && item.id > 0);
  }

  if (data && typeof data === "object") {
    const maybeItems =
      (data as { lecturers?: unknown[] }).lecturers ||
      (data as { items?: unknown[] }).items ||
      (data as { data?: unknown[] }).data;
    if (Array.isArray(maybeItems)) {
      return parseLecturers(maybeItems);
    }
  }

  return [];
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "Unable to load dashboard data.";
  }

  const maybeAny = error as {
    response?: { data?: { detail?: string; error?: string } };
    message?: string;
  };

  return (
    maybeAny.response?.data?.detail ||
    maybeAny.response?.data?.error ||
    maybeAny.message ||
    "Unable to load dashboard data."
  );
};

type AdminDashboardProps = {
  embedded?: boolean;
};

export default function AdminDashboard({ embedded = false }: AdminDashboardProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [ratings, setRatings] = useState<LecturerRating[]>([]);
  const [toxicityLog, setToxicityLog] = useState<ToxicityEntry[]>([]);
  const [lecturers, setLecturers] = useState<LecturerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [courseCode, setCourseCode] = useState("");
  const [lecturerId, setLecturerId] = useState("");
  const [quantity, setQuantity] = useState(10);
  const [generatedTokens, setGeneratedTokens] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const chartData = useMemo(() => {
    const labels = ratings.map((item) => item.lecturer);
    const values = ratings.map((item) => item.avg_rating);

    return {
      labels,
      datasets: [
        {
          label: "Avg Rating",
          data: values,
          backgroundColor: "rgba(99, 102, 241, 0.65)",
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
    };
  }, [ratings]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: "#cbd5f5" },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
        y: {
          beginAtZero: true,
          max: 5,
          ticks: { color: "#cbd5f5", stepSize: 1 },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#e2e8f0" },
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          borderColor: "rgba(99, 102, 241, 0.4)",
          borderWidth: 1,
          titleColor: "#e2e8f0",
          bodyColor: "#e2e8f0",
        },
      },
    }),
    [],
  );

  const loadDashboard = async (activeToken: string) => {
    if (!activeToken) return;
    setLoading(true);
    setError(null);

    const [
      metricsResult,
      ratingsResult,
      logResult,
      lecturersResult,
    ] = await Promise.allSettled([
      fetchAdminDashboard(activeToken),
      fetchAdminRatings(activeToken),
      fetchToxicityLog(activeToken),
      fetchAdminLecturers(activeToken),
    ]);

    const hasUnauthorized = [
      metricsResult,
      ratingsResult,
      logResult,
      lecturersResult,
    ].some(
      (result) =>
        result.status === "rejected" &&
        (result.reason as { response?: { status?: number } })?.response
          ?.status === 401,
    );
    if (hasUnauthorized) {
      router.push("/login");
      setLoading(false);
      return;
    }

    if (metricsResult.status === "fulfilled") {
      setMetrics(metricsResult.value.data);
    } else {
      setMetrics(null);
      setError(getErrorMessage(metricsResult.reason));
    }

    if (ratingsResult.status === "fulfilled") {
      setRatings(parseRatings(ratingsResult.value.data));
    } else {
      setRatings([]);
    }

    if (logResult.status === "fulfilled") {
      setToxicityLog(parseToxicityLog(logResult.value.data));
    } else {
      setToxicityLog([]);
    }

    if (lecturersResult.status === "fulfilled") {
      setLecturers(parseLecturers(lecturersResult.value.data));
    } else {
      setLecturers([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    const authToken = getAuthToken();
    if (!authToken) {
      router.push("/login");
      return;
    }
    setToken(authToken);
  }, [router]);

  useEffect(() => {
    if (token) void loadDashboard(token);
  }, [token]);

  const handleGenerate = async () => {
    setTokenError(null);
    setCopied(false);

    if (!token) {
      setTokenError("Add your admin token to generate keys.");
      return;
    }
    if (!courseCode.trim()) {
      setTokenError("Course code is required.");
      return;
    }
    if (!lecturerId) {
      setTokenError("Select a lecturer.");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await generateFeedbackTokens(token, {
        course_code: courseCode.trim(),
        lecturer_id: Number(lecturerId),
        quantity: Number(quantity),
      });
      const tokens = response.data?.tokens || response.data?.items || [];
      setGeneratedTokens(tokens);
    } catch (errorResponse) {
      setTokenError(getErrorMessage(errorResponse));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyAll = async () => {
    if (!generatedTokens.length) return;
    try {
      await navigator.clipboard.writeText(generatedTokens.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!generatedTokens.length) return;
    const lecturerLabel =
      lecturers.find((item) => String(item.id) === String(lecturerId))?.email ||
      "Lecturer";
    const header = "token,course_code,lecturer";
    const rows = generatedTokens.map(
      (tokenValue) =>
        `"${tokenValue}","${courseCode.trim()}","${lecturerLabel}"`,
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `feedback_tokens_${courseCode.trim() || "course"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

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
            ? "flex w-full flex-col gap-8 px-6 py-10"
            : "mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12"
        }
      >
        <header className="flex flex-col gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Admin Dashboard
            </p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">
              Feedback Insights
            </h1>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Total Feedbacks</p>
              <Users className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics ? metrics.total_feedbacks : "-"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Average Rating</p>
              <MessageSquare className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics ? formatRating(metrics.avg_rating) : "-"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Toxicity Alert Rate</p>
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics ? formatPercent(metrics.toxicity_hit_rate) : "-"}
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Performance Chart</p>
                <h2 className="text-lg font-semibold text-white">
                  Average Rating per Lecturer
                </h2>
              </div>
              {loading && (
                <span className="text-xs text-slate-400">Loading...</span>
              )}
            </div>
            <div className="mt-4 h-72">
              {ratings.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-700/70 text-sm text-slate-500">
                  No rating data yet.
                </div>
              ) : (
                <Bar data={chartData} options={chartOptions} />
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Toxicity Log</p>
                <h2 className="text-lg font-semibold text-white">
                  Recent Alerts
                </h2>
              </div>
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-2 pr-4">Keyword</th>
                    <th className="py-2 pr-4">Count</th>
                    <th className="py-2">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {toxicityLog.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="py-6 text-center text-sm text-slate-500"
                      >
                        No alerts logged yet.
                      </td>
                    </tr>
                  ) : (
                    toxicityLog.map((entry, index) => (
                      <tr
                        key={`${entry.keyword}-${index}`}
                        className="border-t border-slate-800/70"
                      >
                        <td className="py-3 pr-4">{entry.keyword}</td>
                        <td className="py-3 pr-4">{entry.count}</td>
                        <td className="py-3 text-slate-400">
                          {entry.last_seen || "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-slate-400">Batch Token Management</p>
              <h2 className="text-lg font-semibold text-white">
                Generate Feedback Tokens
              </h2>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCopyAll}
                className="rounded-xl border border-slate-700/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-indigo-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!generatedTokens.length}
              >
                {copied ? "Copied!" : "Copy All"}
              </button>
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="rounded-xl border border-slate-700/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-indigo-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!generatedTokens.length}
              >
                Download as CSV
              </button>
            </div>
          </div>

          {tokenError && (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {tokenError}
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr,1.3fr]">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Course Code
                </label>
                <input
                  className="mt-3 w-full rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                  placeholder="CSC 401"
                  value={courseCode}
                  onChange={(event) => setCourseCode(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Lecturer Selection
                </label>
                <select
                  className="mt-3 w-full rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                  value={lecturerId}
                  onChange={(event) => setLecturerId(event.target.value)}
                >
                  <option value="">Select lecturer</option>
                  {lecturers.map((lecturer) => (
                    <option key={lecturer.id} value={lecturer.id}>
                      {lecturer.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Quantity
                </label>
                <input
                  className="mt-3 w-full rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                  type="number"
                  min={1}
                  max={500}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(Number(event.target.value || 1))
                  }
                />
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating ? "Processing..." : "Generate"}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
                Generated Tokens
              </p>
              <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-slate-800/70 bg-slate-950/80 p-4 font-mono text-xs text-emerald-200">
                {generatedTokens.length ? (
                  generatedTokens.map((tokenValue) => (
                    <div key={tokenValue} className="py-1">
                      {tokenValue}
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500">
                    Tokens will appear here after generation.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
