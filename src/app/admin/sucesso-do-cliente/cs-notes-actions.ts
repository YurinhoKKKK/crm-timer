"use server";

import { createClient } from "@/lib/supabase-server";
import { guardRole } from "@/components/guardRole";
import { syncMentions } from "@/lib/mention-actions";
import type { NoteAttachmentMeta, CompanyNoteView, NoteReplyView } from "@/lib/notes";
import { loadCsNotes, loadCsNoteReplies } from "@/lib/cs-notes";

// Leitura/escrita das "Atualizações do CS". Admin-only: a RLS de cs_notes/
// cs_note_replies é a barreira (um não-admin lê vazio e tem insert/update
// recusados); as leituras passam por guardRole(["admin"]). As menções são
// reconciliadas pelo MESMO syncMentions (source_type 'cs_note'/'cs_note_reply'),
// que no servidor ignora quem não é admin.

export async function getCsNotes(
  companyId: string
): Promise<{ error: string | null; notes?: CompanyNoteView[] }> {
  const { supabase } = await guardRole(["admin"]);
  try {
    return { error: null, notes: await loadCsNotes(supabase, companyId) };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Não foi possível carregar as atualizações do CS.",
    };
  }
}

export async function getCsNoteReplies(noteId: string): Promise<NoteReplyView[]> {
  const { supabase } = await guardRole(["admin"]);
  return loadCsNoteReplies(supabase, noteId);
}

export async function createCsNote(
  companyId: string,
  html: string,
  attachments: NoteAttachmentMeta[]
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sua sessão expirou. Recarregue a página." };

  const { data, error } = await supabase
    .from("cs_notes")
    .insert({ company_id: companyId, author_id: user.id, content_html: html, attachments })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await syncMentions("cs_note", data.id);
  return { error: null };
}

export async function updateCsNote(
  id: string,
  html: string,
  attachments: NoteAttachmentMeta[]
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cs_notes")
    .update({ content_html: html, attachments })
    .eq("id", id);
  if (error) return { error: error.message };
  await syncMentions("cs_note", id);
  return { error: null };
}

export async function insertCsNoteReply(
  noteId: string,
  parentId: string | null,
  html: string,
  attachments: NoteAttachmentMeta[]
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sua sessão expirou. Recarregue a página." };

  const { data, error } = await supabase
    .from("cs_note_replies")
    .insert({ note_id: noteId, parent_id: parentId, body_html: html, attachments, author_id: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await syncMentions("cs_note_reply", data.id);
  return { error: null };
}

export async function updateCsNoteReply(
  id: string,
  html: string,
  attachments: NoteAttachmentMeta[]
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cs_note_replies")
    .update({ body_html: html, attachments })
    .eq("id", id);
  if (error) return { error: error.message };
  await syncMentions("cs_note_reply", id);
  return { error: null };
}
