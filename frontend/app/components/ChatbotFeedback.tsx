"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Star } from "lucide-react";
import { fetchFeedbackTokenStatus, submitFeedback } from "../lib/api";
import { getAuthToken } from "../lib/auth";

const STAR_RANGE = [1, 2, 3, 4, 5];
const DRAFT_PREFIX = "student-feedback-draft";
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

type TokenStatus = {
  token: string;
  valid: boolean;
  is_used: boolean;
  can_submit: boolean;
  course_code?: string | null;
  lecturer_email?: string | null;
  session_key?: string | null;
  session_label?: string | null;
  reason?: string | null;
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

const getDraftKey = (rawToken: string) =>
  `${DRAFT_PREFIX}:${rawToken.trim().toLowerCase()}`;

type ChatbotFeedbackProps = {
  embedded?: boolean;
};

export default function ChatbotFeedback({ embedded = false }: ChatbotFeedbackProps) {
  const searchParams = useSearchParams();
  const tokenFromQuery = useMemo(() => searchParams.get("token") ?? "", [searchParams]);

  const [authToken, setAuthToken] = useState("");
  const [token, setToken] = useState(tokenFromQuery);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [checkingToken, setCheckingToken] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [quickAnswers, setQuickAnswers] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submissionNotice, setSubmissionNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 7000);
  };

  const checkTokenStatus = useCallback(
    async (rawToken: string) => {
      if (!authToken || !rawToken.trim()) {
        setTokenStatus(null);
        return;
      }
      setCheckingToken(true);
      try {
        const response = await fetchFeedbackTokenStatus(authToken, rawToken.trim());
        setTokenStatus(response.data ?? null);
      } catch (error) {
        setTokenStatus(null);
        setSubmitError(getErrorMessage(error));
      } finally {
        setCheckingToken(false);
      }
    },
    [authToken],
  );

  useEffect(() => {
    setAuthToken(getAuthToken());
  }, []);

  useEffect(() => {
    if (!token.trim() || !authToken || submitted) return;
    const timer = window.setTimeout(() => {
      void checkTokenStatus(token);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [token, authToken, submitted, checkTokenStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!token.trim() || submitted) return;
    const stored = localStorage.getItem(getDraftKey(token));
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as {
        rating?: number;
        quickAnswers?: Record<string, string>;
        text?: string;
      };
      if (parsed.rating && parsed.rating >= 1 && parsed.rating <= 5) {
        setRating(parsed.rating);
      }
      if (parsed.quickAnswers && typeof parsed.quickAnswers === "object") {
        setQuickAnswers(parsed.quickAnswers);
      }
      if (typeof parsed.text === "string") {
        setText(parsed.text);
      }
    } catch {
      localStorage.removeItem(getDraftKey(token));
    }
  }, [token, submitted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!token.trim() || submitted) return;
    const payload = JSON.stringify({
      rating,
      quickAnswers,
      text,
    });
    localStorage.setItem(getDraftKey(token), payload);
  }, [token, rating, quickAnswers, text, submitted]);

  const handleRatingSelect = (value: number) => {
    if (submitted) return;
    setSubmitError(null);
    setRating(value);
  };

  const selectQuickAnswer = (questionId: string, option: string) => {
    if (submitted) return;
    setSubmitError(null);
    setQuickAnswers((prev) => ({ ...prev, [questionId]: option }));
  };

  const handleSubmit = async () => {
    if (isSubmitting || submitted) return;
    setSubmissionNotice(null);
    setSubmitError(null);

    if (!authToken) {
      setSubmitError("Please login as a student before submitting feedback.");
      return;
    }

    if (!token.trim()) {
      showToast("Missing feedback token. Please use your course link.");
      return;
    }

    if (tokenStatus && !tokenStatus.can_submit) {
      setSubmitError(tokenStatus.reason || "This token cannot be used for submission.");
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

      await submitFeedback(
        {
          token: token.trim(),
          rating,
          text: combinedText,
        },
        authToken,
      );
      setSubmitted(true);
      setSubmissionNotice("Feedback submitted successfully. Thank you.");
      setTokenStatus((current) =>
        current
          ? {
              ...current,
              is_used: true,
              can_submit: false,
              reason: "Feedback submitted for this lecture session.",
            }
          : current,
      );
      if (typeof window !== "undefined") {
        localStorage.removeItem(getDraftKey(token));
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        /toxic|toxicity|unprofessional|professional|rephrase|respectful|abusive|disrespectful|profanity/i.test(
          message,
        )
      ) {
        setSubmitError(
          "We could not submit this yet. Please rephrase a few words to keep feedback respectful and focused on teaching clarity, pace, or materials. Your token remains valid.",
        );
      } else if (/already submitted feedback for this lecture session/i.test(message)) {
        setSubmitError("You already submitted feedback for this lecture session.");
      } else if (/invalid or already used feedback token|invalid feedback token/i.test(message)) {
        setSubmitError("This token is invalid or already used. Please request a fresh token.");
      } else if (/invalid token|insufficient permissions|not authenticated|401/i.test(message)) {
        setSubmitError("Please login as a student to submit feedback.");
      } else {
        setSubmitError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepLabel = submitted ? "Complete" : rating ? "Step 2 of 2" : "Step 1 of 2";
  const displayRating = hoverRating || rating;
  const answeredCount = Object.keys(quickAnswers).length;

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
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Student Feedback</p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            Share your thoughts in a quick chat.
          </h1>
          <p className="text-sm text-slate-400">{stepLabel} - Your feedback stays anonymous.</p>
        </header>

        <section className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/60 backdrop-blur sm:p-6">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Feedback Token
            </label>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="w-full rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Paste your token from the invite link"
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  setSubmitError(null);
                }}
                disabled={submitted}
              />
            </div>
            {checkingToken && token.trim() && (
              <p className="mt-2 text-xs text-indigo-200">Checking token status...</p>
            )}
            {!authToken && (
              <p className="mt-2 text-xs text-amber-200">
                Login required: sign in as a student before submitting feedback.
              </p>
            )}
            {tokenStatus && (
              <div
                className={`mt-2 rounded-xl border px-3 py-2 text-xs ${
                  tokenStatus.can_submit
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                    : "border-rose-400/40 bg-rose-500/10 text-rose-100"
                }`}
              >
                {tokenStatus.can_submit ? (
                  <span>
                    Token is valid for {tokenStatus.course_code || "course"} (
                    {tokenStatus.session_label || tokenStatus.session_key || "lecture session"}).
                  </span>
                ) : (
                  <span>{tokenStatus.reason || "Token cannot be used right now."}</span>
                )}
              </div>
            )}
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
              <span className="text-xs text-slate-400">Select 1-5 stars (hover to preview).</span>
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
                      Quick Questions ({answeredCount}/{QUICK_QUESTIONS.length})
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
                    onChange={(event) => {
                      setText(event.target.value);
                      setSubmitError(null);
                    }}
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
                  {submitError && (
                    <p
                      className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100"
                      role="alert"
                      aria-live="polite"
                    >
                      {submitError}
                    </p>
                  )}
                </div>
              </>
            )}

            {submitted && submissionNotice && (
              <div
                className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">
                  Submission Complete
                </p>
                <p className="mt-1 text-sm text-emerald-100">{submissionNotice}</p>
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
