"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import TaskDetailLink from "@/components/TaskDetailLink";
import { avatarUrl } from "@/lib/avatar";
import {
  PERIOD_LABEL,
  toHours,
  isTaskScope,
  type CapacityPeriod,
  type DrilldownScope,
  type AnyDrilldownScope,
} from "@/lib/capacity";
import {
  getCapacityDrilldown,
  getCapacityTaskDrilldown,
  type DrilldownCompany,
  type DrilldownTask,
} from "@/app/admin/capacity-actions";

export type DrilldownTarget = {
  personId: string;
  personName: string;
  scope: AnyDrilldownScope;
  count: number; // nº de itens; em "horas" é o total de SEGUNDOS (vira horas no título)
  period: CapacityPeriod;
};

// A busca é injetável só para a rota de PRÉVIA (mock sem login) poder exibir a
// lista sem sessão. Em produção fica o default (server action → RPC no banco).
export type DrilldownFetcher = (
  personId: string,
  scope: DrilldownScope,
  period: CapacityPeriod
) => Promise<{ error: string | null; companies?: DrilldownCompany[] }>;

// Substantivo do recorte, concordando com a contagem. É o que vai no título:
// "Theo Garcia · 25 clientes ativos". Em "horas" o título é tratado à parte
// (o número é tempo, não contagem).
function scopeNoun(scope: AnyDrilldownScope, n: number): string {
  const plural = n !== 1;
  switch (scope) {
    case "ativos":
    case "colab_ativos":
      return plural ? "clientes ativos" : "cliente ativo";
    case "exclusivos":
      return plural ? "clientes exclusivos" : "cliente exclusivo";
    case "compartilhados":
      return plural ? "clientes compartilhados" : "cliente compartilhado";
    case "alerta":
      return plural ? "clientes com etiqueta ALERTA" : "cliente com etiqueta ALERTA";
    case "parados":
      return plural ? "clientes parados" : "cliente parado";
    case "sem_registro":
      return plural ? "clientes sem registro" : "cliente sem registro";
    case "empresas":
      return plural ? "empresas atendidas" : "empresa atendida";
    case "fora_da_carteira":
      return plural ? "empresas fora da carteira" : "empresa fora da carteira";
    case "pontuais":
      return plural ? "tarefas pontuais concluídas" : "tarefa pontual concluída";
    case "atrasadas":
      return plural ? "tarefas atrasadas" : "tarefa atrasada";
    case "horas":
      return "de trabalho"; // usado só como sufixo; o título formata as horas
  }
}

