import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Company } from "@/lib/types";
import CompanyConsultants from "../CompanyConsultants";
import CompanyEditor from "./CompanyEditor";
import DeleteCompanyButton from "./DeleteCompanyButton";
import NewTaskForm from "@/app/admin/tarefas/NewTaskForm";

type ConsultantOption = { id: string; full_name: string; email: string };
type CollaboratorOption = { id: string; full_name: string; email: string };
type CompanyLink = {
  consultant: ConsultantOption | ConsultantOption[] | null;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function EmpresaDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const { supabase, profile } = await guardRole(["admin"]);

  const [
    { data: companyData },
    { data: linksData },
    { data: consultoresData },
    { data: colaboradoresData },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, whatsapp_contact_id, whatsapp_group_name, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("company_consultants")
      .select(
        "consultant:profiles!company_consultants_consultant_id_fkey(id, full_name, email)"
      )
      .eq("company_id", id),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "consultor")
      .order("full_name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "colaborador")
      .order("full_name", { ascending: true }),
  ]);

  const company = companyData as Company | null;
  if (!company) notFound();

  const consultores = (consultoresData as ConsultantOption[]) ?? [];
  const colaboradores = (colaboradoresData as CollaboratorOption[]) ?? [];
  const selectedIds: string[] = [];
  for (const link of (linksData as CompanyLink[]) ?? []) {
    const c = first(link.consultant);
    if (c) selectedIds.push(c.id);
  }

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={company.name}
      back={{ href: "/admin/empresas", label: "Empresas" }}
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

        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-fg-muted">
            Tarefas desta empresa
          </h2>
          {colaboradores.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface p-5 text-sm text-fg-subtle shadow-card">
              Cadastre ao menos um colaborador para criar tarefas.
            </div>
          ) : (
            <NewTaskForm
              companies={[{ id: company.id, name: company.name }]}
              collaborators={colaboradores}
              lockedCompany={{ id: company.id, name: company.name }}
            />
          )}
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
