"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Combobox from "@/components/Combobox";
import ParticipantPicker from "./ParticipantPicker";
import { createMeeting, checkMeetingConflicts } from "@/app/meeting-actions";
import {
  MEETING_TYPE_OPTIONS,
  formatMeetingRange,
  type ConflictLike,
  type DirectoryUser,
  type MeetingType,
  type ReachableCompany,
} from "@/lib/meetings";
import {
  inputClass,
  labelClass,
  hintClass,
  btnPrimary,
  btnSecondary,
  chipClass,
} from "@/lib/ui";

// -----------------------------------------------------------------------------
// Conversão de fuso — o usuário sempre pensa em horário de Brasília.
// O <input type="datetime-local"> dá um wall-clock SEM fuso ("2026-08-05T14:30").
// Interpretamos SEMPRE como BRT e gravamos em UTC. Brasília não tem horário de
// verão desde 2019, então o offset é fixo -03:00 (mesmo pressuposto que o resto
// do sistema; ver docs/REUNIOES.md). Se o DST voltar, este é o único ponto a
// mudar.
// -----------------------------------------------------------------------------
function brtLocalToISO(local: string): string {
  if (!local) return "";
  const d = new Date(`${local.slice(0, 16)}:00-03:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// Formata um Date (cujos getters UTC já representam o wall-clock BRT) no formato
// aceito pelo input datetime-local.
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(
    d.getUTCDate()
  )}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Próxima hora cheia (BRT) para o início; +1h para o fim.
function defaultTimes(): { start: string; end: string } {
  const brt = new Date(Date.now() - 3 * 3600 * 1000); // desloca p/ wall-clock BRT
  brt.setUTCMinutes(0, 0, 0);
  brt.setUTCHours(brt.getUTCHours() + 1);
  const end = new Date(brt.getTime() + 3600 * 1000);
  return { start: toLocalInput(brt), end: toLocalInput(end) };
}

type Result = { warning: string | null } | null;

export default function NewMeetingForm({
  directory,
  companies,
  lockedCompany,
}: {
  directory: DirectoryUser[];
  // Empresas alcançáveis — só quando a empresa NÃO vem travada (página /agenda).
  companies?: ReachableCompany[];
  // Dentro da central da empresa: empresa pré-selecionada e travada.
  lockedCompany?: ReachableCompany;
}) {
  const router = useRouter();
  const initial = defaultTimes();

  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(lockedCompany?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<MeetingType>("meet");
  const [startLocal, setStartLocal] = useState(initial.start);
  const [endLocal, setEndLocal] = useState(initial.end);
  const [participants, setParticipants] = useState<Set<string>>(new Set());

  const [conflicts, setConflicts] = useState<ConflictLike[]>([]);
  const [checking, setChecking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const nameById = new Map(directory.map((u) => [u.id, u.name]));
  const participantsKey = Array.from(participants).sort().join(",");

  // Verificação de conflito — reage a horário/participantes, com debounce. Um
  // token de sequência descarta respostas de uma consulta antiga (evita piscar
  // um resultado desatualizado se a rede voltar fora de ordem).
  const seqRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const startISO = brtLocalToISO(startLocal);
    const endISO = brtLocalToISO(endLocal);
    if (!startISO || !endISO || new Date(endISO) <= new Date(startISO)) {
      setConflicts([]);
      setChecking(false);
      return;
    }
    const seq = ++seqRef.current;
    setChecking(true);
    const timer = setTimeout(async () => {
      const rows = await checkMeetingConflicts(
        startISO,
        endISO,
        Array.from(participants)
      );
      if (seq !== seqRef.current) return; // resposta obsoleta
      setConflicts(rows);
      setChecking(false);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startLocal, endLocal, participantsKey]);

  const currentCompanyName =
    lockedCompany?.name ??
    companies?.find((c) => c.id === companyId)?.name ??
    "";

  function resetFields() {
    setCompanyId(lockedCompany?.id ?? "");
    setTitle("");
    setDescription("");
    setType("meet");
    const t = defaultTimes();
    setStartLocal(t.start);
    setEndLocal(t.end);
    setParticipants(new Set());
    setConflicts([]);
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // trava reentrância

    const startISO = brtLocalToISO(startLocal);
    const endISO = brtLocalToISO(endLocal);
    if (!companyId) return setFormError("Escolha a empresa.");
    if (!title.trim()) return setFormError("Informe um título para a reunião.");
    if (!startISO || !endISO)
      return setFormError("Informe o início e o fim da reunião.");
    if (new Date(endISO) <= new Date(startISO))
      return setFormError("O fim deve ser depois do início.");

    setFormError(null);
    setSubmitting(true);
    try {
      const res = await createMeeting({
        companyId,
        companyName: currentCompanyName,
        title,
        description,
        type,
        startISO,
        endISO,
        participantIds: Array.from(participants),
      });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      // Banco salvou. O banner reflete a sincronização (ou o aviso).
      setResult({ warning: res.warning });
      resetFields();
      setOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-6">
      {result && (
        <div
          className={`mb-4 flex items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
            result.warning
              ? "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              : "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
          }`}
        >
          <span>
            {result.warning ??
              "Reunião criada e adicionada à sua agenda do Google."}
          </span>
          <button
            type="button"
            onClick={() => setResult(null)}
            aria-label="Fechar aviso"
            className="shrink-0 rounded p-0.5 text-current/70 transition hover:text-current"
          >
            ✕
          </button>
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
          className={btnPrimary}
        >
          Nova reunião
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
        >
          <h2 className="font-semibold text-fg">Nova reunião</h2>

          <div>
            <label htmlFor="meeting-company" className={labelClass}>
              Empresa
            </label>
            {lockedCompany ? (
              <div
                id="meeting-company"
                className={`${inputClass} flex items-center justify-between bg-surface-2 text-fg-muted`}
              >
                <span className="truncate">{lockedCompany.name}</span>
                <span className="ml-2 shrink-0 text-xs text-fg-subtle">
                  empresa atual
                </span>
              </div>
            ) : (
              <Combobox
                id="meeting-company"
                value={companyId}
                onChange={setCompanyId}
                options={(companies ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                ariaLabel="Empresa"
                searchPlaceholder="Buscar empresa…"
              />
            )}
          </div>

          <div>
            <label htmlFor="meeting-title" className={labelClass}>
              Título
            </label>
            <input
              id="meeting-title"
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              autoFocus
            />
          </div>

          <fieldset>
            <legend className={labelClass}>Tipo</legend>
            <div className="flex flex-wrap gap-2">
              {MEETING_TYPE_OPTIONS.map((opt) => {
                const active = type === opt.value;
                return (
                  <label key={opt.value} className={chipClass(active)}>
                    <input
                      type="radio"
                      name="meeting-type"
                      className="accent-risd"
                      checked={active}
                      onChange={() => setType(opt.value)}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
            {type === "meet" && (
              <p className="mt-1.5 text-xs text-fg-subtle">
                O link do Google Meet é gerado automaticamente ao criar.
              </p>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="meeting-start" className={labelClass}>
                Início <span className={hintClass}>(horário de Brasília)</span>
              </label>
              <input
                id="meeting-start"
                type="datetime-local"
                required
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="meeting-end" className={labelClass}>
                Fim <span className={hintClass}>(horário de Brasília)</span>
              </label>
              <input
                id="meeting-end"
                type="datetime-local"
                required
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="meeting-description" className={labelClass}>
              Descrição <span className={hintClass}>(opcional)</span>
            </label>
            <textarea
              id="meeting-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <p className={labelClass}>
              Participantes internos{" "}
              <span className={hintClass}>
                (recebem o convite por e-mail; o cliente não é convidado)
              </span>
            </p>
            <ParticipantPicker
              users={directory}
              selected={participants}
              onChange={setParticipants}
            />
          </div>

          <ConflictNotice
            checking={checking}
            conflicts={conflicts}
            nameById={nameById}
          />

          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting || isPending}
              className={btnPrimary}
            >
              {submitting || isPending ? "Criando…" : "Criar reunião"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetFields();
                setOpen(false);
              }}
              className={btnSecondary}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// Aviso de sobreposição — não bloqueia. Deixa claro que só cobre reuniões do
// sistema (eventos direto no Google entram na Fatia 2).
function ConflictNotice({
  checking,
  conflicts,
  nameById,
}: {
  checking: boolean;
  conflicts: ConflictLike[];
  nameById: Map<string, string>;
}) {
  if (checking && conflicts.length === 0) {
    return <p className="text-xs text-fg-subtle">Verificando conflitos…</p>;
  }
  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="font-medium text-amber-800 dark:text-amber-200">
        Possível conflito de horário
      </p>
      <ul className="mt-1.5 space-y-1 text-amber-800 dark:text-amber-200">
        {conflicts.map((c) => {
          const who = c.userIds
            .map((id) => nameById.get(id) ?? "alguém")
            .join(", ");
          return (
            <li key={c.meetingId}>
              <span className="font-medium">{who}</span> já tem “{c.title}” (
              {c.companyName}) das {formatMeetingRange(c.startsAt, c.endsAt)}.
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-amber-700/90 dark:text-amber-300/80">
        É só um aviso — você pode criar mesmo assim. A verificação cobre apenas
        reuniões deste sistema; eventos marcados direto no Google ainda não são
        vistos.
      </p>
    </div>
  );
}
