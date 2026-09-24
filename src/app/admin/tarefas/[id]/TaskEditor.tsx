"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskTemplate } from "@/lib/types";
import { updateTaskTemplate, type TodayGenStatus } from "../../actions";
import { categoryLabel } from "@/lib/task-category";
import Combobox from "@/components/Combobox";
import { DateField } from "@/components/DateField";
import ListingFields, {
  emptyListingForm,
  type ListingFormValue,
} from "../ListingFields";
import {
  inputClass,
  labelClass,
  hintClass,
  btnPrimary,
  chipClass,
} from "@/lib/ui";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };
type Status = "idle" | "saving" | "saved" | "error";
type Kind = "unica" | "diaria";

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "unica", label: "Única" },
  { value: "diaria", label: "Diária" },
];

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Status que MERECEM uma nota (ver createTaskTemplate/generate_template_today_edit).
type NotedStatus = "gerada" | "nao_e_dia" | "inativa" | "fora_do_periodo";

const TODAY_NOTE: Record<NotedStatus, { tone: "ok" | "warn"; text: string }> = {
  gerada: {
    tone: "ok",
    text: "A tarefa de hoje foi gerada. Se o horário-limite de hoje já passou, ela aparece como atrasada — o que é esperado, já que foi incluída agora.",
  },
  nao_e_dia: {
    tone: "warn",
    text: "Hoje não está marcado na recorrência, então nenhuma tarefa foi gerada para hoje.",
  },
  inativa: {
    tone: "warn",
    text: "A tarefa está inativa, então nenhuma ocorrência de hoje foi gerada.",
  },
  fora_do_periodo: {
    tone: "warn",
    text: "Hoje está fora do período de vigência (início/fim), então nenhuma tarefa foi gerada para hoje.",
  },
};

const TODAY_NOTE_CLASS: Record<"ok" | "warn", string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function isNotedStatus(s: TodayGenStatus): s is NotedStatus {
  return s === "gerada" || s === "nao_e_dia" || s === "inativa" || s === "fora_do_periodo";
}

