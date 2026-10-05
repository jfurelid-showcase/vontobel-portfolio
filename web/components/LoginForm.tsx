"use client";

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolioClient";

// Shown in the Admin tab to anyone who isn't signed in. The owner enters the
// admin password; guests don't use this — they open their private link.
export default function LoginForm() {
  const { refreshAuth, adminConfigured, isOwner } = usePortfolio();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Inloggningen misslyckades (${res.status})`);
      setPassword("");
      await refreshAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <h2 className="mb-1 text-lg font-medium">Logga in</h2>
      <p className="mb-4 text-sm text-neutral-500">
        {isOwner
          ? "Admin kräver lösenord."
          : "Hantera den här portföljen med din privata länk, eller logga in som administratör."}
      </p>
      {!adminConfigured && (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Inget admin-lösenord är inställt på servern (miljövariabeln ADMIN_PASSWORD saknas), så det går inte att logga in än.
        </p>
      )}
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Lösenord"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password || !adminConfigured}
          className="w-full rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Loggar in…" : "Logga in"}
        </button>
      </form>
    </section>
  );
}
