"use server";

import { createClient } from "@/lib/supabase-server";
import { sanitizeNoteHtml } from "@/lib/notes";
import {
  setTaskItemChecked,
  TASK_TOGGLE_MESSAGES,
  type TaskToggleReason,
  type TaskToggleResult,
} from "@/lib/task-checkbox";

// Marcar/desmarcar um item de checklist DIRETO na leitura de um conteúdo rich
// text. O cliente NUNCA envia HTML: manda só o id do conteúdo, o índice do
// item (ordem no documento), o novo estado e o token que a tela tinha (o
// carimbo de versão). Aqui no servidor lemos o HTML atual, conferimos o token,
// trocamos SÓ aquele item (setTaskItemChecked), passamos pelo getNoteSanitizer
// (ponto único) e gravamos via RPC — que seta a GUC `app.task_checkbox` na
// mesma transação para a gravação NÃO contar como edição (sem edited_at, sem
// trocar o autor/updated_at, sem @menção, sem evento, sem notificação).
//
// A permissão é a MESMA da RLS de cada tabela (quem já pode editar o conteúdo):
//  · Atualização / Chamado: admin OU autor.
//  · Respostas (de atualização e de chamado): apenas o autor.
// A RLS do UPDATE dentro da RPC é a barreira real; a checagem aqui só dá a
// mensagem certa e evita gravações que o gatilho de conteúdo congelaria.

type Config = {
  table: string;
  htmlCol: string;
  stampCol: "updated_at" | "edited_at";
  authorCol: "author_id" | "created_by";
  rpc: string;
  // true = admin também edita (atualização/chamado); false = só o autor.
  adminMayEdit: boolean;
};

function fail(reason: TaskToggleReason, message?: string): TaskToggleResult {
  return { ok: false, reason, message: message ?? TASK_TOGGLE_MESSAGES[reason] };
}

async function toggle(
  cfg: Config,
  id: string,
  knownToken: string,
  index: number,
  checked: boolean
): Promise<TaskToggleResult> {
  // Validação defensiva do payload (chamada direta não confiável).
  if (typeof id !== "string" || !id) return fail("error");
  if (typeof knownToken !== "string" || !knownToken) return fail("error");
  if (!Number.isInteger(index) || index < 0) return fail("error");
  if (typeof checked !== "boolean") return fail("error");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("error", "Sua sessão expirou. Recarregue a página.");

  // Lê a linha pela RLS de SELECT. Sem acesso de leitura → sem edição.
  const { data: row, error } = await supabase
    .from(cfg.table)
    .select(`${cfg.htmlCol}, ${cfg.stampCol}, created_at, ${cfg.authorCol}`)
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return fail("permission");

  // A lista de colunas é montada em runtime (cfg), então o parser de tipos do
  // supabase-js não a reconhece — tratamos como registro genérico.
  const r = row as unknown as Record<string, unknown>;

  // Quem pode EDITAR aquele conteúdo (espelha a RLS/trava de conteúdo).
  const isAuthor = r[cfg.authorCol] === user.id;
  let allowed = isAuthor;
  if (!allowed && cfg.adminMayEdit) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    allowed = (prof as { role?: string } | null)?.role === "admin";
  }
  if (!allowed) return fail("permission");

  // Token de conflito: o carimbo de versão que a tela tinha vs. o atual.
  // Comparado por epoch (ms) para não tropeçar em formatação de timestamp.
  const dbStamp = (r[cfg.stampCol] as string | null) ?? (r.created_at as string);
  if (new Date(knownToken).getTime() !== new Date(dbStamp).getTime()) {
    return fail("conflict");
  }

  // Troca SÓ o item pedido no HTML atual; índice fora do intervalo não grava.
  let nextHtml: string;
  try {
    nextHtml = setTaskItemChecked(r[cfg.htmlCol] as string, index, checked);
  } catch {
    return fail("error", "Item inválido — recarregue a página.");
  }

  const sanitized = await sanitizeNoteHtml(nextHtml);

  // Grava pela RPC (GUC na mesma transação + trava otimista pelo token). NULL =
  // ninguém casou: o texto mudou entre a leitura e a escrita, ou a RLS barrou.
  const { data: newToken, error: rpcError } = await supabase.rpc(cfg.rpc, {
    p_id: id,
    p_html: sanitized,
    p_token: dbStamp,
  });
  if (rpcError) return fail("error");
  if (!newToken) return fail("conflict");

  return { ok: true, token: String(newToken) };
}

// --- Uma action por tipo de conteúdo (mesma RLS de edição de cada tabela) --- //

export async function toggleNoteCheckbox(
  id: string,
  token: string,
  index: number,
  checked: boolean
): Promise<TaskToggleResult> {
  return toggle(
    {
      table: "company_notes",
      htmlCol: "content_html",
      stampCol: "updated_at",
      authorCol: "author_id",
      rpc: "toggle_note_checkbox",
      adminMayEdit: true,
    },
    id,
    token,
    index,
    checked
  );
}

export async function toggleTicketCheckbox(
  id: string,
  token: string,
  index: number,
  checked: boolean
): Promise<TaskToggleResult> {
  return toggle(
    {
      table: "support_tickets",
      htmlCol: "context_html",
      stampCol: "updated_at",
      authorCol: "created_by",
      rpc: "toggle_ticket_checkbox",
      adminMayEdit: true,
    },
    id,
    token,
    index,
    checked
  );
}

export async function toggleNoteReplyCheckbox(
  id: string,
  token: string,
  index: number,
  checked: boolean
): Promise<TaskToggleResult> {
  return toggle(
    {
      table: "company_note_replies",
      htmlCol: "body_html",
      stampCol: "edited_at",
      authorCol: "author_id",
      rpc: "toggle_note_reply_checkbox",
      adminMayEdit: false,
    },
    id,
    token,
    index,
    checked
  );
}

// --- Atualizações do CS (admin-only; a RLS de cs_notes/cs_note_replies é a
//     barreira; o toggle de nota do CS é de qualquer admin, o de resposta é do
//     autor, espelhando company). ------------------------------------------ //

export async function toggleCsNoteCheckbox(
  id: string,
  token: string,
  index: number,
  checked: boolean
): Promise<TaskToggleResult> {
  return toggle(
    {
      table: "cs_notes",
      htmlCol: "content_html",
      stampCol: "updated_at",
      authorCol: "author_id",
      rpc: "toggle_cs_note_checkbox",
      adminMayEdit: true,
    },
    id,
    token,
    index,
    checked
  );
}

export async function toggleCsNoteReplyCheckbox(
  id: string,
  token: string,
  index: number,
  checked: boolean
): Promise<TaskToggleResult> {
  return toggle(
    {
      table: "cs_note_replies",
      htmlCol: "body_html",
      stampCol: "edited_at",
      authorCol: "author_id",
      rpc: "toggle_cs_note_reply_checkbox",
      adminMayEdit: false,
    },
    id,
    token,
    index,
    checked
  );
}

export async function toggleTicketReplyCheckbox(
  id: string,
  token: string,
  index: number,
  checked: boolean
): Promise<TaskToggleResult> {
  return toggle(
    {
      table: "support_ticket_replies",
      htmlCol: "body_html",
      stampCol: "edited_at",
      authorCol: "author_id",
      rpc: "toggle_ticket_reply_checkbox",
      adminMayEdit: false,
    },
    id,
    token,
    index,
    checked
  );
}
