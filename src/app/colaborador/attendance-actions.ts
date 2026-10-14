"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";

// Cronômetro de ATENDIMENTO (calibração, 0126). Escrita só por RPC DEFINER:
// attendance_start encerra o atendimento anterior, pausa o cronômetro de TAREFA
// aberto (devolvendo qual) e abre o novo; attendance_stop encerra o aberto.

export async function startAttendance(companyId: string): Promise<{
  error: string | null;
  startedAt?: string;
  pausedTask?: { id: string; title: string } | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attendance_start", {
    p_company_id: companyId,
  });
  if (error) return { error: error.message };

  const d = (data ?? {}) as {
    started_at?: string;
    paused_task_id?: string | null;
    paused_task_title?: string | null;
  };
  revalidatePath("/colaborador");
  return {
    error: null,
    startedAt: d.started_at,
    pausedTask: d.paused_task_id
      ? { id: d.paused_task_id, title: d.paused_task_title ?? "tarefa" }
      : null,
  };
}

export async function stopAttendance(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("attendance_stop");
  if (error) return { error: error.message };
  revalidatePath("/colaborador");
  return { error: null };
}
