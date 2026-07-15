"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientPortalLogout } from "../actions";

// Encerra a sessão do portal (limpa o cookie) e volta à tela de senha.
export default function PortalLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await clientPortalLogout();
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-60"
    >
      {loading ? "Saindo…" : "Sair"}
    </button>
  );
}
