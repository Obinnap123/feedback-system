"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { submitFeedback } from "../lib/api";

const STAR_RANGE = [1, 2, 3, 4, 5];

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Something went wrong. Please try again.";
  }

  const maybeAny = error as {
    response?: { data?: { detail?: string; error?: string } };
    message?: string;
  };

  return (
    maybeAny.response?.data?.detail ||
    maybeAny.response?.data?.error ||
    maybeAny.message ||
    "Something went wrong. Please try again."
  );
}

type ChatbotFeedbackProps = {
  embedded?: boolean;
};

export default function ChatbotFeedback({ embedded = false }: ChatbotFeedbackProps) {
  const searchParams = useSearchParams();
  const tokenFromQuery = useMemo(
    () => searchParams.get("token") ?? "",
    [searchParams],
  );

  const [token, setToken] = useState(tokenFromQuery);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const handleRatingSelect = (value: number) => {
    if (submitted) return;
    setRating(value);
  };

  const handleSubmit = async () => {
    if (isSubmitting || submitted) return;

    if (!token.trim()) {
      showToast("Missing feedback token. Please use your course link.");
      return;
    }

    if (!rating) {
      showToast("Please select a rating before continuing.");
      return;
    }

    if (!text.trim()) {
      showToast("Please add a short comment before submitting.");
      return;
    }

    setIsSubmitting(true);
    try {
      await submitFeedback({
        token: token.trim(),
        rating,
        text: text.trim(),
      });
      setSubmitted(true);
    } catch (error) {
      const message = getErrorMessage(error);
      if (/toxic|toxicity|unprofessional|professional/i.test(message)) {
        showToast("Please keep it professional!");
      } else {
        showToast(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepLabel = submitted
    ? "Complete"
    : rating
      ? "Step 2 of 2"
      : "Step 1 of 2";

  const displayRating = hoverRating || rating;

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
            ? "flex w-full flex-col gap-6 px-6 py-10"
            : "mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-14"
        }
      >
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Student Feedback
          </p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            Share your thoughts in a quick chat.
          </h1>
          <p className="text-sm text-slate-400">
            {stepLabel} · Your feedback is anonymous to classmates.
          </p>
        </header>

        <section className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Feedback Token
            </label>
            <input
              className="mt-3 w-full rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
              placeholder="Paste your token from the invite link"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={submitted}
            />
          </div>

          <div className="mt-6 space-y-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 text-xs font-semibold text-indigo-200">
                Bot
              </div>
              <div className="rounded-2xl bg-slate-800/70 px-4 py-3 text-sm text-slate-100">
                How would you rate today&apos;s lecture?
              </div>
            </div>

            <div className="ml-12 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {STAR_RANGE.map((star) => {
                  const isActive = displayRating >= star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onFocus={() => setHoverRating(star)}
                      onBlur={() => setHoverRating(0)}
                      onClick={() => handleRatingSelect(star)}
                      className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg transition ${
                        isActive
                          ? "border-amber-400 bg-amber-400/20 text-amber-300"
                          : "border-slate-700/80 bg-slate-900/40 text-slate-500 hover:border-amber-300/60 hover:text-amber-300"
                      }`}
                      aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                      aria-pressed={rating === star}
                      disabled={submitted}
                    >
                      ★
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-slate-400">
                Select 1–5 stars (hover to preview).
              </span>
            </div>

            {rating > 0 && (
              <>
                <div className="flex items-start justify-end gap-3">
                  <div className="rounded-2xl bg-indigo-500 px-4 py-3 text-sm text-white shadow-lg shadow-indigo-500/30">
                    I&apos;d rate it {rating} star{rating > 1 ? "s" : ""}.
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-xs font-semibold text-white">
                    You
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 text-xs font-semibold text-indigo-200">
                    Bot
                  </div>
                  <div className="rounded-2xl bg-slate-800/70 px-4 py-3 text-sm text-slate-100">
                    Tell us what worked well and what could be improved.
                  </div>
                </div>

                <div className="ml-12 space-y-3">
                  <textarea
                    className="min-h-35 w-full resize-none rounded-2xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="Write your feedback here..."
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    disabled={submitted}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting || submitted}
                      className="rounded-xl bg-indigo-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? "Submitting..." : "Submit Feedback"}
                    </button>
                    <span className="text-xs text-slate-400">
                      Your response helps improve the course.
                    </span>
                  </div>
                </div>
              </>
            )}

            {submitted && (
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/20 text-xs font-semibold text-emerald-200">
                  Bot
                </div>
                <div className="rounded-2xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100">
                  Thanks! Your feedback was submitted successfully.
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {toast && (
        <div className="fixed right-6 top-6 z-50 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100 shadow-lg shadow-red-500/20 backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  );
}
