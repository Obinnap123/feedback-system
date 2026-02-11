import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12 text-slate-100">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200">
          <Settings className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Settings
          </p>
          <h1 className="text-2xl font-semibold text-white">
            Dashboard Preferences
          </h1>
        </div>
      </header>

      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 text-sm text-slate-300">
        Configure notification preferences, account details, and access roles
        here.
      </div>
    </div>
  );
}
