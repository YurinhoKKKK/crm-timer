import Link from "next/link";
import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
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
  const { supabase } = await guardRole(["admin"]);

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
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/admin/empresas"
              className="rounded text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              ← Empresas
            </Link>
            <h1 className="mt-1 truncate text-2xl font-semibold text-gunmetal">
              {company.name}
            </h1>
          </div>
          <LogoutButton />
        </header>

        <section className="mb-6 rounded-xl border border-platinum bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-medium text-gunmetal">Dados da empresa</h2>
          <CompanyEditor company={company} />
        </section>

        <section className="mb-6 rounded-xl border border-platinum bg-white p-5 shadow-sm">
          <CompanyConsultants
            companyId={company.id}
            consultores={consultores}
            selectedIds={selectedIds}
          />
        </section>

        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-gunmetal/70">
            Tarefas desta empresa
          </h2>
          {colaboradores.length === 0 ? (
            <div className="rounded-xl border border-platinum bg-white p-5 text-sm text-gunmetal/50 shadow-sm">
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

        <section className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-medium text-red-800">Excluir empresa</h2>
          <p className="mt-1 text-sm text-red-700">
            Remove a empresa e, em cascata, os vínculos de consultores e todas
            as tarefas (templates e instâncias) ligadas a ela. Esta ação não
            pode ser desfeita.
          </p>
          <div className="mt-4">
            <DeleteCompanyButton companyId={company.id} companyName={company.name} />
          </div>
        </section>
      </div>
    </main>
  );
}
