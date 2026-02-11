"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { Download, MessageSquare } from "lucide-react";
import { fetchLecturerDashboard } from "../lib/api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

type LecturerMetrics = {
  total_feedbacks: number;
  avg_rating: number | null;
  cleaned_comments: string[];
};

const formatRating = (value: number | null) =>
  value === null || Number.isNaN(value) ? "-" : value.toFixed(2);

const clampRating = (value: number) => Math.min(5, Math.max(1, value));

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
  const [semester, setSemester] = useState("Fall 2025");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());

  const trendDirection = useMemo(() => {
    if (!metrics?.avg_rating) return "-";
    return metrics.avg_rating >= 3.5 ? "Up" : "Down";
  }, [metrics?.avg_rating]);

  const trendData = useMemo(() => {
    const current = metrics?.avg_rating ?? 0;
    if (!current) {
      return [0, 0];
    }

    const delta = trendDirection === "Up" ? -0.4 : 0.4;
    const previous = clampRating(current + delta);
    return [previous, current];
  }, [metrics?.avg_rating, trendDirection]);

  const chartData = useMemo(
    () => ({
      labels: ["Previous", "Current"],
      datasets: [
        {
          label: "Average Rating",
          data: trendData,
          borderColor: "rgba(99, 102, 241, 0.9)",
          backgroundColor: "rgba(99, 102, 241, 0.2)",
          pointBackgroundColor: "rgba(129, 140, 248, 1)",
          tension: 0.35,
        },
      ],
    }),
    [trendData],
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
    try {
      const response = await fetchLecturerDashboard(activeToken);
      setMetrics(response.data);
      setLastUpdated(new Date());
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
  };

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
    if (token) void loadDashboard(token);
  }, [token]);

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
          <div class="meta">Semester: ${semester}</div>
          <div class="meta">Average Rating: ${formatRating(metrics.avg_rating)}</div>
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
            : "mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12"
        }
      >
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Lecturer Dashboard
            </p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">
              Your Teaching Snapshot
            </h1>
          </div>
          <div className="flex w-full flex-col gap-3 rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 md:w-auto md:flex-row md:items-center">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                Semester
              </label>
              <select
                className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                value={semester}
                onChange={(event) => setSemester(event.target.value)}
              >
                <option value="Fall 2025">Fall 2025</option>
                <option value="Spring 2026">Spring 2026</option>
              </select>
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
        </header>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Current Average</p>
              <MessageSquare className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics ? formatRating(metrics.avg_rating) : "-"}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {metrics ? metrics.total_feedbacks : "0"} total feedbacks
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Performance Trend</p>
                <h2 className="text-lg font-semibold text-white">
                  {trendDirection}
                </h2>
              </div>
              {loading && (
                <span className="text-xs text-slate-400">Loading...</span>
              )}
            </div>
            <div className="mt-4 h-36">
              {metrics?.avg_rating ? (
                <Line data={chartData} options={chartOptions} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-700/70 text-sm text-slate-500">
                  Not enough data yet.
                </div>
              )}
            </div>
          </div>
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
