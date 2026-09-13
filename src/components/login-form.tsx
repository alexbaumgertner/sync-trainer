"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Вход в два шага: адрес → код из письма. Пароля нет. */
export default function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/request-code", { email });
      setStep("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/verify-code", { email, code });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Тренажёр синхрониста</h1>
      <p className="mt-1 mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        {step === "email"
          ? "Вход по коду на почту. Пароль придумывать не нужно."
          : `Код отправлен на ${email}, если этот адрес приглашён.`}
      </p>

      {!configured ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-medium">Вход не настроен.</strong> Задайте переменную
          окружения <code className="font-mono">AUTH_SECRET</code> — без ключа подписи
          сессию подделает кто угодно.
        </div>
      ) : step === "email" ? (
        <form onSubmit={requestCode} className="flex flex-col gap-3">
          <label className="block text-xs">
            <span className="mb-1 block text-neutral-500">Почта</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={busy || !email} className={buttonClass}>
            {busy ? "Отправляю…" : "Получить код"}
          </button>
          {error && <p className={errorClass}>{error}</p>}
        </form>
      ) : (
        <form onSubmit={submitCode} className="flex flex-col gap-3">
          <label className="block text-xs">
            <span className="mb-1 block text-neutral-500">Код из письма</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
              autoComplete="one-time-code"
              className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
            />
          </label>
          <button type="submit" disabled={busy || code.length !== 6} className={buttonClass}>
            {busy ? "Проверяю…" : "Войти"}
          </button>
          {error && <p className={errorClass}>{error}</p>}
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
            className="text-xs text-neutral-500 underline-offset-2 hover:underline"
          >
            Ввести другой адрес
          </button>
        </form>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900";
const buttonClass =
  "rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200";
const errorClass =
  "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200";
