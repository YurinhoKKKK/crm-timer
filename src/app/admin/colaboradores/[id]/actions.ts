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
