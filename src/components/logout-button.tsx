"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/logout", { method: "POST" });
        router.refresh();
      }}
      className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-500 disabled:opacity-40 dark:border-neutral-700"
    >
      {busy ? "…" : "Выйти"}
    </button>
  );
}
