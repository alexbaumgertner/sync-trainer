"use client";

/**
 * Удаление необратимо и уносит файлы, поэтому спрашиваем подтверждение.
 * Кнопка остаётся обычной кнопкой формы: без JS форма всё равно отправится,
 * и это осознанно — подтверждение здесь защита от промаха, а не от злого умысла.
 */
export default function DangerousDelete({
  label,
  confirmation,
}: {
  label: string;
  confirmation: string;
}) {
  return (
    <button
      type="submit"
      onClick={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
      className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
    >
      {label}
    </button>
  );
}
