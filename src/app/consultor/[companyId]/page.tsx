import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanyCentral from "@/components/company-central/CompanyCentral";
import CompanyCentralTabs from "@/components/company-central/CompanyCentralTabs";
import CompanyListings from "@/components/company-central/CompanyListings";
import CompanyNotes from "@/components/company-central/CompanyNotes";
import { loadCompanyCentral, type Period } from "@/lib/company-central";
import { loadCompanyListings } from "@/lib/listing";
import { loadCompanyNotes } from "@/lib/notes";

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

function normalizePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return PERIODS.includes(v as Period) ? (v as Period) : "30d";
}

// Central da empresa (Passo 19) — visão completa + ações, para o consultor.
// A RLS (companies_select) só devolve a empresa se for atribuída a ele; caso
// contrário loadCompanyCentral retorna notFound. Sem edição de dados da empresa
// (isso é do admin) — o consultor age via nova tarefa e tarefas padrão.
export default async function ConsultorEmpresaPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { periodo?: string };
}) {
  const { supabase, profile } = await guardRole(["consultor"]);
  const period = normalizePeriod(searchParams?.periodo);

  // Mesma paralelização da central do admin: as três leituras são
  // independentes e cada uma é escopada pela RLS por conta própria (aqui, às
  // empresas deste consultor). Antes rodavam em cascata.
  const [res, listings, notes] = await Promise.all([
    loadCompanyCentral(supabase, profile, params.companyId, period, false),
    loadCompanyListings(supabase, params.companyId),
    loadCompanyNotes(supabase, params.companyId),
  ]);
  if (res.notFound) notFound();

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor", avatarUrl: profile.avatarUrl }}
      title={res.data?.company.name ?? "Empresa"}
      back={{ href: "/consultor", label: "Painel" }}
    >
      {res.error || !res.data ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar a empresa: {res.error ?? "dados indisponíveis"}.
        </div>
      ) : (
        <CompanyCentralTabs
          overview={
            <CompanyCentral
              data={res.data}
              period={period}
              tasksHref={`/consultor/${params.companyId}/tarefas`}
              previewHref={`/consultor/${params.companyId}/ver-como-cliente`}
            />
          }
          listings={<CompanyListings rows={listings} />}
          notes={
            <CompanyNotes
              companyId={params.companyId}
              userId={profile.id}
              isAdmin={false}
              notes={notes}
            />
          }
        />
      )}
    </AppShell>
  );
}