// Linha-título sob o nome. "horas" mostra o tempo (o número é segundos); os
// demais mostram "N substantivo".
function subtitleText(scope: AnyDrilldownScope, count: number): string {
  if (scope === "horas") {
    const h = toHours(count).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${h} h de trabalho`;
  }
  return `${count} ${scopeNoun(scope, count)}`;
}

// O período entra no título quando o recorte depende dele: empresas atendidas e
// as três colunas de atividade (horas/pontuais/atrasadas). "colab_ativos" é foto
// do agora, então NÃO leva período.
const PERIOD_SCOPED: AnyDrilldownScope[] = [
  "empresas",
  "horas",
  "pontuais",
  "atrasadas",
];

function fmtHoursShort(seconds: number): string {
  return toHours(seconds).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

// Data de referência da tarefa, no fuso de Brasília (como o resto do sistema).
function fmtRefDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

// Texto contextual sob cada tarefa, conforme o recorte.
function taskRefText(scope: AnyDrilldownScope, task: DrilldownTask): string | null {
  const d = fmtRefDate(task.refAt);
  if (!d) return null;
  if (scope === "pontuais") return `Concluída em ${d}`;
  if (scope === "atrasadas") return `Venceu em ${d}`;
  if (scope === "horas") return `Último apontamento ${d}`;
  return null;
}

export default function CapacityDrilldownPanel({
  target,
  onClose,
  fetcher = getCapacityDrilldown,
}: {
  target: DrilldownTarget;
  onClose: () => void;
  fetcher?: DrilldownFetcher;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<DrilldownCompany[]>([]);
  const [tasks, setTasks] = useState<DrilldownTask[]>([]);
  const [pending, startTransition] = useTransition();
  const [navId, setNavId] = useState<string | null>(null);

  const { personId, personName, scope, count, period } = target;
  const taskScope = isTaskScope(scope);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    // Recortes de ATIVIDADE abrem TAREFAS (RPC própria); os demais, EMPRESAS.
    const load = isTaskScope(scope)
      ? getCapacityTaskDrilldown(personId, scope, period).then((res) => {
          if (!active) return;
          if (res.error) setError(res.error);
          else setTasks(res.tasks ?? []);
        })
      : fetcher(personId, scope, period).then((res) => {
          if (!active) return;
          if (res.error) setError(res.error);
          else setCompanies(res.companies ?? []);
        });
    load.finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [personId, scope, period, fetcher]);

  // Fechar por Esc (clique fora é o backdrop abaixo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Ação DENTRO de painel: button + router.push em useTransition, nunca <a>
  // (regra do passo 32.2 — link arrastável/captura de gesto e sem feedback).
  function openCompany(id: string) {
    setNavId(id);
    startTransition(() => router.push(`/admin/empresas/${id}`));
  }

  const subtitle = subtitleText(scope, count);
  const title = `${personName} · ${subtitle}`;
  const periodScoped = PERIOD_SCOPED.includes(scope);

  return createPortal(
    // z-overlay (50): escala de camadas do passo 32.2 (tailwind.config.ts).
    <div className="fixed inset-0 z-overlay flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-surface shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              {periodScoped ? `Detalhe · ${PERIOD_LABEL[period]}` : "Detalhe · situação atual"}
            </p>
            <h2 className="truncate text-lg font-semibold text-fg">{personName}</h2>
            <p className="mt-1 text-sm text-risd">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-fg-subtle">Carregando…</p>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-600 dark:text-red-400">
                Não foi possível carregar a lista.
              </p>
              <p className="mt-1 text-xs text-fg-subtle">{error}</p>
            </div>
          ) : taskScope ? (
            tasks.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-subtle">
                Nenhuma tarefa neste recorte.
              </p>
            ) : (
              // Lista de TAREFAS (colunas de atividade). Cada linha abre o
              // TaskDetailSheet unificado (z-sheet 60, por cima deste painel).
              <ul className="space-y-2">
                {tasks.map((t) => {
                  const ref = taskRefText(scope, t);
                  return (
                    <li key={t.id}>
                      <TaskDetailLink
                        taskId={t.id}
                        className="block w-full rounded-xl border border-line bg-surface p-3 text-left transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 font-medium text-fg">{t.title}</span>
                          {t.seconds !== null && (
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                              {fmtHoursShort(t.seconds)} h
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
                          <span className="inline-flex items-center rounded-full border border-line bg-surface-2/60 px-2 py-0.5">
                            {t.companyName}
                          </span>
                          {ref && (
                            <span
                              className={
                                scope === "atrasadas"
                                  ? "text-amber-700 dark:text-amber-300"
                                  : "text-fg-subtle"
                              }
                            >
                              {ref}
                            </span>
                          )}
                        </div>
                      </TaskDetailLink>
                    </li>
                  );
                })}
              </ul>
            )
          ) : companies.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-subtle">
              Nenhuma empresa neste recorte.
            </p>
          ) : (
            <ul className="space-y-2">
              {companies.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openCompany(c.id)}
                    disabled={pending}
                    className="block w-full rounded-xl border border-line bg-surface p-3 text-left transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 font-medium text-fg">{c.name}</span>
                      {navId === c.id && pending && (
                        <span className="shrink-0 text-xs text-fg-subtle">Abrindo…</span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center rounded-full border border-line bg-surface-2/60 px-2 py-0.5 text-[11px] text-fg-muted">
                        {c.group}
                      </span>
                      {c.labels.map((l) => (
                        <span
                          key={l.name}
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ backgroundColor: l.bgColor, color: l.textColor }}
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>

                    {/* Compartilhado: COM QUEM está dividido — é o que faz a
                        coluna útil na hora de distribuir. */}
                    {scope === "compartilhados" && c.sharedWith.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                        <span className="text-fg-subtle">Dividido com:</span>
                        {c.sharedWith.map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2/60 py-0.5 pl-0.5 pr-2"
                          >
                            <Avatar name={s.name || "?"} url={avatarUrl(s.avatarPath)} size={16} />
                            {s.name || "(sem nome)"}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Parados: há quantos dias sem contato (o alerta de verdade). */}
                    {scope === "parados" && c.daysSince !== null && (
                      <p className="mt-2 text-xs text-fg-muted">
                        <span className="font-medium text-rose-700 dark:text-rose-300">
                          {c.daysSince} dias
                        </span>{" "}
                        sem registro de contato
                      </p>
                    )}

                    {/* Sem registro: nunca houve registro — não é abandono, é
                        ausência no sistema (contato pela Digisac não vem ao CRM). */}
                    {scope === "sem_registro" && (
                      <p className="mt-2 text-xs text-fg-muted">
                        <span className="font-medium text-fg">Sem registro de contato</span>{" "}
                        no sistema (pode ter havido contato pela Digisac)
                      </p>
                    )}

                    {/* Fora da carteira: tem tarefa aberta aqui, mas não é o
                        responsável declarado — a exceção a corrigir. */}
                    {scope === "fora_da_carteira" && (
                      <p className="mt-2 text-xs text-fg-muted">
                        <span className="font-medium text-amber-700 dark:text-amber-300">
                          Tarefa em aberto
                        </span>{" "}
                        sem ser responsável por esta empresa
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}
