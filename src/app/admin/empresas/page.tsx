import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Company } from "@/lib/types";
import NewCompanyForm from "./NewCompanyForm";
import CompanyList, { type CompanyItem } from "./CompanyList";
import { withSelf } from "@/lib/people";

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
  // O admin pode se incluir como consultor responsável de uma empresa (Passo 14).
  const consultores = withSelf((consultoresData as ConsultantOption[]) ?? [], profile);

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

  const companyItems: CompanyItem[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    whatsappGroupName: c.whatsapp_group_name,
    whatsappContactId: c.whatsapp_contact_id,
    consultants: (consultantsByCompany.get(c.id) ?? []).map((x) => ({
      id: x.id,
      name: x.full_name || x.email,
    })),
  }));

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
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
      ) : (
        <CompanyList
          companies={companyItems}
          consultores={consultores.map((c) => ({
            value: c.id,
            label: c.full_name || c.email,
          }))}
        />
      )}
    </AppShell>
  );
}
