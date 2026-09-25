"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import type {
  Role,
  TaskKind,
  TaskCategory,
  TemplateType,
  ListingMarketplace,
  TablesInsert,
} from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/task-category";
import {
  applyCompanyStandards,
  type CompanyStandardAssignment,
} from "@/lib/standard-link";

const VALID_CATEGORIES: TaskCategory[] = [
  "cadastro",
  "precificacao",
  "anuncio",
  "estudo",
  "listagem",
  "integracao",
  "criar_conta",
];

// Cargo do usuário atual — a regra de negócio "consultor só cria tarefa única"
// é aplicada NO SERVIDOR (não só escondendo o campo). A RLS já autoriza a
// escrita; isto decide o TIPO permitido.
async function currentRole(
  supabase: MaybeClient,
  userId: string
): Promise<Role | null> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return (data as { role: Role } | null)?.role ?? null;
}

// O colaborador escolhido é RESPONSÁVEL (vínculo declarado) pela empresa?
// Mudança de âncora (0090): tarefa só pode ser atribuída a quem é responsável
// pela empresa. Fronteira NO SERVIDOR — não basta filtrar a lista na tela. A
// RLS (ccol_select) deixa admin/consultor da empresa lerem o vínculo.
async function collaboratorInPortfolio(
  supabase: MaybeClient,
  companyId: string,
  collaboratorId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("company_collaborators")
    .select("collaborator_id")
    .eq("company_id", companyId)
    .eq("collaborator_id", collaboratorId)
    .maybeSingle();
  return !!data;
}

const NOT_RESPONSIBLE_MSG =
  "Este colaborador não é responsável por esta empresa. Vincule-o em Editar empresa antes de atribuir a tarefa.";

const VALID_ROLES: Role[] = ["pending", "colaborador", "consultor", "admin"];

