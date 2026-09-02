"use server";

import { createClient } from "@/lib/supabase-server";
import {
  loadCompanyDetails,
  type CompanyDetails,
  type Cadence,
  type ProjectModel,
} from "@/lib/company-details";
import { SALES_CHANNELS, type SalesChannel } from "@/lib/revenue";

// Informações do cliente — lado INTERNO. A gravação passa pela RPC
// company_details_save (SECURITY INVOKER): a RLS é a fronteira real — só admin
// escreve; consultor/colaborador recebem 42501 e a action traduz para um aviso.
// As páginas que expõem estas ações já são guardadas por guardRole.

const CHANNEL_VALUES = new Set<string>(SALES_CHANNELS.map((c) => c.value));
const PROJECT_MODELS = new Set<string>(["bpo", "consultoria"]);
const CADENCES = new Set<string>([
  "semanal",
  "quinzenal",
  "semanal_quinzenal",
  "quinzenal_semanal",
]);
const TEXT_CAP = 5000;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[12]\d|3[01]|0[1-9])$/;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Ressincroniza a tela após salvar (mesma leitura do render inicial). Só o admin
// chega a chamar isto (a página só mostra o botão de editar para ele), então
// canSeeRevenue = true.
export async function fetchCompanyDetails(
  companyId: string
): Promise<CompanyDetails | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;
  return loadCompanyDetails(supabase, companyId, true);
}

export type SaveDetailsInput = {
  projectModel: string; // "" | ProjectModel
  startedOn: string; // "" | "YYYY-MM-DD"
  endsOn: string;
  cadence: string; // "" | Cadence
  systemUsed: string;
  mainPain: string;
  about: string;
  channels: string[]; // canais contratados
};

export async function saveCompanyDetails(
  companyId: string,
  input: SaveDetailsInput
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  // Validação de forma (a autorização é da RLS).
  const model = input.projectModel.trim();
  if (model && !PROJECT_MODELS.has(model)) {
    return { error: "Modelo de projeto inválido." };
  }
  const cadence = input.cadence.trim();
  if (cadence && !CADENCES.has(cadence)) {
    return { error: "Cadência inválida." };
  }

  const started = input.startedOn.trim();
  const ends = input.endsOn.trim();
  if (started && !DATE_RE.test(started)) {
    return { error: "Data de início inválida." };
  }
  if (ends && !DATE_RE.test(ends)) {
    return { error: "Data de término inválida." };
  }
  if (started && ends && ends < started) {
    return { error: "A data de término não pode ser antes da de início." };
  }

  if (
    input.systemUsed.length > TEXT_CAP ||
    input.mainPain.length > TEXT_CAP ||
    input.about.length > TEXT_CAP
  ) {
    return { error: `Cada texto pode ter no máximo ${TEXT_CAP} caracteres.` };
  }

  const channels = input.channels.filter((c) => CHANNEL_VALUES.has(c));

  const { error } = await supabase.rpc("company_details_save", {
    p_company: companyId,
    p_project_model: model === "" ? null : (model as ProjectModel),
    p_started_on: started === "" ? null : started,
    p_ends_on: ends === "" ? null : ends,
    p_cadence: cadence === "" ? null : (cadence as Cadence),
    p_system_used: input.systemUsed,
    p_main_pain: input.mainPain,
    p_about: input.about,
    p_channels: channels as SalesChannel[],
  });
  // A RLS recusa (42501) se o usuário não for admin; o check de datas também
  // pode barrar no banco (rede de segurança além da validação acima).
  if (error) return { error: "Não foi possível salvar as informações." };
  return { error: null };
}
