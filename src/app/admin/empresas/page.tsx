import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
import type { Company } from "@/lib/types";
import NewCompanyForm from "./NewCompanyForm";
import CompanyConsultants from "./CompanyConsultants";

type ConsultantOption = { id: string; full_name: string; email: string };

// O embed do Supabase tipa o recurso relacionado como array; normalizamos abaixo.
type CompanyLink = {
  company_id: string;
  consultant: ConsultantOption | ConsultantOption[] | null;
};

export default async function EmpresasPage() {
  const { supabase } = await guardRole(["admin"]);

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
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/admin"
              className="rounded text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              ← Painel
            </Link>
            <h1 className="mt-1 text-2xl font-semibold text-gunmetal">
              Gestão de empresas
            </h1>
            <p className="text-sm text-gunmetal/60">
              Cadastre clientes, vincule o grupo de WhatsApp e atribua os
              consultores responsáveis.
            </p>
          </div>
          <LogoutButton />
        </header>

        <NewCompanyForm consultores={consultores} />

        {consultores.length === 0 && (
          <p className="mb-6 text-sm text-gunmetal/50">
            Ainda não há consultores cadastrados. Defina o cargo de alguém como
            “Consultor” em{" "}
            <Link href="/admin/usuarios" className="text-risd hover:underline">
              Usuários
            </Link>{" "}
            para poder atribuí-lo a uma empresa.
          </p>
        )}

        {companiesError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Erro ao carregar empresas: {companiesError.message}
          </div>
        ) : companies.length === 0 ? (
          <div className="rounded-xl border border-platinum bg-white p-12 text-center text-gunmetal/50 shadow-sm">
            Nenhuma empresa cadastrada ainda.
          </div>
        ) : (
          <ul className="space-y-3">
            {companies.map((company) => {
              const linked = consultantsByCompany.get(company.id) ?? [];
              return (
                <li
                  key={company.id}
                  className="rounded-xl border border-platinum bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-gunmetal">
                      {company.name}
                    </span>
                    {company.whatsapp_group_name || company.whatsapp_contact_id ? (
                      <span className="text-sm text-gunmetal/60">
                        WhatsApp:{" "}
                        {company.whatsapp_group_name ?? "(sem nome)"}
                        {company.whatsapp_contact_id && (
                          <span className="text-gunmetal/40">
                            {" "}
                            · {company.whatsapp_contact_id}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-sm text-gunmetal/40">
                        Sem grupo de WhatsApp vinculado.
                      </span>
                    )}
                  </div>

                  <div className="mt-4 border-t border-platinum pt-4">
                    <CompanyConsultants
                      companyId={company.id}
                      consultores={consultores}
                      selectedIds={linked.map((c) => c.id)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