// Altera o cargo de um usuário. A RLS (policy profiles_update_self → with check
// is_admin()) garante que somente um admin consegue mudar o cargo de terceiros;
// validamos o cargo aqui para evitar valores inválidos.
export async function updateUserRole(
  userId: string,
  role: Role
): Promise<{ error: string | null }> {
  if (!VALID_ROLES.includes(role)) {
    return { error: "Cargo inválido." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/usuarios");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Empresas (Passo 2.2)
// ---------------------------------------------------------------------------

type CompanyInput = {
  name: string;
  whatsappContactId: string;
  whatsappGroupName: string;
  consultantIds: string[];
};

function normalize(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const DUPLICATE_COMPANY_MSG = "Já existe uma empresa com esse nome.";

type MaybeClient = Awaited<ReturnType<typeof createClient>>;

// Checa se o nome já está em uso, com a MESMA regra do índice único do banco
// (companies_name_unique_ci): ignora maiúsculas/minúsculas e espaços nas
// bordas. Pré-checagem para dar mensagem clara; a constraint é a garantia real.
async function companyNameTaken(
  supabase: MaybeClient,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const target = name.trim().toLowerCase();
  if (!target) return false;
  // ilike sem curingas = igualdade case-insensitive; escapamos %/_/\ do nome.
  const pattern = name.trim().replace(/([\\%_])/g, "\\$1");
  const { data } = await supabase
    .from("companies")
    .select("id, name")
    .ilike("name", pattern);
  return ((data as { id: string; name: string }[]) ?? []).some(
    (c) => c.id !== excludeId && c.name.trim().toLowerCase() === target
  );
}

// Cria uma empresa e (opcionalmente) já vincula consultores. A RLS
// (companies_admin_all / cc_admin_all) garante que só o admin escreve aqui.
// `standardAssignments` (Direção 2) já atribui tarefas padrão à empresa nova,
// pelo mesmo núcleo do vínculo vivo (regra de aparição no dia incluída).
export async function createCompany(
  input: CompanyInput,
  standardAssignments: CompanyStandardAssignment[] = [],
  labelIds: string[] = []
): Promise<{ error: string | null; id?: string }> {
  const name = input.name.trim();
  if (!name) {
    return { error: "Informe o nome da empresa." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  if (await companyNameTaken(supabase, name)) {
    return { error: DUPLICATE_COMPANY_MSG };
  }

  const { data: company, error } = await supabase
    .from("companies")
    .insert({
      name,
      whatsapp_contact_id: normalize(input.whatsappContactId),
      whatsapp_group_name: normalize(input.whatsappGroupName),
      created_by: user.id, // transparência: quem cadastrou a empresa
    })
    .select("id")
    .single();

  if (error || !company) {
    // 23505 = violação de unicidade (corrida/duplo-submit escapou da pré-checagem).
    if (error?.code === "23505") return { error: DUPLICATE_COMPANY_MSG };
    return { error: error?.message ?? "Não foi possível criar a empresa." };
  }

  const consultantIds = Array.from(new Set(input.consultantIds));
  if (consultantIds.length > 0) {
    const { error: linkError } = await supabase
      .from("company_consultants")
      .insert(
        consultantIds.map((consultantId) => ({
          company_id: company.id,
          consultant_id: consultantId,
        }))
      );

    if (linkError) {
      return { error: linkError.message, id: company.id };
    }
  }

  const labels = Array.from(new Set(labelIds));
  if (labels.length > 0) {
    const { error: labelError } = await supabase
      .from("company_labels")
      .insert(labels.map((label_id) => ({ company_id: company.id, label_id })));
    if (labelError) {
      return {
        error: `Empresa criada, mas falhou ao aplicar etiquetas: ${labelError.message}`,
        id: company.id,
      };
    }
  }

  if (standardAssignments.length > 0) {
    const linkErr = await applyCompanyStandards(
      supabase,
      user.id,
      company.id,
      standardAssignments
    );
    if (linkErr) {
      return {
        error: `Empresa criada, mas falhou ao atribuir tarefas padrão: ${linkErr}`,
        id: company.id,
      };
    }
    revalidatePath("/admin");
    revalidatePath("/admin/tarefas");
    revalidatePath("/admin/instancias");
  }

  revalidatePath("/admin/empresas");
  return { error: null, id: company.id };
}

// Ajusta o conjunto de consultores de uma empresa para o informado gravando
// só a DIFERENÇA: remove apenas quem saiu e insere apenas quem entrou. Antes
// apagava tudo e reinseria tudo — o que, além de churn de RLS/FK, faria o
// gatilho de histórico (company_events) registrar remover+adicionar para TODOS
// a cada salvamento, mesmo sem mudança. Diferença = cada linha escrita é uma
// mudança real.
export async function setCompanyConsultants(
  companyId: string,
  consultantIds: string[]
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const desired = new Set(consultantIds);

  const { data: current, error: readError } = await supabase
    .from("company_consultants")
    .select("consultant_id")
    .eq("company_id", companyId);
  if (readError) {
    return { error: readError.message };
  }

  const currentIds = new Set(
    (current ?? []).map((r) => (r as { consultant_id: string }).consultant_id)
  );

  const toRemove = Array.from(currentIds).filter((id) => !desired.has(id));
  const toAdd = Array.from(desired).filter((id) => !currentIds.has(id));

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from("company_consultants")
      .delete()
      .eq("company_id", companyId)
      .in("consultant_id", toRemove);
    if (deleteError) {
      return { error: deleteError.message };
    }
  }

  if (toAdd.length > 0) {
    const { error: insertError } = await supabase
      .from("company_consultants")
      .insert(
        toAdd.map((consultantId) => ({
          company_id: companyId,
          consultant_id: consultantId,
        }))
      );
    if (insertError) {
      return { error: insertError.message };
    }
  }

  revalidatePath("/admin/empresas");
  return { error: null };
}

// Colaborador RESPONSÁVEL pela empresa (vínculo DECLARADO — mudança de âncora,
// migration 0090). Só ADMIN gerencia (a RLS ccol_admin_all é a fronteira real; a
// UI só esconde para os demais). Mesmo desenho de setCompanyConsultants: grava a
// DIFERENÇA (remove quem saiu, insere quem entrou).
//
// PROTEÇÃO ao remover: se o colaborador removido ainda tem tarefas EM ABERTO na
// empresa, elas ficarão SEM VÍNCULO (não somem, continuam com ele — nada é
// apagado). O admin é AVISADO e precisa confirmar. Sem `confirmRemovals`, a ação
// NÃO aplica nada e devolve `needsConfirm` com a contagem por pessoa; a UI mostra
// o aviso e chama de novo com confirmRemovals=true.
export type CollaboratorRemovalWarning = {
  collaboratorId: string;
  name: string;
  openTasks: number;
};

export async function setCompanyCollaborators(
  companyId: string,
  collaboratorIds: string[],
  confirmRemovals = false
): Promise<{
  error: string | null;
  needsConfirm?: CollaboratorRemovalWarning[];
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const desired = new Set(collaboratorIds);

  const { data: current, error: readError } = await supabase
    .from("company_collaborators")
    .select("collaborator_id")
    .eq("company_id", companyId);
  if (readError) {
    return { error: readError.message };
  }

  const currentIds = new Set(
    (current ?? []).map((r) => (r as { collaborator_id: string }).collaborator_id)
  );

  const toRemove = Array.from(currentIds).filter((id) => !desired.has(id));
  const toAdd = Array.from(desired).filter((id) => !currentIds.has(id));

  // Nada mudou.
  if (toRemove.length === 0 && toAdd.length === 0) {
    return { error: null };
  }

  // Antes de remover, conta as tarefas em aberto de cada pessoa que sai. Se
  // houver alguma e o admin ainda não confirmou, devolve o aviso sem aplicar.
  if (toRemove.length > 0 && !confirmRemovals) {
    const warnings: CollaboratorRemovalWarning[] = [];
    for (const collaboratorId of toRemove) {
      const { data: countData } = await supabase.rpc(
        "collaborator_open_task_count",
        { p_company: companyId, p_collaborator: collaboratorId }
      );
      const openTasks = Number(countData ?? 0);
      if (openTasks > 0) {
        warnings.push({ collaboratorId, name: "", openTasks });
      }
    }
    if (warnings.length > 0) {
      // Resolve os nomes para a mensagem de confirmação.
      const { data: names } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in(
          "id",
          warnings.map((w) => w.collaboratorId)
        );
      const nameById = new Map(
        ((names as { id: string; full_name: string; email: string }[]) ?? []).map(
          (p) => [p.id, p.full_name || p.email]
        )
      );
      return {
        error: null,
        needsConfirm: warnings.map((w) => ({
          ...w,
          name: nameById.get(w.collaboratorId) ?? "(colaborador)",
        })),
      };
    }
  }

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from("company_collaborators")
      .delete()
      .eq("company_id", companyId)
      .in("collaborator_id", toRemove);
    if (deleteError) {
      return { error: deleteError.message };
    }
  }

  if (toAdd.length > 0) {
    const { error: insertError } = await supabase
      .from("company_collaborators")
      .insert(
        toAdd.map((collaboratorId) => ({
          company_id: companyId,
          collaborator_id: collaboratorId,
        }))
      );
    if (insertError) {
      return { error: insertError.message };
    }
  }

  revalidatePath("/admin/empresas");
  revalidatePath(`/admin/empresas/${companyId}/editar`);
  return { error: null };
}

// Atualiza os dados básicos de uma empresa (consultores são geridos por
// setCompanyConsultants).
export async function updateCompany(
  companyId: string,
  input: { name: string; whatsappContactId: string; whatsappGroupName: string }
): Promise<{ error: string | null }> {
  const name = input.name.trim();
  if (!name) {
    return { error: "Informe o nome da empresa." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  // Não deixa renomear para o nome de OUTRA empresa (exclui a própria).
  if (await companyNameTaken(supabase, name, companyId)) {
    return { error: DUPLICATE_COMPANY_MSG };
  }

  const { error } = await supabase
    .from("companies")
    .update({
      name,
      whatsapp_contact_id: normalize(input.whatsappContactId),
      whatsapp_group_name: normalize(input.whatsappGroupName),
    })
    .eq("id", companyId);

  if (error) {
    if (error.code === "23505") return { error: DUPLICATE_COMPANY_MSG };
    return { error: error.message };
  }

  revalidatePath("/admin/empresas");
  revalidatePath(`/admin/empresas/${companyId}`);
  return { error: null };
}

// Exclui uma empresa. ATENÇÃO: o cascade do banco remove também os vínculos
// de consultores, os templates e as instâncias de tarefa dessa empresa.
export async function deleteCompany(
  companyId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase.from("companies").delete().eq("id", companyId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/empresas");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Tarefas (Passo 2.3)
// ---------------------------------------------------------------------------

type TaskTemplateInput = {
  // O TÍTULO deixou de ser texto livre: nas tarefas novas ele é DERIVADO da
  // categoria (padronização do cadastro). Mantido no input por compat, mas
  // ignorado — o servidor define o título a partir da categoria.
  title?: string;
  // Categoria (obrigatória em toda tarefa NOVA). 'listagem' aciona o layout
  // próprio (template_type='listagem'); as demais usam 'padrao'.
  category?: string;
  description: string;
  instructions: string;
  companyId: string;
  collaboratorId: string;
  kind: TaskKind;
  startDate: string; // YYYY-MM-DD (usado em "unica")
  dueTime: string; // HH:MM (opcional)
  weekdays: number[]; // 0-6 (usado em "diaria")
  endDate: string; // YYYY-MM-DD (opcional, "diaria")
  active?: boolean; // só aplicado na edição
  // Listagem de marcas (passo 22): campos próprios. templateType é DERIVADO da
  // categoria; mantido opcional por compat.
  templateType?: TemplateType;
  brands?: string[];
  marketplaces?: ListingMarketplace[];
  needsMargin?: boolean;
  taxRate?: number | null;
};

type TemplateFields = {
  title: string;
  category: TaskCategory | null;
  description: string | null;
  instructions: string | null;
  company_id: string;
  collaborator_id: string;
  kind: TaskKind;
  due_time: string | null;
  weekdays: number[] | null;
  end_date: string | null;
  start_date?: string;
  template_type: TemplateType;
  listing_needs_margin: boolean;
  listing_tax_rate: number | null;
  listing_marketplaces: ListingMarketplace[];
};

// Contexto que a validação precisa além do input: o cargo (define o tipo
// permitido) e, na EDIÇÃO, os campos preservados do molde existente (categoria,
// título, template_type e kind NÃO são recategorizados/trocados na edição).
type ValidateCtx = {
  isAdmin: boolean;
  existing?: {
    category: TaskCategory | null;
    title: string;
    template_type: TemplateType;
    kind: TaskKind;
  };
};

const VALID_MARKETPLACES: ListingMarketplace[] = [
  "mercado_livre",
  "shopee",
  "amazon",
];

// Valida e normaliza a entrada do formulário de tarefa, compartilhada por criar
// e editar. Decisões travadas desta reforma:
//   - TÍTULO é derivado da CATEGORIA (não é mais texto livre).
//   - CATEGORIA é obrigatória em toda tarefa NOVA; na EDIÇÃO ela NÃO é
//     recategorizada (preserva a existente — inclusive nula, das tarefas antigas).
//   - TIPO (única/diária): só o admin escolhe. Consultor cria sempre 'unica' e,
//     ao editar, o tipo permanece o que já era.
//   - Categoria 'listagem' ⇒ template_type='listagem' (layout próprio) e a
//     tarefa é sempre pontual (kind='unica').
function validateTemplateInput(
  input: TaskTemplateInput,
  ctx: ValidateCtx
): { error: string } | { fields: TemplateFields; brands: string[] } {
  if (!input.companyId) return { error: "Selecione a empresa." };
  if (!input.collaboratorId) return { error: "Selecione o colaborador." };

  const isUpdate = !!ctx.existing;

  // Categoria efetiva: na edição preserva a do molde; na criação vem do input
  // e é obrigatória.
  let category: TaskCategory | null;
  if (isUpdate) {
    category = ctx.existing!.category;
  } else {
    const raw = (input.category ?? "").trim();
    if (!raw) return { error: "Selecione a categoria da tarefa." };
    if (!VALID_CATEGORIES.includes(raw as TaskCategory)) {
      return { error: "Categoria de tarefa inválida." };
    }
    category = raw as TaskCategory;
  }

  // template_type deriva da categoria na criação; na edição é preservado.
  const templateType: TemplateType = isUpdate
    ? ctx.existing!.template_type
    : category === "listagem"
      ? "listagem"
      : "padrao";
  const isListing = templateType === "listagem";

  // Título derivado (novas) ou preservado (edição). Para listagem, rótulo fixo.
  const title = isUpdate
    ? ctx.existing!.title
    : isListing
      ? "Listagem"
      : CATEGORY_LABEL[category as string] ?? (category as string);

  // ---- Listagem de marcas (sempre pontual) -------------------------------
  if (isListing) {
    if (!input.startDate) {
      return { error: "Informe a data da listagem." };
    }
    const brands = (input.brands ?? [])
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    if (brands.length === 0) {
      return { error: "Adicione ao menos uma marca." };
    }
    const marketplaces = Array.from(new Set(input.marketplaces ?? [])).filter(
      (m) => VALID_MARKETPLACES.includes(m)
    );
    if (marketplaces.length === 0) {
      return { error: "Selecione ao menos um marketplace." };
    }
    const needsMargin = input.needsMargin === true;
    let taxRate: number | null = null;
    if (needsMargin) {
      taxRate = input.taxRate ?? null;
      if (taxRate === null || Number.isNaN(taxRate)) {
        return { error: "Informe a alíquota de imposto do cliente." };
      }
      if (taxRate < 0 || taxRate > 100) {
        return { error: "A alíquota deve estar entre 0 e 100%." };
      }
    }

    const fields: TemplateFields = {
      title,
      category,
      description: normalize(input.description),
      instructions: normalize(input.instructions),
      company_id: input.companyId,
      collaborator_id: input.collaboratorId,
      kind: "unica", // pontual: reaproveita o trigger da instância imediata
      due_time: normalize(input.dueTime),
      weekdays: null,
      end_date: null,
      start_date: input.startDate,
      template_type: "listagem",
      listing_needs_margin: needsMargin,
      listing_tax_rate: taxRate,
      listing_marketplaces: marketplaces,
    };
    return { fields, brands };
  }

  // ---- Tarefa comum (única/diária) ---------------------------------------
  // TIPO: só o admin escolhe. Consultor cria 'unica'; ao editar, preserva o que
  // já era. Aplicado NO SERVIDOR — não há caminho para consultor gerar diária.
  let kind: TaskKind;
  if (ctx.isAdmin) {
    if (input.kind !== "unica" && input.kind !== "diaria") {
      return { error: "Tipo de tarefa inválido." };
    }
    kind = input.kind;
  } else {
    kind = isUpdate ? ctx.existing!.kind : "unica";
  }

  const weekdays = Array.from(new Set(input.weekdays)).sort((a, b) => a - b);

  if (kind === "unica" && !input.startDate) {
    return { error: "Informe a data da tarefa única." };
  }
  if (kind === "diaria" && weekdays.length === 0) {
    return { error: "Selecione ao menos um dia da semana." };
  }
  if (weekdays.some((d) => d < 0 || d > 6)) {
    return { error: "Dia da semana inválido." };
  }

  const fields: TemplateFields = {
    title,
    category,
    description: normalize(input.description),
    instructions: normalize(input.instructions),
    company_id: input.companyId,
    collaborator_id: input.collaboratorId,
    kind,
    due_time: normalize(input.dueTime),
    weekdays: kind === "unica" ? null : weekdays,
    end_date: kind === "unica" ? null : normalize(input.endDate),
    template_type: "padrao",
    listing_needs_margin: false,
    listing_tax_rate: null,
    listing_marketplaces: [],
  };
  if (kind === "unica" || input.startDate) {
    fields.start_date = input.startDate;
  }

  return { fields, brands: [] };
}

// Cria um task_template. Os triggers do banco cuidam das instâncias:
// "unica" gera a task_instance na hora (trg_unique_template); "diaria" é
// materializada por generate_daily_tasks conforme os weekdays.
export async function createTaskTemplate(
  input: TaskTemplateInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  // O cargo decide o TIPO permitido (consultor só cria 'unica'). Fronteira no
  // servidor — o formulário só esconde o campo.
  const isAdmin = (await currentRole(supabase, user.id)) === "admin";
  const result = validateTemplateInput(input, { isAdmin });
  if ("error" in result) {
    return { error: result.error };
  }

  // Âncora (0090): só se atribui tarefa a quem é responsável pela empresa —
  // EXCETO o admin, que pode designar qualquer colaborador mesmo fora da
  // carteira. Nesse caso a empresa aparece temporária no painel da pessoa
  // (collaborator_portfolio: união com tarefas em aberto) e some quando a tarefa
  // é finalizada; enquanto isso conta na Capacidade como "fora da carteira".
  if (
    !isAdmin &&
    !(await collaboratorInPortfolio(supabase, input.companyId, input.collaboratorId))
  ) {
    return { error: NOT_RESPONSIBLE_MSG };
  }

  const row: TablesInsert<"task_templates"> = {
    ...result.fields,
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from("task_templates")
    .insert(row)
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Não foi possível criar a tarefa." };
  }

  // Marcas da listagem (tabela filha). A ordem é preservada por `position`.
  if (result.brands.length > 0) {
    const { error: brandError } = await supabase.from("listing_brands").insert(
      result.brands.map((name, position) => ({
        template_id: data.id,
        name,
        position,
      }))
    );
    if (brandError) {
      return {
        error: `Tarefa criada, mas falhou ao salvar as marcas: ${brandError.message}`,
        id: data.id,
      };
    }
  }

  revalidatePath("/admin/tarefas");
  return { error: null, id: data.id };
}

// Atualiza um task_template existente. Obs.: a edição NÃO altera instâncias já
// geradas — vale para as próximas gerações da tarefa.
// Resultado da geração da ocorrência de HOJE ao editar uma diária (fonte:
// generate_template_today_edit no banco). 'nao_aplica' = não é diária. A UI usa
// isto para explicar ao usuário o que aconteceu (em vez de silêncio).
export type TodayGenStatus =
  | "gerada"
  | "ja_existia"
  | "nao_e_dia"
  | "inativa"
  | "fora_do_periodo"
  | "nao_aplica";

export async function updateTaskTemplate(
  templateId: string,
  input: TaskTemplateInput
): Promise<{ error: string | null; todayStatus?: TodayGenStatus | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  // Na edição NÃO recategorizamos nem trocamos o título/template_type; e o TIPO
  // só o admin muda (consultor preserva o existente). Lemos o molde atual para
  // preservar esses campos. A RLS (tt_update) é a fronteira de autorização.
  const { data: existingData, error: readError } = await supabase
    .from("task_templates")
    .select("category, title, template_type, kind, collaborator_id")
    .eq("id", templateId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!existingData) return { error: "Tarefa não encontrada." };
  const existing = existingData as {
    category: TaskCategory | null;
    title: string;
    template_type: TemplateType;
    kind: TaskKind;
    collaborator_id: string;
  };

  const isAdmin = (await currentRole(supabase, user.id)) === "admin";
  const result = validateTemplateInput(input, { isAdmin, existing });
  if ("error" in result) {
    return { error: result.error };
  }

  // Âncora (0090): ao TROCAR o responsável, o novo tem de ser responsável pela
  // empresa. Só valida quando muda — preserva a edição de tarefas legadas cujo
  // responsável não foi para o backfill (só tarefas padrão ativas entraram). O
  // admin fica isento (pode reatribuir a qualquer colaborador, mesmo fora da
  // carteira — mesma regra da criação).
  if (
    !isAdmin &&
    input.collaboratorId !== existing.collaborator_id &&
    !(await collaboratorInPortfolio(supabase, input.companyId, input.collaboratorId))
  ) {
    return { error: NOT_RESPONSIBLE_MSG };
  }

  const { error } = await supabase
    .from("task_templates")
    .update({ ...result.fields, active: input.active ?? true })
    .eq("id", templateId);

  if (error) {
    return { error: error.message };
  }

  // Marcas da listagem: substitui o conjunto (apaga as atuais e insere as novas).
  // Para tarefas comuns, `brands` é vazio — a limpeza mantém o estado consistente
  // caso o tipo tenha mudado.
  const { error: delError } = await supabase
    .from("listing_brands")
    .delete()
    .eq("template_id", templateId);
  if (delError) {
    return { error: `Tarefa salva, mas falhou ao atualizar marcas: ${delError.message}` };
  }
  if (result.brands.length > 0) {
    const { error: insError } = await supabase.from("listing_brands").insert(
      result.brands.map((name, position) => ({
        template_id: templateId,
        name,
        position,
      }))
    );
    if (insError) {
      return { error: `Tarefa salva, mas falhou ao salvar marcas: ${insError.message}` };
    }
  }

  // Propaga a edição para as instâncias ainda não iniciadas (a_fazer).
  const { error: syncError } = await supabase.rpc("sync_template_instances", {
    p_template: templateId,
  });
  if (syncError) {
    return { error: `Tarefa salva, mas falhou ao propagar: ${syncError.message}` };
  }

  // Diária: gera a ocorrência de HOJE se hoje passou a fazer parte da recorrência
  // e ainda não existe (ex.: usuário incluiu a quinta depois que o cron já rodou).
  // Caminho de edição ignora o due_time de propósito (a pessoa corrige agora; a
  // tarefa pode nascer atrasada) — o cron e o trigger de INSERT seguem intactos.
  // Autorização já veio da RLS do UPDATE acima; não duplica (on conflict no banco).
  let todayStatus: TodayGenStatus | null = null;
  if (result.fields.kind === "diaria") {
    const { data, error: genError } = await supabase.rpc(
      "generate_template_today_edit",
      { p_template: templateId }
    );
    if (genError) {
      return {
        error: `Tarefa salva, mas falhou ao gerar a ocorrência de hoje: ${genError.message}`,
      };
    }
    todayStatus = (data as TodayGenStatus) ?? null;
  }

  revalidatePath("/admin/tarefas");
  revalidatePath(`/admin/tarefas/${templateId}`);
  return { error: null, todayStatus };
}

// Exclui um task_template e, em cascata (migration 0008), todas as suas
// task_instances, time_entries e activity_log relacionados — some de todos
// os painéis e dos números do dashboard/resumo. A RLS (tt_delete) garante
// que admin exclui qualquer um e consultor só os que ele criou.
export async function deleteTaskTemplate(
  templateId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase
    .from("task_templates")
    .delete()
    .eq("id", templateId);

  if (error) {
    return { error: error.message };
  }

  // Reflete nas listagens e nos números agregados (dashboard, instâncias).
  revalidatePath("/admin");
  revalidatePath("/admin/tarefas");
  revalidatePath("/admin/instancias");
  return { error: null };
}

// Ativa/desativa VÁRIOS task_templates de uma vez (reestruturação de tarefas).
// NÃO é exclusão: nenhuma instância, apontamento de tempo ou relato é tocado — só
// liga/desliga a GERAÇÃO futura (o cron generate_daily_tasks e os gatilhos de
// "ocorrência de hoje" filtram active=true; as instâncias já criadas, inclusive a
// de hoje, seguem intactas e concluíveis). A desativação/reativação de RECORRENTES
// registra evento no histórico via gatilho (migration 0072, deriva auth.uid()). A
// RLS tt_update autoriza (admin todos; consultor os que criou). Devolve quantos
// modelos foram de fato afetados (respeitando a RLS) para a confirmação/feedback.
export async function setTaskTemplatesActive(
  templateIds: string[],
  active: boolean
): Promise<{ error: string | null; count: number }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente.", count: 0 };
  }

  const ids = Array.from(new Set(templateIds.filter(Boolean)));
  if (ids.length === 0) return { error: null, count: 0 };

  const { data, error } = await supabase
    .from("task_templates")
    // Origem 'individual': esta é uma decisão manual, não a propagação do
    // catálogo (0078) — assim uma reativação "só do catálogo" não a atropela.
    .update({ active, active_source: "individual" })
    .in("id", ids)
    .select("id");

  if (error) {
    return { error: error.message, count: 0 };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/tarefas");
  revalidatePath("/admin/instancias");
  return { error: null, count: (data as { id: string }[] | null)?.length ?? 0 };
}
