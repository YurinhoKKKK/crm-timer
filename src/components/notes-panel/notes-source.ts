// Adaptador da FONTE das "Atualizações" para o balão/painel/respostas
// compartilhados. Hoje há duas fontes: a padrão (company, comportamento atual,
// usada quando NÃO se passa `source`) e a do CS (tabelas cs_notes/cs_note_replies,
// admin-only). O MESMO componente atende as duas — o CS só injeta estas funções
// e flags.

import type { NoteAttachmentMeta, CompanyNoteView } from "@/lib/notes";
import type { ReplyView } from "@/components/replies/ReplyThread";
import type { MentionSourceType } from "@/lib/mentions";
import type { TaskToggleResult } from "@/lib/task-checkbox";
import type { EditorStorage } from "@/components/company-central/NoteEditor";
import {
  getCsNotes,
  createCsNote,
  updateCsNote,
  getCsNoteReplies,
  insertCsNoteReply,
  updateCsNoteReply,
} from "@/app/admin/sucesso-do-cliente/cs-notes-actions";
import {
  toggleCsNoteCheckbox,
  toggleCsNoteReplyCheckbox,
} from "@/components/rich-text/task-checkbox-actions";

export type NotesSource = {
  // Rótulos/termos usados no painel (ex.: "atualização do CS").
  termSingular: string;
  termPlural: string;
  // Sem áreas e sem "visível ao cliente" no CS.
  showAreas: boolean;
  showClientVisibility: boolean;
  // Contexto de @menção (restrita a admins no CS) + dica do seletor.
  mentionNoteType: MentionSourceType;
  mentionReplyType: MentionSourceType;
  mentionHint: string;
  // Destino dos anexos (bucket privado admin-only no CS).
  editorStorage: EditorStorage;
  // Dados.
  loadNotes: (
    companyId: string
  ) => Promise<{ error: string | null; notes?: CompanyNoteView[] }>;
  createNote: (
    companyId: string,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) => Promise<{ error: string | null }>;
  updateNote: (
    id: string,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) => Promise<{ error: string | null }>;
  toggleNoteCheckbox: (
    id: string,
    token: string,
    index: number,
    checked: boolean
  ) => Promise<TaskToggleResult>;
  loadReplies: (noteId: string) => Promise<ReplyView[]>;
  insertReply: (
    noteId: string,
    parentId: string | null,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) => Promise<{ error: string | null }>;
  updateReply: (
    id: string,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) => Promise<{ error: string | null }>;
  toggleReplyCheckbox: (
    id: string,
    token: string,
    index: number,
    checked: boolean
  ) => Promise<TaskToggleResult>;
};

// Fonte do CS (Sucesso do Cliente): tabelas próprias, bucket privado, menção só
// de admins.
export const csNotesSource: NotesSource = {
  termSingular: "atualização do CS",
  termPlural: "atualizações do CS",
  showAreas: false,
  showClientVisibility: false,
  mentionNoteType: "cs_note",
  mentionReplyType: "cs_note_reply",
  mentionHint: "Só aparecem administradores.",
  editorStorage: {
    imagesBucket: "cs-note-files",
    filesBucket: "cs-note-files",
    signed: true,
  },
  loadNotes: getCsNotes,
  createNote: createCsNote,
  updateNote: updateCsNote,
  toggleNoteCheckbox: toggleCsNoteCheckbox,
  loadReplies: getCsNoteReplies,
  insertReply: insertCsNoteReply,
  updateReply: updateCsNoteReply,
  toggleReplyCheckbox: toggleCsNoteReplyCheckbox,
};
