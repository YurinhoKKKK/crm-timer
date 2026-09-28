import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Company } from "@/lib/types";
import CompanyConsultants from "../../CompanyConsultants";
import CompanyCollaborators from "../../CompanyCollaborators";
import CompanyLabels from "../../CompanyLabels";
import CompanyStandardTasks from "@/components/CompanyStandardTasks";
import CompanyEditor from "../CompanyEditor";
import DeleteCompanyButton from "../DeleteCompanyButton";
import { withSelf } from "@/lib/people";
import { loadLabelCatalog, loadCompanyLabels } from "@/lib/labels";
import type { TaskKind } from "@/lib/types";

type ConsultantOption = { id: string; full_name: string; email: string };
type StandardOption = { id: string; title: string; kind: TaskKind };
type AssignedRow = { standard_task_id: string | null; collaborator_id: string };
type CompanyLink = {
  consultant: ConsultantOption | ConsultantOption[] | null;
};
type CompanyCollaboratorLink = {
  collaborator: ConsultantOption | ConsultantOption[] | null;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// Edição da empresa (Passo 19) — dados, consultores responsáveis e exclusão.
// Separada da central (../) para manter a central focada na operação. Só admin.
export default async function EmpresaEditarPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const { supabase, profile } = await guardRole(["admin"]);

  const [
    { data: companyData },
    { data: linksData },
    { data: collaboratorLinksData },
    { data: consultoresData },
    { data: colaboradoresData },
    labelCatalog,
    companyLabels,
    { data: standardData },
    { data: assignedData },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select(
        "id, name, whatsapp_contact_id, whatsapp_group_name, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("company_consultants")
      .select(
        "consultant:profiles!company_consultants_consultant_id_fkey(id, full_name, email)"
      )
      .eq("company_id", id),
    // Vínculos de colaborador responsável (âncora — migration 0090).
    supabase
      .from("company_collaborators")
      .select(
        "collaborator:profiles!company_collaborators_collaborator_id_fkey(id, full_name, email)"
      )
      .eq("company_id", id),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      // Admins também podem ser responsáveis (consultores) de uma empresa.
      .in("role", ["consultor", "admin"])
      .order("full_name", { ascending: true }),
    // Candidatos a colaborador responsável — qualquer cargo pode ser vinculado
    // (há consultores/admins que executam).
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("role", ["colaborador", "consultor", "admin"])
      .order("full_name", { ascending: true }),
    loadLabelCatalog(supabase),
    loadCompanyLabels(supabase, id),
    // Catálogo de tarefas padrão ATIVAS (para escolher). Molde inativo não aparece.
    supabase
      .from("standard_tasks")
      .select("id, title, kind")
      .eq("active", true)
      .order("title", { ascending: true }),
    // Tarefas padrão JÁ atribuídas nesta empresa (molde vivo por standard_task_id).
    supabase
      .from("task_templates")
      .select("standard_task_id, collaborator_id")
      .eq("company_id", id)
      .eq("active", true)
      .not("standard_task_id", "is", null),
  ]);

  const company = companyData as Company | null;
  if (!company) notFound();

  const consultores = withSelf((consultoresData as ConsultantOption[]) ?? [], profile);
  const selectedIds: string[] = [];
  for (const link of (linksData as CompanyLink[]) ?? []) {
    const c = first(link.consultant);
    if (c) selectedIds.push(c.id);
  }

  const colaboradores = withSelf(
    (colaboradoresData as ConsultantOption[]) ?? [],
    profile
  );
  const selectedCollaboratorIds: string[] = [];
  for (const link of (collaboratorLinksData as CompanyCollaboratorLink[]) ?? []) {
    const c = first(link.collaborator);
    if (c) selectedCollaboratorIds.push(c.id);
  }

  // Tarefas padrão desta empresa: catálogo + atribuições atuais (padrão → responsável).
  const standards = (standardData as StandardOption[]) ?? [];
  const currentStandardTasks = ((assignedData as AssignedRow[]) ?? [])
    .filter((a) => a.standard_task_id)
    .map((a) => ({
      standardId: a.standard_task_id as string,
      collaboratorId: a.collaborator_id,
    }));

  // Responsável da tarefa padrão = SÓ os colaboradores responsáveis da empresa
  // (company_collaborators). Monta a lista válida a partir dos vínculos.
  const responsibles: ConsultantOption[] = [];
  for (const link of (collaboratorLinksData as CompanyCollaboratorLink[]) ?? []) {
    const c = first(link.collaborator);
    if (c) responsibles.push(c);
  }
  // Responsáveis antigos (ainda gravados em alguma tarefa) que saíram da lista —
  // preservados e mostrados como "fora da lista" para poderem ser corrigidos.
  const responsibleIdSet = new Set(responsibles.map((r) => r.id));
  const byId = new Map(colaboradores.map((p) => [p.id, p]));
  const staleResponsibles = Array.from(
    new Set(currentStandardTasks.map((a) => a.collaboratorId))
  )
    .filter((id) => !responsibleIdSet.has(id))
    .map((id) => byId.get(id))
    .filter((p): p is ConsultantOption => !!p);

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={`Editar · ${company.name}`}
      back={{ href: `/admin/empresas/${company.id}`, label: company.name }}
    >
      <div className="mx-auto max-w-2xl">
        <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-4 font-semibold text-fg">Dados da empresa</h2>
          <CompanyEditor company={company} />
        </section>

        <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <CompanyConsultants
            companyId={company.id}
            consultores={consultores}
            selectedIds={selectedIds}
          />
        </section>

        <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <CompanyCollaborators
            companyId={company.id}
            collaborators={colaboradores}
            selectedIds={selectedCollaboratorIds}
          />
        </section>

        {/* Tarefas padrão desta empresa (movido da central da empresa para cá,
            abaixo dos colaboradores responsáveis). Mesmo componente/permissões. */}
        {standards.length > 0 && (
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-1 font-semibold text-fg">
              Tarefas padrão desta empresa
            </h2>
            <p className="mb-4 text-sm text-fg-muted">
              Selecione as tarefas do catálogo que esta empresa usa e o
              responsável de cada uma. Editar a padrão no catálogo atualiza as
              tarefas em aberto aqui.
            </p>
            <CompanyStandardTasks
              companyId={company.id}
              standards={standards}
              collaborators={responsibles}
              current={currentStandardTasks}
              staleResponsibles={staleResponsibles}
            />
          </section>
        )}

        <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <CompanyLabels
            companyId={company.id}
            labels={labelCatalog}
            selectedIds={companyLabels.map((l) => l.id)}
          />
        </section>

        <section className="rounded-2xl border border-red-300/60 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-500/10">
          <h2 className="font-semibold text-red-800 dark:text-red-300">
            Excluir empresa
          </h2>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300/80">
            Remove a empresa e, em cascata, os vínculos de consultores e todas as
            tarefas (templates e instâncias) ligadas a ela. Esta ação não pode ser
            desfeita.
          </p>
          <div className="mt-4">
            <DeleteCompanyButton companyId={company.id} companyName={company.name} />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
