"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Combobox from "@/components/Combobox";
import { DateTimeField } from "@/components/DateField";
import ParticipantPicker from "./ParticipantPicker";
import {
  createMeeting,
  updateMeeting,
  checkMeetingConflicts,
} from "@/app/meeting-actions";
import {
  MEETING_TYPE_OPTIONS,
  MEETING_ROOM_OPTIONS,
  describeConflict,
  type ConflictLike,
  type DirectoryUser,
  type MeetingRoom,
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
// verão desde 2019, então o offset é fixo -03:00 (mesmo pressuposto do resto do
// sistema; ver docs/REUNIOES.md). Se o DST voltar, este é o único ponto a mudar.
// -----------------------------------------------------------------------------
function brtLocalToISO(local: string): string {
  if (!local) return "";
  const d = new Date(`${local.slice(0, 16)}:00-03:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// Formata um Date (cujos getters UTC já representam o wall-clock BRT) no formato
// do input datetime-local.
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(
    d.getUTCDate()
  )}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ISO (UTC do banco) → string BRT do input (desloca -3h e usa os getters UTC).
function isoToBrtLocal(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return toLocalInput(new Date(t - 3 * 3600 * 1000));
}

// Próxima hora cheia (BRT) para o início; +1h para o fim.
function defaultTimes(): { start: string; end: string } {
  const brt = new Date(Date.now() - 3 * 3600 * 1000); // desloca p/ wall-clock BRT
  brt.setUTCMinutes(0, 0, 0);
  brt.setUTCHours(brt.getUTCHours() + 1);
  const end = new Date(brt.getTime() + 3600 * 1000);
  return { start: toLocalInput(brt), end: toLocalInput(end) };
}

export type MeetingInitial = {
  companyId: string;
  companyName: string;
  title: string;
  description: string;
  type: MeetingType;
  room: MeetingRoom | null;
  startISO: string; // UTC
  endISO: string; // UTC
  participantIds: string[];
};

// Formulário de reunião compartilhado por CRIAR e EDITAR. Mesmos campos; a única
// diferença é a action chamada, o rótulo do botão e (na edição) excluir a
// própria reunião do aviso de conflito. Controlado pelo pai via onDone/onCancel.
export default function MeetingForm({
  mode,
  directory,
  companies,
  lockedCompany,
  meetingId,
  initial,
  prefillStartISO,
  prefillEndISO,
  bare,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  directory: DirectoryUser[];
  // Empresas alcançáveis — quando a empresa NÃO vem travada (página /agenda).
  companies?: ReachableCompany[];
  // Empresa pré-selecionada e travada (central da empresa).
  lockedCompany?: ReachableCompany;
  meetingId?: string; // obrigatório em mode="edit"
  initial?: MeetingInitial;
  // Horário pré-preenchido ao criar clicando num espaço vazio da grade (create).
  prefillStartISO?: string;
  prefillEndISO?: string;
  // `bare`: sem a moldura de cartão (para dentro de um Modal, que já a tem).
  bare?: boolean;
  onDone: (warning: string | null) => void;
  onCancel: () => void;
}) {
  const startInit = initial
    ? isoToBrtLocal(initial.startISO)
    : prefillStartISO
    ? isoToBrtLocal(prefillStartISO)
    : defaultTimes().start;
  const endInit = initial
    ? isoToBrtLocal(initial.endISO)
    : prefillEndISO
    ? isoToBrtLocal(prefillEndISO)
    : defaultTimes().end;

  const [companyId, setCompanyId] = useState(
    initial?.companyId ?? lockedCompany?.id ?? ""
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState<MeetingType>(initial?.type ?? "meet");
  // Sala reservada — só se aplica a presencial no escritório. Guardamos a escolha
  // mesmo se o tipo mudar (para restaurar ao voltar); o envio ignora fora do
  // escritório, e o servidor normaliza de novo (fonte da verdade).
  const [room, setRoom] = useState<MeetingRoom | null>(initial?.room ?? null);
  const [startLocal, setStartLocal] = useState(startInit);
  const [endLocal, setEndLocal] = useState(endInit);
  const [participants, setParticipants] = useState<Set<string>>(
    new Set(initial?.participantIds ?? [])
  );

  const [conflicts, setConflicts] = useState<ConflictLike[]>([]);
  const [checking, setChecking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const nameById = new Map(directory.map((u) => [u.id, u.name]));
  const participantsKey = Array.from(participants).sort().join(",");

  // Verificação de conflito — reage a horário/participantes, com debounce. Um
  // token de sequência descarta respostas de uma consulta antiga. Na edição,
  // exclui a própria reunião para ela não conflitar consigo mesma.
  const seqRef = useRef(0);
  useEffect(() => {
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
        Array.from(participants),
        meetingId
      );
      if (seq !== seqRef.current) return; // resposta obsoleta
      setConflicts(rows);
      setChecking(false);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLocal, endLocal, participantsKey]);

  const currentCompanyName =
    lockedCompany?.name ??
    companies?.find((c) => c.id === companyId)?.name ??
    initial?.companyName ??
    "";

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
      const payload = {
        companyId,
        companyName: currentCompanyName,
        title,
        description,
        type,
        room: type === "presencial_escritorio" ? room : null,
        startISO,
        endISO,
        participantIds: Array.from(participants),
      };
      const res =
        mode === "edit" && meetingId
          ? await updateMeeting({ ...payload, meetingId })
          : await createMeeting(payload);
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      startTransition(() => onDone(res.warning));
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel =
    mode === "edit"
      ? submitting || isPending
        ? "Salvando…"
        : "Salvar alterações"
      : submitting || isPending
      ? "Criando…"
      : "Criar reunião";

  const header = (
    <h2 className="font-semibold text-fg">
      {mode === "edit" ? "Editar reunião" : "Nova reunião"}
    </h2>
  );

  const footer = (
    <div className="flex items-center gap-2">
      <button
        type="submit"
        disabled={submitting || isPending}
        className={btnPrimary}
      >
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel} className={btnSecondary}>
        Cancelar
      </button>
    </div>
  );

  // Campos do formulário — compartilhados pelos dois layouts (modal com rodapé
  // fixo x cartão inline). No modal, este bloco é a ÚNICA parte que rola.
  const body = (
    <>
      <div>
        <label htmlFor="meeting-company" className={labelClass}>
          Empresa
        </label>
        {lockedCompany || !companies ? (
          <div
            id="meeting-company"
            className={`${inputClass} flex items-center justify-between bg-surface-2 text-fg-muted`}
          >
            <span className="truncate">
              {lockedCompany?.name ?? currentCompanyName}
            </span>
            <span className="ml-2 shrink-0 text-xs text-fg-subtle">
              {lockedCompany ? "empresa atual" : "não alterável aqui"}
            </span>
          </div>
        ) : (
          <Combobox
            id="meeting-company"
            value={companyId}
            onChange={setCompanyId}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
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
            {mode === "edit"
              ? "Se ainda não houver, o link do Google Meet é gerado ao salvar."
              : "O link do Google Meet é gerado automaticamente ao criar."}
          </p>
        )}
      </fieldset>

      {/* Sala do escritório — só faz sentido em presencial no escritório. A sala
          é convidada como participante no Google: se estiver livre, ela aceita
          (reserva feita); se já estiver ocupada, recusa — e isso aparece depois
          no quadro de participantes. */}
      {type === "presencial_escritorio" && (
        <fieldset>
          <legend className={labelClass}>
            Sala <span className={hintClass}>(opcional)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            <label className={chipClass(room === null)}>
              <input
                type="radio"
                name="meeting-room"
                className="accent-risd"
                checked={room === null}
                onChange={() => setRoom(null)}
              />
              Sem sala
            </label>
            {MEETING_ROOM_OPTIONS.map((opt) => {
              const active = room === opt.value;
              return (
                <label key={opt.value} className={chipClass(active)}>
                  <input
                    type="radio"
                    name="meeting-room"
                    className="accent-risd"
                    checked={active}
                    onChange={() => setRoom(opt.value)}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-fg-subtle">
            A sala é reservada na agenda do escritório ao salvar. Se já estiver
            ocupada no horário, o Google recusa a reserva.
          </p>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            Início <span className={hintClass}>(horário de Brasília)</span>
          </label>
          <DateTimeField
            value={startLocal}
            onChange={setStartLocal}
            ariaLabel="Início da reunião"
          />
        </div>
        <div>
          <label className={labelClass}>
            Fim <span className={hintClass}>(horário de Brasília)</span>
          </label>
          <DateTimeField
            value={endLocal}
            onChange={setEndLocal}
            ariaLabel="Fim da reunião"
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
    </>
  );

  // Dentro do Modal (`bare`): cabeçalho e ações FIXOS; só o corpo rola. O painel
  // dá a altura (max-h da viewport) e o form a preenche como coluna flex, então
  // o rodapé com "Criar/Cancelar" fica sempre alcançável, mesmo em 1366×768 ou
  // no celular. Ver Modal (modo flush).
  if (bare) {
    return (
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-line px-5 pb-3 pt-5 sm:px-6">
          {header}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          {body}
        </div>
        <div className="shrink-0 border-t border-line bg-surface px-5 py-4 sm:px-6">
          {footer}
        </div>
      </form>
    );
  }

  // Cartão inline (central da empresa): a própria página rola.
  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
    >
      {header}
      {body}
      {footer}
    </form>
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
          const { who, tail } = describeConflict(c, nameById);
          return (
            <li key={`${c.source}-${c.refId}`}>
              <span className="font-medium">{who}</span>
              {tail}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-amber-700/90 dark:text-amber-300/80">
        É só um aviso — você pode salvar mesmo assim. A verificação cobre as
        reuniões deste sistema e os eventos da sua agenda do Google.
      </p>
    </div>
  );
}
