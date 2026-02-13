"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { ChevronDown, Download, MessageSquare } from "lucide-react";
import { fetchLecturerDashboard } from "../lib/api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
);

type SemesterOption = {
  value: string;
  label: string;
  range: string;
};

type LecturerMetrics = {
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
  course_breakdown: { course_code: string; avg_rating: number | null; count: number }[];
  available_courses: string[];
  available_semesters: SemesterOption[];
  selected_semester: string;
  selected_course: string | null;
  last_synced_at: string;
};

const formatRating = (value: number | null) =>
  value === null || Number.isNaN(value) ? "-" : value.toFixed(2);


const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "Unable to load lecturer data.";
  }

  const maybeAny = error as {
    response?: { data?: { detail?: string; error?: string } };
    message?: string;
  };

  return (
    maybeAny.response?.data?.detail ||
    maybeAny.response?.data?.error ||
    maybeAny.message ||
    "Unable to load lecturer data."
  );
};

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

const getTimeAgo = (timestamp: Date | null, now: number) => {
  if (!timestamp) return "Last synced: -";
  const diffMs = Math.max(0, now - timestamp.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 1) return "Last synced: just now";
  return `Last synced: ${minutes} minutes ago`;
};

type LecturerDashboardProps = {
  embedded?: boolean;
};

