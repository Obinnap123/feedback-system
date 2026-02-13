"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Star } from "lucide-react";
import { submitFeedback } from "../lib/api";

const STAR_RANGE = [1, 2, 3, 4, 5];
const QUICK_QUESTIONS = [
  {
    id: "clarity",
    prompt: "How clear was the lecturer's explanation?",
    options: ["Very clear", "Somewhat clear", "Not clear"],
  },
  {
    id: "pace",
    prompt: "How was the lecture pace?",
    options: ["Too fast", "Balanced", "Too slow"],
  },
  {
    id: "engagement",
    prompt: "How engaging was the lecture?",
    options: ["Very engaging", "Average", "Not engaging"],
  },
  {
    id: "materials",
    prompt: "How useful were examples/materials?",
    options: ["Very useful", "Somewhat useful", "Not useful"],
  },
  {
    id: "confidence",
    prompt: "How confident do you feel after this class?",
    options: ["Very confident", "Somewhat confident", "Not confident"],
  },
];
const FEEDBACK_GUIDELINES = [
  "Focus on teaching quality, clarity, pace, and course materials.",
  "Use respectful language. Avoid insults, abuse, or personal attacks.",
  "Give specific examples so the lecturer can improve quickly.",
];

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

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Something went wrong. Please try again.";
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
  const [quickAnswers, setQuickAnswers] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3600);
  };

  const handleRatingSelect = (value: number) => {
    if (submitted) return;
    setRating(value);
  };

  const selectQuickAnswer = (questionId: string, option: string) => {
    if (submitted) return;
    setQuickAnswers((prev) => ({ ...prev, [questionId]: option }));
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

    if (Object.keys(quickAnswers).length < QUICK_QUESTIONS.length) {
      showToast("Please answer all 5 quick questions before submitting.");
      return;
    }

    if (!text.trim()) {
      showToast("Please answer the guided questions and write your final comment.");
      return;
    }

    if (text.trim().length < 20) {
      showToast("Please provide at least 20 characters so your feedback is useful.");
      return;
    }

    setIsSubmitting(true);
    try {
      const quickSummary = QUICK_QUESTIONS.map(
        (question) => `${question.prompt}: ${quickAnswers[question.id] || "-"}`,
      ).join(" | ");
      const combinedText = `Quick responses: ${quickSummary}\nStudent comment: ${text.trim()}`;

      await submitFeedback({
        token: token.trim(),
        rating,
        text: combinedText,
      });
      setSubmitted(true);
    } catch (error) {
      const message = getErrorMessage(error);
      if (/toxic|toxicity|unprofessional|professional|rephrase|respectful/i.test(message)) {
        showToast(
          "Please rephrase using respectful language. Focus on teaching style, pace, or course materials.",
        );
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
            ? "flex w-full flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10"
            : "mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-14"
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
            {stepLabel} - Your feedback is anonymous to classmates.
          </p>
        </header>

        <section className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/60 backdrop-blur sm:p-6">
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
                      className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                        isActive
                          ? "border-amber-400 bg-amber-400/20 text-amber-300"
                          : "border-slate-700/80 bg-slate-900/40 text-slate-500 hover:border-amber-300/60 hover:text-amber-300"
                      }`}
                      aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                      aria-pressed={rating === star}
                      disabled={submitted}
                    >
                      <Star className={`h-4 w-4 ${isActive ? "fill-current" : ""}`} />
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-slate-400">
                Select 1-5 stars (hover to preview).
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
                    Please answer these 5 quick questions, then write one final comment.
                  </div>
                </div>

                <div className="ml-12 space-y-3">
                  <div className="space-y-2 rounded-2xl border border-slate-800/70 bg-slate-950/50 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Quick Questions ({Object.keys(quickAnswers).length}/{QUICK_QUESTIONS.length})
                    </p>
                    {QUICK_QUESTIONS.map((question, index) => (
                      <div
                        key={question.id}
                        className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3"
                      >
                        <p className="text-sm text-slate-200">
                          {index + 1}. {question.prompt}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {question.options.map((option) => {
                            const selected = quickAnswers[question.id] === option;
                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => selectQuickAnswer(question.id, option)}
                                disabled={submitted}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                  selected
                                    ? "border-indigo-300 bg-indigo-500/30 text-indigo-100"
                                    : "border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/20"
                                }`}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/50 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Feedback Guidelines
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-slate-300">
                      {FEEDBACK_GUIDELINES.map((rule) => (
                        <li key={rule}>- {rule}</li>
                      ))}
                    </ul>
                  </div>
                  <textarea
                    className="min-h-36 w-full resize-none rounded-2xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="In 2-4 sentences, what should the lecturer keep doing and what should improve?"
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
        <div className="fixed right-3 top-3 z-50 max-w-[min(92vw,30rem)] rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100 shadow-lg shadow-red-500/20 backdrop-blur sm:right-6 sm:top-6">
          {toast}
        </div>
      )}
    </div>
  );
}
