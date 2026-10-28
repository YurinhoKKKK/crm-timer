"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";

// Passo 16 — Correção de tempo pelo admin (com auditoria).
// Chama admin_adjust_time, que valida is_admin() no banco, reconcilia os
// time_entries, grava o novo total_seconds e registra em time_adjustments.
export async function adjustTaskTime(
  taskId: string,
  collaboratorId: string,
  newSeconds: number,
  reason: string
): Promise<{ error: string | null }> {
  if (!Number.isFinite(newSeconds) || newSeconds < 0) {
    return { error: "Informe um tempo válido." };
  }
  // Teto de sanidade: 1000 horas.
  if (newSeconds > 1000 * 3600) {
    return { error: "Tempo acima do limite permitido." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.rpc("admin_adjust_time", {
    p_task: taskId,
    p_new_seconds: Math.round(newSeconds),
    p_reason: reason.trim() || undefined,
  });

  if (error) return { error: error.message };

  // Reflete nos números do dashboard, no detalhe do responsável e nas listas.
  revalidatePath("/admin");
  revalidatePath(`/admin/colaboradores/${collaboratorId}`);
  revalidatePath("/admin/instancias");
  return { error: null };
}

// --- Ausências do colaborador (migration 0162) ------------------------------
// Dias úteis de ausência saem dos pontos E das chances do Aproveitamento (o
// cálculo exclui na leitura, então vale retroativamente). A RLS ca_admin_all já
// barra não-admin; aqui só validamos a entrada e revalidamos as telas afetadas.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function addAbsence(
  collaboratorId: string,
  startDate: string,
  endDate: string
): Promise<{ error: string | null }> {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return { error: "Informe datas válidas (início e fim)." };
  }
  if (endDate < startDate) {
    return { error: "A data de fim não pode ser antes do início." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("collaborator_absences").insert({
    collaborator_id: collaboratorId,
    start_date: startDate,
    end_date: endDate,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/colaboradores/${collaboratorId}`);
  revalidatePath("/acompanhamento");
  return { error: null };
}

export async function removeAbsence(
  collaboratorId: string,
  absenceId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("collaborator_absences")
    .delete()
    .eq("id", absenceId)
    .eq("collaborator_id", collaboratorId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/colaboradores/${collaboratorId}`);
  revalidatePath("/acompanhamento");
  return { error: null };
}
