import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Company, TaskKind } from "@/lib/types";
import type { createClient } from "@/lib/supabase-server";
import NewCompanyForm from "./NewCompanyForm";
import CompanyBrowser from "./CompanyBrowser";
import type { CompanyItem } from "./CompanyBrowser";
import LabelManager from "./LabelManager";
import { withSelf } from "@/lib/people";
import { loadLabelCatalog, loadLabelsByCompany, loadInUseLabels } from "@/lib/labels";
import { avatarUrl } from "@/lib/avatar";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

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

// "Ver mais" cresce a janela em passos de 20 (mesma escala das outras listas).
const PAGE_STEP = 20;
const MAX_VISIBLE = 1000; // teto defensivo do parâmetro da URL

// searchParams chega como string | string[] | undefined — normaliza p/ string.
function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// Escapa os curingas do ILIKE (%, _, \) para a busca por nome tratar o texto
// como literal — senão "%" digitado casaria com tudo.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Página de empresas FILTRADA E PAGINADA NO SERVIDOR. Compõe busca por nome +
// etiquetas (OU) + consultor, sempre dentro do escopo da RLS. Devolve a janela
// [0, limit) e o TOTAL do conjunto filtrado inteiro (não só da página) — é o que
// deixa a paginação e a contagem refletirem o filtro, não a página atual.
async function queryCompanyPage(
  supabase: SupabaseServer,
  opts: { q: string; labelIds: string[]; consultantId: string; limit: number }
): Promise<{ rows: Company[]; total: number }> {
  // Restrição por IDs quando há filtro de etiqueta e/ou consultor. Cada sub-busca
  // é escopada pela SUA RLS (cl_select / companies-consultants), então a
  // interseção nunca amplia o que o usuário pode ver.
  let restrict: Set<string> | null = null;

  if (opts.labelIds.length > 0) {
    const { data } = await supabase
      .from("company_labels")
      .select("company_id")
      .in("label_id", opts.labelIds); // OU: empresa com QUALQUER etiqueta marcada
    restrict = new Set(
      ((data as { company_id: string }[] | null) ?? []).map((r) => r.company_id)
    );
  }

  if (opts.consultantId) {
    const { data } = await supabase
      .from("company_consultants")
      .select("company_id")
      .eq("consultant_id", opts.consultantId);
    const ids = new Set(
      ((data as { company_id: string }[] | null) ?? []).map((r) => r.company_id)
    );
    restrict = restrict
      ? new Set(Array.from(restrict).filter((id) => ids.has(id)))
      : ids;
  }

  // Filtro selecionado que não casa com nenhuma empresa alcançável → vazio, sem
  // ir ao banco de novo (um .in([]) é sempre vazio, mas evitamos a ida).
  if (restrict && restrict.size === 0) return { rows: [], total: 0 };

  let query = supabase
    .from("companies")
    .select(
      "id, name, whatsapp_contact_id, whatsapp_group_name, created_at, updated_at",
      { count: "exact" }
    )
    .order("name", { ascending: true })
    .range(0, opts.limit - 1);

  if (opts.q) query = query.ilike("name", `%${escapeLike(opts.q)}%`);
  if (restrict) query = query.in("id", Array.from(restrict));

  const { data, count } = await query;
  return { rows: (data as Company[]) ?? [], total: count ?? 0 };
}

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: { q?: string; labels?: string | string[]; consultant?: string | string[]; n?: string | string[] };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  // Estado de VISÃO na URL (como periodo/status noutras telas): busca, etiquetas
  // (csv), consultor e o tamanho da janela do "ver mais".
  const q = firstParam(searchParams.q).trim();
  const labelIds = firstParam(searchParams.labels)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const consultantId = firstParam(searchParams.consultant).trim();
  const nRaw = parseInt(firstParam(searchParams.n), 10);
  const limit = Number.isFinite(nRaw)
    ? Math.min(MAX_VISIBLE, Math.max(PAGE_STEP, nRaw))
    : PAGE_STEP;

  const [
    { rows: pageRows, total },
    inUseLabels,
    { data: consultoresData },
    { data: colaboradoresData },
    { data: standardData },
    labelCatalog,
  ] = await Promise.all([
    queryCompanyPage(supabase, { q, labelIds, consultantId, limit }),
    loadInUseLabels(supabase),
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
    loadLabelCatalog(supabase),
  ]);

  // Etiquetas e consultores SÓ das empresas da página atual (a lista é
  // server-paginada; não carregamos vínculos da base inteira).
  const pageIds = pageRows.map((c) => c.id);
  const [labelsByCompany, { data: linksData }] = await Promise.all([
    loadLabelsByCompany(supabase, pageIds),
    pageIds.length > 0
      ? supabase
          .from("company_consultants")
          .select(
            "company_id, consultant:profiles!company_consultants_consultant_id_fkey(id, full_name, email, avatar_path)"
          )
          .in("company_id", pageIds)
      : Promise.resolve({ data: [] as CompanyLink[] }),
  ]);

  // O admin pode se incluir como consultor responsável de uma empresa (Passo 14).
  const consultores = withSelf((consultoresData as ConsultantOption[]) ?? [], profile);
  // ...e também como responsável de uma tarefa padrão da empresa.
  const colaboradores = withSelf(
    (colaboradoresData as PersonOption[]) ?? [],
    profile
  );
  const standards = (standardData as StandardOption[]) ?? [];

  // Mapa empresa → consultores vinculados (só das empresas visíveis).
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

  const companyItems: CompanyItem[] = pageRows.map((c) => ({
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

      <CompanyBrowser
        companies={companyItems}
        total={total}
        step={PAGE_STEP}
        inUseLabels={inUseLabels}
        selectedLabelIds={labelIds}
        query={q}
        consultantId={consultantId}
        consultores={consultores.map((c) => ({
          value: c.id,
          label: c.full_name || c.email,
        }))}
      />
    </AppShell>
  );
}
