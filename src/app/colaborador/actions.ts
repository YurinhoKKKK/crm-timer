"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";

// Inicia (play) o timer da tarefa. Retorna o started_at do intervalo aberto,
// que o cliente usa para continuar o cronômetro.
export async function startTimer(
  taskId: string
): Promise<{ error: string | null; startedAt?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timer_start", { p_task: taskId });

  if (error) {
    return { error: error.message };
  }
  return { error: null, startedAt: data as string };
}

// Pausa o timer: fecha o intervalo aberto e devolve o total acumulado.
export async function pauseTimer(
  taskId: string
): Promise<{ error: string | null; totalSeconds?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timer_pause", { p_task: taskId });

  if (error) {
    return { error: error.message };
  }
  return { error: null, totalSeconds: (data as number) ?? 0 };
}

// Finaliza a tarefa com o resumo obrigatório. Se sendWhatsapp = true, dispara
// o resumo ao grupo da empresa via Edge Function send-whatsapp.
export async function finishTask(
  taskId: string,
  companyId: string,
  note: string,
  sendWhatsapp: boolean
): Promise<{ error: string | null; totalSeconds?: number; warning?: string }> {
  const trimmed = note.trim();
  if (!trimmed) {
    return { error: "Escreva um resumo do que foi feito." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timer_finish", {
    p_task: taskId,
    p_note: trimmed,
    p_send: sendWhatsapp,
  });

  if (error) {
    return { error: error.message };
  }

  // A tarefa já está finalizada no banco neste ponto. O envio ao WhatsApp é
  // best-effort: se falhar, a finalização permanece e devolvemos um aviso.
  let warning: string | undefined;
  if (sendWhatsapp) {
    const { data: sendData, error: sendErr } = await supabase.functions.invoke(
      "send-whatsapp",
      { body: { companyId, message: trimmed } }
    );
    const apiError = (sendData as { error?: string } | null)?.error;
    if (sendErr || apiError) {
      warning =
        "Tarefa finalizada, mas o envio ao WhatsApp falhou: " +
        (apiError ?? sendErr?.message ?? "erro desconhecido");
    }
  }

  revalidatePath(`/colaborador/${companyId}/${taskId}`);
  revalidatePath(`/colaborador/${companyId}`);
  revalidatePath("/colaborador");
  return { error: null, totalSeconds: (data as number) ?? 0, warning };
}
