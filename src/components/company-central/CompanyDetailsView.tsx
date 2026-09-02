"use client";

import { useMemo, useState } from "react";
import { btnPrimary, btnSecondary, inputClass, labelClass } from "@/lib/ui";
import { CHANNEL_LABEL, SALES_CHANNELS, type SalesChannel } from "@/lib/revenue";
import {
  saveCompanyDetails,
  fetchCompanyDetails,
} from "@/app/company-details-actions";
import {
  CADENCES,
  CADENCE_LABEL,
  PROJECT_MODELS,
  PROJECT_MODEL_LABEL,
  computePeriodInfo,
  formatPureDate,
  todayBRT,
  type CompanyDetails,
  type PeriodInfo,
} from "@/lib/company-details";

// Data/hora em Brasília (mesmo padrão do resto do sistema).
function formatDateTimeBR(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const dayWord = (n: number) => (Math.abs(n) === 1 ? "dia" : "dias");

// "não informado" para todo campo vazio (nunca espaço em branco sem explicação).
function Empty() {
  return <span className="text-fg-subtle">não informado</span>;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-fg-subtle">{label}</p>
      <div className="mt-1 text-sm text-fg">{children}</div>
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

// --- Período do contrato: leitura (Monday-style) -----------------------------
function PeriodDisplay({ info }: { info: PeriodInfo }) {
  if (info.state === "empty") return <Empty />;

  const remainingText = (remaining: number, ended: boolean) => {
    if (ended)
      return (
        <span className="rounded-full bg-fg-subtle/15 px-2 py-0.5 text-xs font-medium text-fg-muted">
          encerrado
        </span>
      );
    if (remaining === 0)
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          encerra hoje
        </span>
      );
    return (
      <span className="text-fg-muted">
        faltam{" "}
        <strong className="font-semibold text-fg tabular-nums">
          {remaining}
        </strong>{" "}
        {dayWord(remaining)}
      </span>
    );
  };

  if (info.state === "start_only") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tabular-nums text-fg">
          {formatPureDate(info.startedOn)}
        </span>
        <span className="text-fg-subtle">→</span>
        <span className="text-fg-subtle">término em aberto</span>
      </div>
    );
  }

  if (info.state === "end_only") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-fg-subtle">início em aberto</span>
        <span className="text-fg-subtle">→</span>
        <span className="tabular-nums text-fg">
          {formatPureDate(info.endsOn)}
        </span>
        <span className="text-fg-subtle">·</span>
        {remainingText(info.remaining, info.ended)}
      </div>
    );
  }

  // full
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="tabular-nums text-fg">
        {formatPureDate(info.startedOn)}
      </span>
      <span className="text-fg-subtle">→</span>
      <span className="tabular-nums text-fg">{formatPureDate(info.endsOn)}</span>
      <span className="text-fg-subtle">·</span>
      <span className="text-fg-muted">
        <strong className="font-semibold text-fg tabular-nums">
          {info.totalDays}
        </strong>{" "}
        {dayWord(info.totalDays)} no total
      </span>
      <span className="text-fg-subtle">·</span>
      {remainingText(info.remaining, info.ended)}
    </div>
  );
}