export default function LecturerDashboard({
  embedded = false,
}: LecturerDashboardProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [metrics, setMetrics] = useState<LecturerMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSemester, setSelectedSemester] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const selectClassName =
    "h-11 w-full appearance-none rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 pr-10 text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30";
  const delta = metrics?.insight_delta ?? null;
  const deltaClass =
    delta === null
      ? "text-slate-300"
      : delta > 0
        ? "text-emerald-400"
        : delta < 0
          ? "text-rose-400"
          : "text-slate-300";

  const ratingDistribution = useMemo(() => {
    const data = metrics?.rating_distribution ?? [];
    if (data.length !== 5) {
      return [0, 0, 0, 0, 0];
    }
    return data;
  }, [metrics?.rating_distribution]);

  const chartData = useMemo(
    () => ({
      labels: ["1 Star", "2 Stars", "3 Stars", "4 Stars", "5 Stars"],
      datasets: [
        {
          label: "Rating Count",
          data: ratingDistribution,
          backgroundColor: [
            "rgba(245, 158, 11, 0.85)",
            "rgba(251, 191, 36, 0.85)",
            "rgba(99, 102, 241, 0.85)",
            "rgba(34, 197, 94, 0.85)",
            "rgba(22, 163, 74, 0.85)",
          ],
          borderColor: [
            "rgba(245, 158, 11, 1)",
            "rgba(251, 191, 36, 1)",
            "rgba(99, 102, 241, 1)",
            "rgba(34, 197, 94, 1)",
            "rgba(22, 163, 74, 1)",
          ],
          borderWidth: 1,
        },
      ],
    }),
    [ratingDistribution],
  );

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

  const loadDashboard = useCallback(async (
    activeToken: string,
    semesterValue?: string,
    courseValue?: string,
  ) => {
    if (!activeToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchLecturerDashboard(activeToken, {
        ...(semesterValue ? { semester: semesterValue } : {}),
        ...(courseValue ? { course_code: courseValue } : {}),
      });
      setMetrics(response.data);
      if (response.data?.last_synced_at) {
        setLastUpdated(new Date(response.data.last_synced_at));
      } else {
        setLastUpdated(new Date());
      }
      if (response.data?.selected_semester) {
        setSelectedSemester(response.data.selected_semester);
      }
      if (typeof response.data?.selected_course === "string") {
        setSelectedCourse(response.data.selected_course);
      } else {
        setSelectedCourse("");
      }
    } catch (errorResponse) {
      setMetrics(null);
      const status = (errorResponse as { response?: { status?: number } })
        ?.response?.status;
      if (status === 401) {
        router.push("/login");
      } else {
        setError(getErrorMessage(errorResponse));
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const authToken = getAuthToken();
    if (!authToken) {
      setError("Please sign in to view your dashboard.");
      router.push("/login");
      return;
    }
    setToken(authToken);
  }, [router]);

  useEffect(() => {
    if (token) {
      void loadDashboard(
        token,
        selectedSemester || undefined,
        selectedCourse || undefined,
      );
    }
  }, [token, selectedSemester, selectedCourse, loadDashboard]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  const handleDownloadReport = () => {
    if (!metrics) return;
    const reportWindow = window.open("", "_blank", "width=900,height=700");
    if (!reportWindow) return;
    const comments = metrics.cleaned_comments.length
      ? metrics.cleaned_comments
      : ["No feedback received yet for this semester."];
    reportWindow.document.write(`
      <html>
        <head>
          <title>Lecturer Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
            h1 { margin-bottom: 8px; }
            h2 { margin-top: 24px; }
            .meta { color: #475569; font-size: 14px; }
            ul { padding-left: 18px; }
          </style>
        </head>
        <body>
          <h1>Lecturer Feedback Report</h1>
          <div class="meta">Semester: ${metrics.current_semester}</div>
          <div class="meta">Current Avg: ${formatRating(metrics.current_avg_rating)}</div>
          <div class="meta">Current Feedbacks: ${metrics.current_feedbacks}</div>
          <div class="meta">Previous Avg: ${formatRating(metrics.previous_avg_rating)}</div>
          <div class="meta">Previous Feedbacks: ${metrics.previous_feedbacks}</div>
          <div class="meta">Total Avg: ${formatRating(metrics.total_avg_rating)}</div>
          <div class="meta">Total Feedbacks: ${metrics.total_feedbacks}</div>
          <h2>Cleaned Comments</h2>
          <ul>
            ${comments.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
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
            : "mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 sm:px-6 lg:px-8 lg:py-10"
        }
      >
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Lecturer Dashboard
            </p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">
              Your Teaching Snapshot
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Dashboard &gt; {(metrics?.current_semester || "Harmattan")} Semester
              {" "}(
              Academic Period: {metrics?.current_semester_range || "-"}
              )
            </p>
          </div>
          <div className="w-full rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 xl:w-auto">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] xl:items-end">
              <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                Course
              </label>
              <div className="relative">
                <select
                  className={selectClassName}
                  value={selectedCourse}
                  onChange={(event) => setSelectedCourse(event.target.value)}
                >
                  <option value="">All Courses</option>
                  {(metrics?.available_courses || []).map((courseCode) => (
                    <option key={courseCode} value={courseCode}>
                      {courseCode}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                Semester
              </label>
              <div className="relative">
                <select
                  className={selectClassName}
                  value={selectedSemester}
                  onChange={(event) => setSelectedSemester(event.target.value)}
                >
                  {(metrics?.available_semesters || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              <span className="text-xs text-slate-500">
                {metrics?.current_semester_range || ""}
              </span>
              </div>
              <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                Status
              </span>
              <span className="text-xs text-slate-400">
                {getTimeAgo(lastUpdated, now)}
              </span>
              </div>
              <button
                type="button"
                onClick={handleDownloadReport}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-indigo-400/60 hover:text-white"
              >
                <Download className="h-4 w-4" />
                Download Report
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Selected Semester Rating</p>
              <MessageSquare className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics
                ? formatRating(metrics.current_avg_rating ?? metrics.avg_rating)
                : "-"}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {metrics ? metrics.current_feedbacks : "0"} feedbacks this semester
            </p>
            {metrics?.current_semester && (
              <p className="mt-2 text-xs text-slate-500">
                {metrics.current_semester}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Previous Semester Rating</p>
              <MessageSquare className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics ? formatRating(metrics.previous_avg_rating) : "-"}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {metrics ? metrics.previous_feedbacks : "0"} feedbacks last semester
            </p>
            {metrics?.previous_semester && (
              <p className="mt-2 text-xs text-slate-500">
                {metrics.previous_semester}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Total Rating</p>
              <MessageSquare className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics ? formatRating(metrics.total_avg_rating) : "-"}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {metrics ? metrics.total_feedbacks : "0"} total feedbacks
            </p>
            <p className="mt-2 text-xs text-slate-500">All time</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/40">
          <p className="text-sm text-slate-300">
            Insight:{" "}
            {delta === null
              ? "Not enough previous-semester data for delta."
              : (
                <span className={`font-semibold ${deltaClass}`}>
                  {`${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}
                </span>
              )}
            {delta !== null && " vs previous semester"}
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Course Breakdown</p>
              <h2 className="text-lg font-semibold text-white">
                Course-level averages
              </h2>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/40">
            <div className="max-h-72 overflow-auto">
              <table className="w-full min-w-[460px] text-sm text-slate-200">
                <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur">
                <tr className="text-left text-slate-400">
                  <th className="pb-2">Course</th>
                  <th className="pb-2">Avg Rating</th>
                  <th className="pb-2">Feedback Count</th>
                </tr>
                </thead>
                <tbody>
                {(metrics?.course_breakdown || []).map((row) => (
                  <tr key={row.course_code} className="border-t border-slate-800/70">
                    <td className="py-2">{row.course_code}</td>
                    <td className="py-2">{formatRating(row.avg_rating)}</td>
                    <td className="py-2">{row.count}</td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
            {!(metrics?.course_breakdown || []).length && (
              <p className="pt-3 text-sm text-slate-500">No course data yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">
                Rating Distribution (Selected Semester)
              </p>
              <h2 className="text-lg font-semibold text-white">
                How students rated this semester
              </h2>
            </div>
            {loading && (
              <span className="text-xs text-slate-400">Loading...</span>
            )}
          </div>
          <div className="mt-4 h-48">
            {metrics?.rating_distribution?.length === 5 ? (
              <Bar data={chartData} options={chartOptions} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-700/70 text-sm text-slate-500">
                Not enough data yet.
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            1-2 stars = Warning | 4-5 stars = Success
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Positive: {(metrics?.positive_pct ?? 0).toFixed(1)}% | Neutral:{" "}
            {(metrics?.neutral_pct ?? 0).toFixed(1)}% | Negative:{" "}
            {(metrics?.negative_pct ?? 0).toFixed(1)}%
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Cleaned Feedbacks</p>
              <h2 className="text-lg font-semibold text-white">
                Recent Student Comments
              </h2>
            </div>
            <MessageSquare className="h-5 w-5 text-indigo-300" />
          </div>
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-2">
            {metrics?.cleaned_comments?.length ? (
              metrics.cleaned_comments.map((comment, index) => (
                <div
                  key={`${comment}-${index}`}
                  className="rounded-2xl border border-slate-800/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-200"
                >
                  {comment}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700/70 px-4 py-6 text-center text-sm text-slate-500">
                No feedback received yet for this semester.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
