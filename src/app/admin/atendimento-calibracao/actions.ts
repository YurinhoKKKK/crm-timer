"use server";

import { revalidatePath } from "next/cache";
import { guardRole } from "@/components/guardRole";

// Ações admin da Etapa 2 (estimativa de atendimento Digisac). Todas as RPCs
// (migration 0129) recusam não-admin por dentro; guardRole é a 1ª barreira. Salvar
// parâmetros e "Recalcular tudo" disparam o recálculo completo (desde 01/09/2026)
// — a RPC roda com statement_timeout próprio, então pode levar alguns segundos.

type PgError = { code?: string; message?: string };

function classify(err: PgError | null): { error: string | null } {
  if (!err) return { error: null };
  const code = err.code ?? "";
  const msg = err.message ?? "";
  if (code === "42501" || /insufficient_privilege|row-level security|administrador/i.test(msg)) {
    return { error: "Você não tem permissão para esta ação." };
  }
  if (code === "23514" || code === "P0001") {
    return { error: msg || "Não foi possível concluir a ação." };
  }
  return { error: msg || "Não foi possível concluir a ação." };
}

// Salva os parâmetros e recalcula tudo (dispara dentro da RPC).
export async function saveParams(p: {
  gap: number; floor: number; prep: number; long: number; bmin: number; bwin: number;
}) {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("attendance_params_save", {
    p_gap: p.gap, p_floor: p.floor, p_prep: p.prep,
    p_long: p.long, p_bmin: p.bmin, p_bwin: p.bwin,
  });
  const res = classify(error);
  if (!res.error) {
    revalidatePath("/admin/atendimento-calibracao");
    revalidatePath("/admin/atendimento-calibracao/parametros");
  }
  return res;
}

// Marca/desmarca a calibração como concluída (controla a faixa de aviso na
// Capacidade). NÃO recalcula — só muda a chave.
export async function setCalibrated(value: boolean) {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("attendance_set_calibrated", { p_value: value });
  const res = classify(error);
  if (!res.error) {
    revalidatePath("/admin/atendimento-calibracao/parametros");
    revalidatePath("/admin/capacidade");
  }
  return res;
}

// Recálculo completo manual (sem mudar parâmetros).
export async function recomputeAll() {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("attendance_recompute_all");
  const res = classify(error);
  if (!res.error) revalidatePath("/admin/atendimento-calibracao");
  return res;
}

// Linha do tempo (sessões estimadas + cronômetros) de uma empresa para uma pessoa
// no período — para o painel de detalhe do bloco "por empresa". Só leitura.
export async function loadCompanyTimeline(
  start: string,
  end: string,
  profileId: string,
  companyId: string
) {
  const { supabase } = await guardRole(["admin"]);
  const { data } = await supabase.rpc("attendance_company_timeline", {
    p_start: start,
    p_end: end,
    p_profile_id: profileId,
    p_company_id: companyId,
  });
  return (data ?? []) as {
    kind: "estimada" | "cronometro";
    started_at: string;
    ended_at: string | null;
    minutes: number;
    team_msgs: number | null;
    client_msgs: number | null;
    in_task: boolean | null;
    auto_closed: boolean | null;
  }[];
}

// Liga/desliga um usuário do Digisac a um perfil. auto=true volta ao automático
// (casamento por e-mail); senão trava no perfil escolhido (null = "nenhum").
export async function setUserLink(userId: string, profileId: string | null, auto: boolean) {
  const { supabase } = await guardRole(["admin"]);
  const { error } = await supabase.rpc("digisac_set_user_link", {
    p_user_id: userId,
    p_profile_id: profileId,
    p_auto: auto,
  });
  const res = classify(error);
  if (!res.error) revalidatePath("/admin/atendimento-calibracao/pessoas");
  return res;
}
