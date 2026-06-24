"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

type Role = "admin" | "consultor" | "colaborador";

type NavItem = { href: string; label: string; icon: ReactNode };

/* -------------------------------------------------------------------------- */
/* Ícones (stroke, herdam currentColor)                                       */
/* -------------------------------------------------------------------------- */
const ic = {
  dashboard: (
    <path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z" />
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
    </>
  ),
  building: (
    <>
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M19 21v-9a1 1 0 0 0-1-1h-3" />
      <path d="M9 7h2M9 11h2M9 15h2" />
    </>
  ),
  tasks: (
    <>
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ),
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const NAV: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin", label: "Dashboard", icon: <Icon>{ic.dashboard}</Icon> },
    { href: "/admin/usuarios", label: "Usuários", icon: <Icon>{ic.users}</Icon> },
    { href: "/admin/empresas", label: "Empresas", icon: <Icon>{ic.building}</Icon> },
    { href: "/admin/tarefas", label: "Tarefas", icon: <Icon>{ic.tasks}</Icon> },
  ],
  consultor: [
    { href: "/consultor", label: "Painel", icon: <Icon>{ic.briefcase}</Icon> },
    { href: "/consultor/tarefas", label: "Tarefas", icon: <Icon>{ic.tasks}</Icon> },
  ],
  colaborador: [
    { href: "/colaborador", label: "Minhas empresas", icon: <Icon>{ic.building}</Icon> },
    { href: "/colaborador/tarefas", label: "Minhas tarefas", icon: <Icon>{ic.tasks}</Icon> },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  consultor: "Consultor",
  colaborador: "Colaborador",
};

function bestMatch(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    const hit =
      pathname === item.href || pathname.startsWith(item.href + "/");
    if (hit && (best === null || item.href.length > best.length)) {
      best = item.href;
    }
  }
  return best;
}

function Brand() {
  return (
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
  );
}

function NavLinks({
  items,
  activeHref,
  onNavigate,
}: {
  items: NavItem[];
  activeHref: string | null;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          data-active={item.href === activeHref}
          className="sidebar-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function SidebarFooter({ user }: { user: ShellUser }) {
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = (user.name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="border-t border-[color:var(--sidebar-border)] pt-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white ring-1 ring-inset ring-white/20">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="text-[11px] uppercase tracking-wide text-white/55">
            {ROLE_LABEL[user.role]}
          </p>
        </div>
      </div>
      <button
        onClick={logout}
        className="mt-3 w-full rounded-lg border border-[color:var(--sidebar-border)] px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        Sair
      </button>
    </div>
  );
}

export type ShellUser = { name: string; role: Role };

export default function AppShell({
  user,
  title,
  subtitle,
  back,
  children,
}: {
  user: ShellUser;
  title: string;
  subtitle?: string;
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const items = NAV[user.role];
  const activeHref = bestMatch(pathname, items);
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas text-fg">
      {/* Sidebar fixa (desktop) / drawer (mobile) */}
      <aside
        className={`sidebar-rail fixed inset-y-0 left-0 z-40 flex w-64 flex-col px-4 py-5 transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Brand />
        <div className="mt-7 flex-1 overflow-y-auto">
          <NavLinks
            items={items}
            activeHref={activeHref}
            onNavigate={() => setOpen(false)}
          />
        </div>
        <SidebarFooter user={user} />
      </aside>

      {/* Backdrop do drawer no mobile */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      )}

      {/* Área de conteúdo */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <button
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg-muted transition hover:text-fg lg:hidden"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            {back ? (
              <Link
                href={back.href}
                className="rounded text-xs font-medium text-fg-muted transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                ← {back.label}
              </Link>
            ) : null}
            <h1 className="truncate text-lg font-semibold tracking-tight text-fg">
              {title}
            </h1>
            {subtitle ? (
              <p className="truncate text-sm text-fg-muted">{subtitle}</p>
            ) : null}
          </div>

          <ThemeToggle />
        </header>

        <main className="mx-auto max-w-6xl animate-fade-in px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
