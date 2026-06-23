import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Company } from "@/lib/types";
import NewCompanyForm from "./NewCompanyForm";

type ConsultantOption = { id: string; full_name: string; email: string };

// O embed do Supabase tipa o recurso relacionado como array; normalizamos abaixo.
type CompanyLink = {
  company_id: string;
  consultant: ConsultantOption | ConsultantOption[] | null;
};

export default async function EmpresasPage() {
  const { supabase, profile } = await guardRole(["admin"]);

  const [{ data: companiesData, error: companiesError }, { data: linksData }, { data: consultoresData }] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id, name, whatsapp_contact_id, whatsapp_group_name, created_at, updated_at")
        .order("name", { ascending: true }),
      supabase
        .from("company_consultants")
        .select(
          "company_id, consultant:profiles!company_consultants_consultant_id_fkey(id, full_name, email)"
        ),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "consultor")
        .order("full_name", { ascending: true }),
    ]);

  const companies = (companiesData as Company[]) ?? [];
  const consultores = (consultoresData as ConsultantOption[]) ?? [];

  // Mapa empresa → consultores vinculados.
  const consultantsByCompany = new Map<string, ConsultantOption[]>();
  for (const link of (linksData as CompanyLink[]) ?? []) {
    const consultant = Array.isArray(link.consultant)
      ? link.consultant[0]
      : link.consultant;
    if (!consultant) continue;
    const list = consultantsByCompany.get(link.company_id) ?? [];
    list.push(consultant);
    consultantsByCompany.set(link.company_id, list);
  }

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin" }}
      title="Gestão de empresas"
      subtitle="Cadastre clientes, vincule o grupo de WhatsApp e atribua os consultores responsáveis."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      <NewCompanyForm consultores={consultores} />

      {consultores.length === 0 && (
        <p className="mb-6 text-sm text-fg-subtle">
          Ainda não há consultores cadastrados. Defina o cargo de alguém como
          “Consultor” em{" "}
          <Link href="/admin/usuarios" className="text-risd hover:underline">
            Usuários
          </Link>{" "}
          para poder atribuí-lo a uma empresa.
        </p>
      )}

      {companiesError ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar empresas: {companiesError.message}
        </div>
      ) : companies.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Nenhuma empresa cadastrada ainda.
        </div>
      ) : (
        <ul className="space-y-3">
          {companies.map((company) => {
            const linked = consultantsByCompany.get(company.id) ?? [];
            return (
              <li key={company.id}>
                <Link
                  href={`/admin/empresas/${company.id}`}
                  className="group block rounded-xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-fg group-hover:text-risd">
                      {company.name}
                    </span>
                    <span className="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-risd">
                      →
                    </span>
                  </div>
                  {company.whatsapp_group_name || company.whatsapp_contact_id ? (
                    <span className="mt-1 block text-sm text-fg-muted">
                      WhatsApp: {company.whatsapp_group_name ?? "(sem nome)"}
                    </span>
                  ) : (
                    <span className="mt-1 block text-sm text-fg-subtle">
                      Sem grupo de WhatsApp vinculado.
                    </span>
                  )}
                  {linked.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {linked.map((c) => (
                        <span
                          key={c.id}
                          className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-muted"
                        >
                          {c.full_name || c.email}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