// --- Marketplaces contratados x ativos no faturamento (decisão 2) ------------
function ContractedChannels({ data }: { data: CompanyDetails }) {
  const contracted = data.contractedChannels;
  const active = data.activeChannels; // null = colaborador (não vê faturamento)

  if (contracted.length === 0 && (active === null || active.length === 0)) {
    return <Empty />;
  }

  // Colaborador: só a lista de contratados, sem cruzar com faturamento.
  if (active === null) {
    return (
      <div className="flex flex-wrap gap-2">
        {contracted.map((c) => (
          <span
            key={c}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-fg"
          >
            {CHANNEL_LABEL[c]}
          </span>
        ))}
      </div>
    );
  }

  const notYetActive = contracted.filter((c) => !active.includes(c));
  const activeNotContracted = active.filter((c) => !contracted.includes(c));

  return (
    <div className="space-y-3">
      {contracted.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {contracted.map((c) => {
            const on = active.includes(c);
            return (
              <span
                key={c}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm ${
                  on
                    ? "border-line bg-surface-2 text-fg"
                    : "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                }`}
              >
                {CHANNEL_LABEL[c]}
                <span
                  className={`text-xs ${
                    on ? "text-emerald-600 dark:text-emerald-400" : ""
                  }`}
                >
                  {on ? "· ativo no faturamento" : "· ainda não ativado"}
                </span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-fg-subtle">
          Nenhum marketplace contratado informado.
        </p>
      )}

      {notYetActive.length > 0 && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <strong className="font-semibold">Falta ativar:</strong>{" "}
          {notYetActive.map((c) => CHANNEL_LABEL[c]).join(", ")} — contratado(s)
          mas ainda sem operação no faturamento.
        </p>
      )}

      {activeNotContracted.length > 0 && (
        <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <strong className="font-semibold">Cadastro incompleto:</strong>{" "}
          {activeNotContracted.map((c) => CHANNEL_LABEL[c]).join(", ")} —
          ativo(s) no faturamento mas não consta(m) como contratado(s).
        </p>
      )}
    </div>
  );
}

// --- Leitura -----------------------------------------------------------------
function ReadView({ data }: { data: CompanyDetails }) {
  const info = useMemo(
    () => computePeriodInfo(data.startedOn, data.endsOn, todayBRT()),
    [data.startedOn, data.endsOn]
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <Field
          label="Modelo do projeto"
          hint="Campo independente da etiqueta CONSULTORIA/BPO — mudar um não muda o outro."
        >
          {data.projectModel ? (
            PROJECT_MODEL_LABEL[data.projectModel]
          ) : (
            <Empty />
          )}
        </Field>

        <Field label="Cadência de contato">
          {data.cadence ? CADENCE_LABEL[data.cadence] : <Empty />}
        </Field>

        <div className="sm:col-span-2">
          <Field label="Período do contrato">
            <PeriodDisplay info={info} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Marketplaces contratados">
            <ContractedChannels data={data} />
          </Field>
        </div>
      </div>

      <Field label="Sistema utilizado">
        {data.systemUsed ? (
          <p className="whitespace-pre-wrap">{data.systemUsed}</p>
        ) : (
          <Empty />
        )}
      </Field>

      <Field label="Maior dor">
        {data.mainPain ? (
          <p className="whitespace-pre-wrap">{data.mainPain}</p>
        ) : (
          <Empty />
        )}
      </Field>

      <Field label="Sobre">
        {data.about ? (
          <p className="whitespace-pre-wrap">{data.about}</p>
        ) : (
          <Empty />
        )}
      </Field>

      {data.updatedAtISO && (
        <p className="border-t border-line pt-4 text-xs text-fg-subtle">
          Atualizado por{" "}
          <span className="font-medium text-fg-muted">
            {data.updatedByName ?? "autor não registrado"}
          </span>{" "}
          em {formatDateTimeBR(data.updatedAtISO)}
        </p>
      )}
    </div>
  );
}

// --- Edição (só admin) -------------------------------------------------------
function EditView({
  data,
  onCancel,
  onSaved,
}: {
  data: CompanyDetails & { companyId: string };
  onCancel: () => void;
  onSaved: (next: CompanyDetails) => void;
}) {
  const [projectModel, setProjectModel] = useState(data.projectModel ?? "");
  const [cadence, setCadence] = useState(data.cadence ?? "");
  const [startedOn, setStartedOn] = useState(data.startedOn ?? "");
  const [endsOn, setEndsOn] = useState(data.endsOn ?? "");
  const [systemUsed, setSystemUsed] = useState(data.systemUsed ?? "");
  const [mainPain, setMainPain] = useState(data.mainPain ?? "");
  const [about, setAbout] = useState(data.about ?? "");
  const [channels, setChannels] = useState<Set<SalesChannel>>(
    () => new Set(data.contractedChannels)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewInfo = useMemo(
    () => computePeriodInfo(startedOn || null, endsOn || null, todayBRT()),
    [startedOn, endsOn]
  );
  const invertedDates = !!startedOn && !!endsOn && endsOn < startedOn;

  const toggleChannel = (c: SalesChannel) =>
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const save = async () => {
    if (invertedDates) {
      setError("A data de término não pode ser antes da de início.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveCompanyDetails(data.companyId, {
      projectModel,
      startedOn,
      endsOn,
      cadence,
      systemUsed,
      mainPain,
      about,
      channels: Array.from(channels),
    });
    if (res.error) {
      setSaving(false);
      setError(res.error);
      return;
    }
    // Ressincroniza com os valores autoritativos (updated_at/updated_by reais).
    const next = await fetchCompanyDetails(data.companyId);
    setSaving(false);
    if (next) onSaved(next);
    else onCancel();
  };

  const sel =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

  return (
    <div className="space-y-6">
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="cd-model">
            Modelo do projeto
          </label>
          <select
            id="cd-model"
            value={projectModel}
            onChange={(e) => setProjectModel(e.target.value)}
            className={sel}
          >
            <option value="">— não informado —</option>
            {PROJECT_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-fg-subtle">
            Independente da etiqueta CONSULTORIA/BPO — mudar um não muda o outro.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="cd-cadence">
            Cadência de contato
          </label>
          <select
            id="cd-cadence"
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            className={sel}
          >
            <option value="">— não informado —</option>
            {CADENCES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Período do contrato</label>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
            <div>
              <span className="mb-1 block text-xs text-fg-subtle">Início</span>
              <input
                type="date"
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
                className={inputClass}
                aria-label="Data de início do contrato"
              />
            </div>
            <div>
              <span className="mb-1 block text-xs text-fg-subtle">Término</span>
              <input
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                className={inputClass}
                aria-label="Data de término do contrato"
              />
            </div>
            {(startedOn || endsOn) && (
              <button
                type="button"
                onClick={() => {
                  setStartedOn("");
                  setEndsOn("");
                }}
                className="pb-2 text-xs text-fg-subtle underline underline-offset-2 hover:text-risd"
              >
                limpar datas
              </button>
            )}
          </div>
          <div className="mt-2 text-sm">
            {invertedDates ? (
              <p className="text-red-600 dark:text-red-400">
                O término não pode ser antes do início.
              </p>
            ) : (
              <PeriodDisplay info={previewInfo} />
            )}
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Marketplaces contratados</label>
          <p className="mb-2 text-xs text-fg-subtle">
            O que foi vendido no contrato. Diferente dos canais já ativos no
            faturamento (aquilo já começou a operar) — não sincroniza com eles.
          </p>
          <div className="flex flex-wrap gap-2">
            {SALES_CHANNELS.map((c) => {
              const on = channels.has(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => toggleChannel(c.value)}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                    on
                      ? "border-risd bg-brand-tint text-fg"
                      : "border-line bg-surface text-fg-muted hover:border-risd/50"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-4 w-4 place-items-center rounded border ${
                      on ? "border-risd bg-risd text-white" : "border-line"
                    }`}
                  >
                    {on && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="cd-system">
          Sistema utilizado
        </label>
        <textarea
          id="cd-system"
          value={systemUsed}
          onChange={(e) => setSystemUsed(e.target.value)}
          rows={4}
          className={inputClass}
          placeholder="Ex.: Bling, Tiny, planilhas próprias…"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="cd-pain">
          Maior dor
        </label>
        <textarea
          id="cd-pain"
          value={mainPain}
          onChange={(e) => setMainPain(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="cd-about">
          Sobre
        </label>
        <textarea
          id="cd-about"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={5}
          className={inputClass}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || invertedDates}
          className={btnPrimary}
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={btnSecondary}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// Tela "Informações do cliente" — modo leitura por padrão; admin edita.
// A carga vem já escopada pela RLS; canEdit reflete o cargo (admin).
export default function CompanyDetailsView({
  companyId,
  initial,
  canEdit,
}: {
  companyId: string;
  initial: CompanyDetails;
  canEdit: boolean;
}) {
  // companyId anexado ao data para as sub-ações (evita passar em todo lugar).
  const [data, setData] = useState<CompanyDetails & { companyId: string }>({
    ...initial,
    companyId,
  });
  const [editing, setEditing] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">
            Informações do cliente
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Modelo, contrato, cadência e contexto comercial deste cliente. Não
            aparece no portal do cliente.
          </p>
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => {
              setSavedFlash(false);
              setEditing(true);
            }}
            className={btnSecondary}
          >
            Editar
          </button>
        )}
      </div>

      {savedFlash && !editing && (
        <p className="mb-6 rounded-lg border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          Informações salvas.
        </p>
      )}

      {editing ? (
        <EditView
          data={data}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setData({ ...next, companyId });
            setEditing(false);
            setSavedFlash(true);
          }}
        />
      ) : (
        <ReadView data={data} />
      )}
    </section>
  );
}
