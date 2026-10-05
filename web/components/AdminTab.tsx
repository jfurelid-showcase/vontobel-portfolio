"use client";

import LoginForm from "@/components/LoginForm";
import ProfilesManager from "@/components/ProfilesManager";
import { usePortfolio } from "@/lib/portfolioClient";

// The Admin tab: a sign-in form for visitors with no rights, the profile
// manager for the owner, and — for the owner and for a guest on their own
// private link — the controls for the portfolio being viewed (passed in as
// children).
export default function AdminTab({ children }: { children: React.ReactNode }) {
  const p = usePortfolio();

  if (!p.canEdit) return <LoginForm />;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span>{p.admin ? "Inloggad som administratör" : "Du hanterar den här portföljen via din privata länk"}</span>
        {p.admin && (
          <button onClick={() => p.logout()} className="rounded-md border border-neutral-700 px-2.5 py-1 text-neutral-300 hover:bg-neutral-800">
            Logga ut
          </button>
        )}
      </div>
      {p.admin && <ProfilesManager />}
      {children}
    </>
  );
}
