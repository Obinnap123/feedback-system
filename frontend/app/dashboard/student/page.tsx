import { Suspense } from "react";
import ChatbotFeedback from "../../components/ChatbotFeedback";

export default function StudentDashboardPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading...</div>}>
      <ChatbotFeedback embedded />
    </Suspense>
  );
}
