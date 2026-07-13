import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Company, TaskKind } from "@/lib/types";
import NewCompanyForm from "./NewCompanyForm";
import CompanyList, { type CompanyItem } from "./CompanyList";
import LabelManager from "./LabelManager";
import { withSelf } from "@/lib/people";
import { loadLabelCatalog, loadLabelsByCompany } from "@/lib/labels";
import { avatarUrl } from "@/lib/avatar";

type ConsultantOption = {
  id: string;
  full_name: string;
  email: string;
  avatar_path?: string | null;
};
type PersonOption = { id: string; full_name: string; email: string };
type StandardOption = { id: string; title: string; kind: TaskKind };

// O embed do Supabase tipa o recurso relacionado como array; normalizamos abaixo.
type CompanyLink = {
  company_id: string;
  consultant: ConsultantOption | ConsultantOption[] | null;
};

export default async function EmpresasPage() {
  const { supabase, profile } = await guardRole(["admin"]);

  const [
    { data: companiesData, error: companiesError },
    { data: linksData },
    { data: consultoresData },
    { data: colaboradoresData },
    { data: standardData },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, whatsapp_contact_id, whatsapp_group_name, created_at, updated_at")
      .order("name", { ascending: true }),
    supabase
      .from("company_consultants")
      .select(
        "company_id, consultant:profiles!company_consultants_consultant_id_fkey(id, full_name, email, avatar_path)"
      ),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      // Admins também podem ser responsáveis (consultores) de uma empresa.
      .in("role", ["consultor", "admin"])
      .order("full_name", { ascending: true }),
    // Responsáveis possíveis das tarefas padrão atribuídas na criação (Direção 2).
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("role", ["colaborador", "admin"])
      .order("full_name", { ascending: true }),
    // Catálogo de tarefas padrão, para escolher já na criação da empresa.
    supabase
      .from("standard_tasks")
      .select("id, title, kind")
      .order("title", { ascending: true }),
  ]);

  const companies = (companiesData as Company[]) ?? [];

  // Etiquetas: catálogo (p/ atribuir na criação e gerir) + mapa por empresa
  // (herança exibida na lista). Uma consulta em lote — escala sem N queries.
  const [labelCatalog, labelsByCompany] = await Promise.all([
    loadLabelCatalog(supabase),
    loadLabelsByCompany(
      supabase,
      companies.map((c) => c.id)
    ),
  ]);
  // O admin pode se incluir como consultor responsável de uma empresa (Passo 14).
  const consultores = withSelf((consultoresData as ConsultantOption[]) ?? [], profile);
  // ...e também como responsável de uma tarefa padrão da empresa.
  const colaboradores = withSelf(
    (colaboradoresData as PersonOption[]) ?? [],
    profile
  );
  const standards = (standardData as StandardOption[]) ?? [];

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
      avatarUrl: avatarUrl(x.avatar_path),
    })),
    labels: labelsByCompany.get(c.id) ?? [],
  }));

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Gestão de empresas"
      subtitle="Cadastre clientes, vincule o grupo de WhatsApp e atribua os consultores responsáveis."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      <NewCompanyForm
        consultores={consultores}
        standards={standards}
        collaborators={colaboradores}
        labels={labelCatalog}
      />

      <LabelManager labels={labelCatalog} />

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