export default function TaskEditor({
  template,
  companies,
  collaborators,
  brands: initialBrands = [],
  isAdmin = true,
}: {
  template: TaskTemplate;
  companies: Option[];
  collaborators: PersonOption[];
  brands?: string[];
  // O TIPO (única/diária) só o admin muda. Esta tela já é admin-only; a prop
  // mantém a regra explícita (o servidor também a reforça).
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const isListing = template.template_type === "listagem";
  // Tarefa anterior à padronização: sem categoria e sem ser listagem. O título
  // livre antigo é preservado (nunca recategorizamos o passado).
  const isLegacy = !template.category && !isListing;

  const [description, setDescription] = useState(template.description ?? "");
  const [instructions, setInstructions] = useState(template.instructions ?? "");
  const [companyId, setCompanyId] = useState(template.company_id);
  const [collaboratorId, setCollaboratorId] = useState(template.collaborator_id);
  const [kind, setKind] = useState<Kind>(
    template.kind === "diaria" ? "diaria" : "unica"
  );
  const [startDate, setStartDate] = useState(template.start_date ?? todayISO());
  const [dueTime, setDueTime] = useState(template.due_time?.slice(0, 5) ?? "");
  const [weekdays, setWeekdays] = useState<Set<number>>(
    new Set(template.weekdays ?? [])
  );
  const [endDate, setEndDate] = useState(template.end_date ?? "");
  const [listing, setListing] = useState<ListingFormValue>(() =>
    isListing
      ? {
          brands: initialBrands,
          marketplaces: new Set(template.listing_marketplaces ?? []),
          needsMargin: template.listing_needs_margin,
          taxRate:
            template.listing_tax_rate === null
              ? ""
              : String(template.listing_tax_rate),
        }
      : emptyListingForm()
  );
  const [active, setActive] = useState(template.active);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [todayNote, setTodayNote] = useState<TodayGenStatus | null>(null);
  const [, startTransition] = useTransition();

  // Pontual quando: listagem; ou tipo "única" (para não-admin, kind é sempre o
  // valor preservado — mas a tela é admin-only).
  const isPunctual = isListing || kind === "unica";

  function toggleWeekday(value: number) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setTodayNote(null);
    if (isPunctual && !startDate.trim()) {
      setErrorMsg("Informe a data da tarefa.");
      return;
    }
    setStatus("saving");

    // Categoria e título NÃO são enviados: o servidor preserva os do molde
    // (nada de recategorizar o passado). Enviamos apenas o que é editável.
    const { error, todayStatus } = await updateTaskTemplate(template.id, {
      description,
      instructions,
      companyId,
      collaboratorId,
      kind: isAdmin && !isListing && kind === "diaria" ? "diaria" : "unica",
      startDate,
      dueTime,
      weekdays: Array.from(weekdays),
      endDate,
      active,
      templateType: isListing ? "listagem" : "padrao",
      brands: isListing ? listing.brands : [],
      marketplaces: isListing ? Array.from(listing.marketplaces) : [],
      needsMargin: isListing ? listing.needsMargin : false,
      taxRate:
        isListing && listing.needsMargin && listing.taxRate.trim() !== ""
          ? Number(listing.taxRate)
          : null,
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }

    setStatus("saved");
    setTodayNote(todayStatus ?? null);
    startTransition(() => router.refresh());
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Categoria/título — SOMENTE LEITURA (não se recategoriza uma tarefa). */}
      <div>
        <p className={labelClass}>Categoria</p>
        {isLegacy ? (
          <div className="mt-1">
            <p className="text-sm text-fg">{template.title}</p>
            <p className={`mt-1 ${hintClass}`}>
              Tarefa anterior à padronização — mantém o título antigo e não
              recebe categoria.
            </p>
          </div>
        ) : (
          <div className="mt-1">
            <span className="inline-flex items-center rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm font-medium text-fg">
              {template.category
                ? categoryLabel(template.category)
                : "Listagem"}
            </span>
            <p className={`mt-1 ${hintClass}`}>
              O título é definido pela categoria e não é alterado na edição.
            </p>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="t-description" className={labelClass}>
          Descrição <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id="t-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="t-instructions" className={labelClass}>
          Instruções <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id="t-instructions"
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="t-company" className={labelClass}>
            Empresa
          </label>
          <Combobox
            id="t-company"
            value={companyId}
            onChange={setCompanyId}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            ariaLabel="Empresa"
            searchPlaceholder="Buscar empresa…"
          />
        </div>
        <div>
          <label htmlFor="t-collaborator" className={labelClass}>
            Colaborador
          </label>
          <Combobox
            id="t-collaborator"
            value={collaboratorId}
            onChange={setCollaboratorId}
            options={collaborators.map((p) => ({
              value: p.id,
              label: p.full_name || p.email,
            }))}
            ariaLabel="Colaborador"
            searchPlaceholder="Buscar colaborador…"
          />
        </div>
      </div>

      {/* Tipo — só admin, e não se aplica a Listagem (sempre pontual). */}
      {isAdmin && !isListing && (
        <fieldset>
          <legend className={labelClass}>Tipo</legend>
          <div className="flex flex-wrap gap-2">
            {KIND_OPTIONS.map((opt) => {
              const isActive = kind === opt.value;
              return (
                <label key={opt.value} className={chipClass(isActive)}>
                  <input
                    type="radio"
                    name="t-kind"
                    className="accent-risd"
                    checked={isActive}
                    onChange={() => setKind(opt.value)}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {isPunctual ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Data</label>
            <DateField
              value={startDate}
              onChange={setStartDate}
              ariaLabel="Data da tarefa"
            />
          </div>
          <div>
            <label htmlFor="t-due-unica" className={labelClass}>
              Horário <span className={hintClass}>(opcional)</span>
            </label>
            <input
              id="t-due-unica"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className={labelClass}>Dias da semana</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const checked = weekdays.has(d.value);
                return (
                  <label key={d.value} className={chipClass(checked)}>
                    <input
                      type="checkbox"
                      className="accent-risd"
                      checked={checked}
                      onChange={() => toggleWeekday(d.value)}
                    />
                    {d.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="t-due-diaria" className={labelClass}>
                Horário-limite <span className={hintClass}>(opcional)</span>
              </label>
              <input
                id="t-due-diaria"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                Encerra em <span className={hintClass}>(opcional)</span>
              </label>
              <DateField
                value={endDate}
                onChange={setEndDate}
                ariaLabel="Data em que a tarefa diária encerra"
              />
            </div>
          </div>
        </div>
      )}

      {isListing && (
        <ListingFields
          idPrefix="edit-listing"
          value={listing}
          onChange={(patch) => setListing((prev) => ({ ...prev, ...patch }))}
        />
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="accent-risd"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Tarefa ativa{" "}
        <span className="text-fg-subtle">
          (desmarque para parar a geração diária)
        </span>
      </label>

      {status === "error" && errorMsg && (
        <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
      )}

      {todayNote && isNotedStatus(todayNote) && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            TODAY_NOTE_CLASS[TODAY_NOTE[todayNote].tone]
          }`}
        >
          {TODAY_NOTE[todayNote].text}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={status === "saving"} className={btnPrimary}>
          {status === "saving" ? "Salvando…" : "Salvar alterações"}
        </button>
        <span className="text-xs" aria-live="polite">
          {status === "saved" && <span className="text-risd">Salvo</span>}
        </span>
      </div>
    </form>
  );
}
