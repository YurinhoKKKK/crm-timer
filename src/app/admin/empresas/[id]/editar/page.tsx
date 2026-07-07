import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Company } from "@/lib/types";
import CompanyConsultants from "../../CompanyConsultants";
import CompanyEditor from "../CompanyEditor";
import DeleteCompanyButton from "../DeleteCompanyButton";
import { withSelf } from "@/lib/people";

type ConsultantOption = { id: string; full_name: string; email: string };
type CompanyLink = {
  consultant: ConsultantOption | ConsultantOption[] | null;
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

  const [{ data: companyData }, { data: linksData }, { data: consultoresData }] =
    await Promise.all([
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
      supabase
        .from("profiles")
        .select("id, full_name, email")
        // Admins também podem ser responsáveis (consultores) de uma empresa.
        .in("role", ["consultor", "admin"])
        .order("full_name", { ascending: true }),
    ]);

  const company = companyData as Company | null;
  if (!company) notFound();

  const consultores = withSelf((consultoresData as ConsultantOption[]) ?? [], profile);
  const selectedIds: string[] = [];
  for (const link of (linksData as CompanyLink[]) ?? []) {
    const c = first(link.consultant);
    if (c) selectedIds.push(c.id);
  }

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
