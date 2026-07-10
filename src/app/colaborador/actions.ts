"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import type { ListingMarketplace } from "@/lib/types";
import {
  buildListingWhatsappMessage,
  type ListingResultView,
} from "@/lib/listing";

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

// Resultado por combinação marca × marketplace na finalização da listagem:
// exatamente UM entre link e justificativa.
export type ListingResultInput = {
  brandId: string;
  brandName: string;
  marketplace: ListingMarketplace;
  link?: string;
  reason?: string;
};

// Finaliza uma tarefa de LISTAGEM (passo 22.1). O entregável são os links das
// planilhas por combinação; o resumo em texto é opcional (e, se preenchido,
// segue a escolha de enviar ao WhatsApp / só registrar). Grava tudo via RPC
// atômica timer_finish_listing.
export async function finishListingTask(
  taskId: string,
  companyId: string,
  results: ListingResultInput[],
  note: string,
  sendWhatsapp: boolean
): Promise<{ error: string | null; totalSeconds?: number; warning?: string }> {
  // Cada combinação precisa de OU link OU justificativa (exatamente um).
  const payload: {
    brand_id: string;
    marketplace: ListingMarketplace;
    link: string | null;
    reason: string | null;
  }[] = [];
  for (const r of results) {
    const link = (r.link ?? "").trim();
    const reason = (r.reason ?? "").trim();
    if (link && reason) {
      return { error: "Cada item deve ter o link OU a justificativa, não os dois." };
    }
    if (!link && !reason) {
      return {
        error:
          "Preencha o link de cada marca/marketplace ou marque como não feita com justificativa.",
      };
    }
    payload.push({
      brand_id: r.brandId,
      marketplace: r.marketplace,
      link: link || null,
      reason: reason || null,
    });
  }

  const trimmedNote = note.trim();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timer_finish_listing", {
    p_task: taskId,
    p_note: trimmedNote,
    p_send: sendWhatsapp,
    p_results: payload,
  });

  if (error) {
    return { error: error.message };
  }

  // Envio ao WhatsApp best-effort. Para a listagem, a mensagem inclui os LINKS
  // (o entregável real) agrupados por marca, além do resumo opcional no topo.
  let warning: string | undefined;
  if (sendWhatsapp) {
    const resultViews: ListingResultView[] = results.map((r) => ({
      brandName: r.brandName,
      marketplace: r.marketplace,
      link: (r.link ?? "").trim() || null,
      reason: (r.reason ?? "").trim() || null,
    }));
    const message = buildListingWhatsappMessage(trimmedNote, resultViews);

    const { data: sendData, error: sendErr } = await supabase.functions.invoke(
      "send-whatsapp",
      { body: { companyId, message } }
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
