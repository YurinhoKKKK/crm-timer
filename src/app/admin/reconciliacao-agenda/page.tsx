import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import {
  listReconciliation,
  listReconcileOwners,
} from "@/app/meeting-reconcile-actions";
import { resolvePeople } from "@/lib/creator";
import ReconciliationPanel from "./ReconciliationPanel";

// Sempre fresco: a fila muda quando os donos sincronizam e quando o admin aplica.
export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";
function fmtBRT(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// Painel da reconciliação Google→CRM (0172/0174). Lista as divergências que cada
// dono enfileirou (na própria sessão, lendo a agenda real dele) e deixa o admin
// aplicar ou dispensar. "Concluir" liga o auto-sync daquele dono. Abaixo, a lista
// geral de reuniões FUTURAS que ficaram fora do Google (B13 — visão do admin).
export default async function ReconciliacaoAgendaPage() {
  const { supabase, profile } = await guardRole(["admin"]);
  const [rows, owners] = await Promise.all([
    listReconciliation(),
    listReconcileOwners(),
  ]);

  // B13 (admin): reuniões futuras fora do Google, de todo mundo (RLS: admin vê tudo).
  const { data: pendingData } = await supabase
    .from("meetings")
    .select("id, title, starts_at, created_by, google_sync_status, company:companies(name)")
    .in("google_sync_status", ["nao_conectado", "falhou"])
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  type PendRow = {
    id: string; title: string; starts_at: string; created_by: string;
    google_sync_status: string;
    company: { name: string } | { name: string }[] | null;
  };
  const pending = (pendingData as PendRow[] | null) ?? [];
  const people = await resolvePeople(supabase, pending.map((p) => p.created_by));

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Reconciliação da Agenda"
      subtitle="Reuniões do CRM que divergem do Google: revise e aplique"
      back={{ href: "/admin", label: "Dashboard" }}
    >
      <ReconciliationPanel initialRows={rows} initialOwners={owners} />

      <section className="mt-8 rounded-xl border border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-fg">
            Reuniões futuras fora do Google
            <span className="ml-2 font-normal text-fg-subtle">{pending.length}</span>
          </h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Criadas no CRM mas não sincronizadas (conta desconectada ou falha). O
            criador recebe notificação e o botão “Enviar para o Google” na Agenda.
          </p>
        </header>
        {pending.length === 0 ? (
          <p className="px-4 py-4 text-sm text-fg-muted">Nenhuma pendência. 🎉</p>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((m) => {
              const c = Array.isArray(m.company) ? m.company[0] : m.company;
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-fg">{m.title}</span>
                    <span className="ml-2 text-fg-subtle">{fmtBRT(m.starts_at)}</span>
                    {c?.name && <span className="ml-2 text-xs text-fg-subtle">{c.name}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-fg-muted">
                      {people.get(m.created_by)?.name ?? "(sem nome)"}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-medium ${
                      m.google_sync_status === "nao_conectado"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                        : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                    }`}>
                      {m.google_sync_status === "nao_conectado" ? "sem conta Google" : "falhou"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
