"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setPassword("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Тренажёр синхрониста</h1>
      <p className="mt-1 mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Генерация аудио стоит денег, поэтому доступ закрыт паролем.
      </p>

      {!configured ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-medium">Пароль не настроен.</strong> Задайте переменную
          окружения <code className="font-mono">APP_PASSWORD</code> — без неё генерация
          отключена, чтобы публичное приложение не тратило бюджет кому угодно.
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="block text-xs">
            <span className="mb-1 block text-neutral-500">Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !password}
            className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {busy ? "Проверяю…" : "Войти"}
          </button>

          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
