"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase-browser";
import type { NoteAttachmentMeta } from "@/lib/notes";
import {
  URGENCY_ORDER,
  URGENCY_UI,
  ISSUE_TYPE_ORDER,
  ISSUE_TYPE_UI,
  type TicketUrgency,
  type TicketIssueType,
} from "@/lib/support";
import { inputClass, labelClass } from "@/lib/ui";

// O editor (TipTap) das anotações — carregado sob demanda (só entra no bundle
// quando alguém abre um chamado), como em CompanyNotes.
const NoteEditor = dynamic(
  () => import("@/components/company-central/NoteEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-subtle shadow-card">
        Carregando editor…
      </div>
    ),
  }
);

// Chip selecionável para urgência / tipo de B.O — a cor acompanha o rótulo em
// texto (nunca só a cor). Fora de seleção fica neutro; selecionado ganha a cor
// da categoria.
function ChoiceChip({
  active,
  colorChip,
  onClick,
  children,
}: {
  active: boolean;
  colorChip: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`select-none rounded-lg border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
        active
          ? colorChip
          : "border-line bg-surface text-fg-muted hover:border-risd/50"
      }`}
    >
      {children}
    </button>
  );
}

// Formulário de abertura de chamado. Os campos próprios (título, urgência, tipo)
// ficam acima; o "Contexto" reusa o NoteEditor (mesmo upload de imagem/arquivo),
// cujo botão de salvar é o submit do formulário — daí a validação dos campos
// obrigatórios acontece dentro do onSave (devolve { error } para o editor
// exibir sem fechar). O toggle "visível ao cliente" não aparece: chamado é 100%
// interno.
export default function TicketForm({
  userId,
  onCreated,
  onCancel,
}: {
  userId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [urgency, setUrgency] = useState<TicketUrgency | "">("");
  const [issueType, setIssueType] = useState<TicketIssueType | "">("");

  async function submit(
    html: string,
    _visibleToClient: boolean,
    attachments: NoteAttachmentMeta[]
  ) {
    const cleanTitle = title.trim();
    if (cleanTitle.length < 3) {
      return { error: "Informe um título com pelo menos 3 caracteres." };
    }
    if (!urgency) return { error: "Escolha a urgência do chamado." };
    if (!issueType) return { error: "Escolha o tipo de B.O." };

    const supabase = createClient();
    const { error } = await supabase.from("support_tickets").insert({
      title: cleanTitle,
      context_html: html,
      attachments,
      urgency,
      issue_type: issueType,
      created_by: userId,
    });
    if (error) return { error: error.message };
    onCreated();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
        <div className="mb-4">
          <label className={labelClass} htmlFor="ticket-title">
            Título
          </label>
          <input
            id="ticket-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Resuma o chamado…"
            className={inputClass}
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="mb-4">
          <span className={labelClass}>Urgência</span>
          <div className="flex flex-wrap gap-2">
            {URGENCY_ORDER.map((u) => (
              <ChoiceChip
                key={u}
                active={urgency === u}
                colorChip={URGENCY_UI[u].chip}
                onClick={() => setUrgency(u)}
              >
                {URGENCY_UI[u].label}
              </ChoiceChip>
            ))}
          </div>
        </div>

        <div>
          <span className={labelClass}>Tipo de B.O</span>
          <div className="flex flex-wrap gap-2">
            {ISSUE_TYPE_ORDER.map((t) => (
              <ChoiceChip
                key={t}
                active={issueType === t}
                colorChip={ISSUE_TYPE_UI[t].chip}
                onClick={() => setIssueType(t)}
              >
                {ISSUE_TYPE_UI[t].label}
              </ChoiceChip>
            ))}
          </div>
        </div>
      </div>

      <div>
        <span className={`${labelClass} px-1`}>Contexto</span>
        <NoteEditor
          userId={userId}
          showClientVisibility={false}
          saveLabel="Abrir chamado"
          onSave={submit}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
