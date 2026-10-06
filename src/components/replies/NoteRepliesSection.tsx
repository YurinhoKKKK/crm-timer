"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { NoteAttachmentMeta } from "@/lib/notes";
import { syncMentions } from "@/lib/mention-actions";
import ReplyThread, { classifyReplyError, type ReplyView } from "./ReplyThread";
import { fetchNoteReplies } from "./reply-actions";
import { toggleNoteReplyCheckbox } from "@/components/rich-text/task-checkbox-actions";
import type { NotesSource } from "@/components/notes-panel/notes-source";

// Conversa de UMA atualização da empresa. Encapsula o adaptador do
// company_note_replies (carregar sob demanda no servidor; inserir/editar via
// supabase-browser sob a RLS cnr_*, com autoria carimbada no banco) e delega
// TODO o desenho ao ReplyThread compartilhado — mesmo componente do suporte.
//
// A contagem no rótulo vem AGREGADA do banco (replyCount da atualização); depois
// de responder, o pai revalida (onChanged) e o número volta atualizado.
export default function NoteRepliesSection({
  noteId,
  companyId,
  userId,
  replyCount,
  onChanged,
  // Fonte alternativa (CS). Ausente = Atualizações normais (company_note_replies).
  source,
}: {
  noteId: string;
  companyId: string;
  userId: string;
  replyCount: number;
  onChanged?: () => void;
  source?: NotesSource;
}) {
  const [open, setOpen] = useState(false);

  const load = (): Promise<ReplyView[]> =>
    source ? source.loadReplies(noteId) : fetchNoteReplies(noteId);

  async function insert(
    parentId: string | null,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) {
    if (source) return source.insertReply(noteId, parentId, html, attachments);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("company_note_replies")
      .insert({
        note_id: noteId,
        parent_id: parentId,
        body_html: html,
        attachments,
        author_id: userId,
      })
      .select("id")
      .single();
    if (error) return { error: classifyReplyError(error) };
    // Menções extraídas/validadas no servidor a partir do conteúdo salvo.
    await syncMentions("atualizacao_resposta", data.id);
    return { error: null };
  }

  async function update(
    id: string,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) {
    if (source) return source.updateReply(id, html, attachments);
    const supabase = createClient();
    const { error } = await supabase
      .from("company_note_replies")
      .update({ body_html: html, attachments })
      .eq("id", id);
    if (error) return { error: classifyReplyError(error) };
    await syncMentions("atualizacao_resposta", id);
    return { error: null };
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <MessageSquare size={14} aria-hidden="true" />
        {replyCount > 0
          ? `${replyCount} ${replyCount === 1 ? "resposta" : "respostas"}`
          : "Responder"}
      </button>

      {open && (
        <div className="mt-3">
          <ReplyThread
            userId={userId}
            load={load}
            insert={insert}
            update={update}
            onChanged={onChanged}
            mentionContext={{
              sourceType: source ? source.mentionReplyType : "atualizacao_resposta",
              companyId,
            }}
            editorStorage={source?.editorStorage}
            toggleCheckbox={(id, index, checked, token) =>
              source
                ? source.toggleReplyCheckbox(id, token, index, checked)
                : toggleNoteReplyCheckbox(id, token, index, checked)
            }
          />
        </div>
      )}
    </div>
  );
}
