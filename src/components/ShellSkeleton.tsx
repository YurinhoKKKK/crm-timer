// Esqueleto de carregamento que espelha o layout do AppShell (sidebar +
// header + conteúdo). Renderizado pelos loading.tsx de cada área enquanto a
// página do servidor resolve os dados — assim a navegação mostra a estrutura
// na hora, em vez de a tela anterior ficar congelada.
//
// É um Server Component puro (sem hooks): não depende dos dados do usuário,
// que ainda não foram buscados quando o loading aparece.

type Role = "admin" | "consultor" | "colaborador";

// Quantos itens de navegação cada cargo tem na sidebar (espelha o NAV do
// AppShell), só para o esqueleto ter a altura certa.
const NAV_COUNT: Record<Role, number> = {
  admin: 4,
  consultor: 1,
  colaborador: 1,
};

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} />;
}

function Card() {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
      <div className="mt-3 h-8 w-16 animate-pulse rounded bg-surface-2" />
    </div>
  );
}

export default function ShellSkeleton({ role }: { role: Role }) {
  const navCount = NAV_COUNT[role];

  return (
    <div className="min-h-screen bg-canvas text-fg" aria-busy="true">
      {/* Sidebar (idêntica em estrutura à do AppShell) */}
      <aside className="sidebar-rail fixed inset-y-0 left-0 z-40 hidden w-64 flex-col px-4 py-5 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-base font-bold tracking-tight text-white ring-1 ring-inset ring-white/20">
            M
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Monvatti</p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/55">
              CRM · Timer
            </p>
          </div>
        </div>

        <div className="mt-7 flex-1 space-y-1">
          {Array.from({ length: navCount }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Bar className="h-4 w-4 shrink-0" />
              <Bar className="h-3 w-28" />
            </div>
          ))}
        </div>

        <div className="border-t border-[color:var(--sidebar-border)] pt-4">
          <div className="flex items-center gap-3">
            <Bar className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-3 w-24" />
              <Bar className="h-2 w-16" />
            </div>
          </div>
        </div>
      </aside>

      {/* Área de conteúdo */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-40 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-56 animate-pulse rounded bg-surface-2" />
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} />
            ))}
          </div>
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-line bg-surface p-4 shadow-card"
              >
                <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
                <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-surface-2" />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
