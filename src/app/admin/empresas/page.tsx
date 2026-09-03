import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskKind } from "@/lib/types";
import NewCompanyForm from "./NewCompanyForm";
import CompanyGroupsBoard, { type CompanyItem } from "./CompanyGroupsBoard";
import { withSelf } from "@/lib/people";
import { loadLabelCatalog, loadAllLabelsByCompany, loadInUseLabels } from "@/lib/labels";
import { loadCompanyGroups, resolveCompanyGroupId } from "@/lib/company-groups";
import { loadCompanyNoteCounts } from "@/lib/notes";
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

type CompanyRow = {
  id: string;
  name: string;
  whatsapp_contact_id: string | null;
  whatsapp_group_name: string | null;
  group_id: string | null;
  // Embed 1:1 com company_details (datas do contrato) — mesma consulta da lista,
  // nunca uma ida por empresa. PostgREST devolve objeto (ou array) ou null.
  company_details:
    | { started_on: string | null; ends_on: string | null }
    | { started_on: string | null; ends_on: string | null }[]
    | null;
};

// Teto de carregamento explícito: a tela é AGRUPADA e filtra/busca client-side
// sobre TODAS as empresas (padrão /acompanhamento). O volume é limitado (dezenas/
// centenas), mas nunca exibimos contagem parcial em silêncio — se bater o teto,
// avisamos (ver truncated). Regra do truncamento silencioso do PostgREST na
// especificação (§7).
const LOAD_CAP = 2000;

export default async function EmpresasPage() {
  const { supabase, profile } = await guardRole(["admin"]);

  const [
    companiesRes,
    groups,
    allLabelsByCompany,
    inUseLabels,
    { data: consultoresData },
    { data: colaboradoresData },
    { data: standardData },
    labelCatalog,
    { data: linksData },
    noteCounts,
  ] = await Promise.all([
    supabase
      .from("companies")
      .select(
        "id, name, whatsapp_contact_id, whatsapp_group_name, group_id, company_details(started_on, ends_on)",
        { count: "exact" }
      )
      .order("name", { ascending: true })
      .limit(LOAD_CAP),
    loadCompanyGroups(supabase),
    loadAllLabelsByCompany(supabase),
    loadInUseLabels(supabase),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      // Admins também podem ser responsáveis (consultores) de uma empresa.
      .in("role", ["consultor", "admin"])
      .order("full_name", { ascending: true }),
    // Responsáveis possíveis das tarefas padrão atribuídas na criação.
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("role", ["colaborador", "admin"])
      .order("full_name", { ascending: true }),
    supabase
      .from("standard_tasks")
      .select("id, title, kind")
      .order("title", { ascending: true }),
    loadLabelCatalog(supabase),
    // Consultores por empresa — a RLS de company_consultants escopa ao admin
    // (todas); uma query só (volume limitado).
    supabase
      .from("company_consultants")
      .select(
        "company_id, consultant:profiles!company_consultants_consultant_id_fkey(id, full_name, email, avatar_path)"
      ),
    // Contagem de anotações por empresa numa ida agregada (RPC), nunca uma por
    // empresa nem contando array no cliente.
    loadCompanyNoteCounts(supabase),
  ]);

  const rows = (companiesRes.data as CompanyRow[]) ?? [];
  const total = companiesRes.count ?? rows.length;
  const truncated = total > rows.length;

  // O admin pode se incluir como consultor responsável de uma empresa (Passo 14)
  // e como responsável de uma tarefa padrão.
  const consultores = withSelf((consultoresData as ConsultantOption[]) ?? [], profile);
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

  const companyItems: CompanyItem[] = rows.map((c) => {
    const det = Array.isArray(c.company_details)
      ? c.company_details[0] ?? null
      : c.company_details;
    return {
    id: c.id,
    name: c.name,
    whatsappGroupName: c.whatsapp_group_name,
    whatsappContactId: c.whatsapp_contact_id,
    consultants: (consultantsByCompany.get(c.id) ?? []).map((x) => ({
      id: x.id,
      name: x.full_name || x.email,
      avatarUrl: avatarUrl(x.avatar_path),
    })),
    labels: allLabelsByCompany.get(c.id) ?? [],
    // ÚNICO ponto de leitura de group_id: o helper centraliza para a porta de M:N.
    groupId: resolveCompanyGroupId(c),
    noteCount: noteCounts.get(c.id) ?? 0,
    startedOn: det?.started_on ?? null,
    endsOn: det?.ends_on ?? null,
    };
  });

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Gestão de empresas"
      subtitle="Organize os clientes em grupos, vincule o grupo de WhatsApp e atribua os consultores responsáveis."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      <NewCompanyForm
        consultores={consultores}
        standards={standards}
        collaborators={colaboradores}
        labels={labelCatalog}
      />

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

      <CompanyGroupsBoard
        companies={companyItems}
        groups={groups}
        total={total}
        truncated={truncated}
        viewerId={profile.id}
        inUseLabels={inUseLabels}
        labelCatalog={labelCatalog}
        consultores={consultores.map((c) => ({
          value: c.id,
          label: c.full_name || c.email,
        }))}
      />
    </AppShell>
  );
}
