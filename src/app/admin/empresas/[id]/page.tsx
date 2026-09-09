import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanyCentral from "@/components/company-central/CompanyCentral";
import CompanyCentralTabs from "@/components/company-central/CompanyCentralTabs";
import CompanyListings from "@/components/company-central/CompanyListings";
import CompanyNotes from "@/components/company-central/CompanyNotes";
import { loadCompanyCentral } from "@/lib/company-central";
import { resolvePeriod } from "@/lib/period";
import { loadCompanyListings, loadListingValidations } from "@/lib/listing";
import { loadCompanyNotes } from "@/lib/notes";
import {
  loadCompanyRevenue,
  loadCompanyRevenueInsights,
  parseRevenueRange,
} from "@/lib/revenue";
import {
  loadMeetings,
  loadMeetingDirectory,
  loadGoogleConnected,
} from "@/lib/meetings";
import CompanyMeetings from "@/components/company-central/CompanyMeetings";
import CompanyRevenue from "@/components/company-central/CompanyRevenue";

// Central da empresa (Passo 19) — visão completa + ações, para o admin (todas
// as empresas). A edição de dados/vínculos fica em ./editar.
export default async function EmpresaCentralPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    periodo?: string;
    mes?: string;
    de?: string;
    ate?: string;
    aba?: string;
    fatDe?: string;
    fatAte?: string;
  };
}) {
  const { supabase, profile } = await guardRole(["admin"]);
  const period = resolvePeriod(searchParams);
  const { range: revRange, invalid: revInvalid } = parseRevenueRange(
    searchParams?.fatDe,
    searchParams?.fatAte
  );

  // As três leituras são independentes entre si — listagens e anotações não
  // dependem de nada que a central devolve. Antes rodavam em cascata (uma onda
  // de rede a mais); agora vão juntas. Cada uma é escopada pela RLS por conta
  // própria, então disparar as três em paralelo não amplia o que o usuário
  // enxerga: sem acesso à empresa, todas voltam vazias.
  const [
    res,
    listings,
    listingValidations,
    notes,
    meetings,
    directory,
    googleConnected,
    revenue,
    revenueInsights,
  ] = await Promise.all([
    loadCompanyCentral(
      supabase,
      profile,
      params.id,
      { start: period.start, end: period.end },
      true
    ),
    loadCompanyListings(supabase, params.id),
    loadListingValidations(supabase, params.id),
    loadCompanyNotes(supabase, params.id),
    loadMeetings(supabase, { companyId: params.id }),
    loadMeetingDirectory(supabase),
    loadGoogleConnected(supabase),
    loadCompanyRevenue(supabase, params.id, revRange),
    loadCompanyRevenueInsights(supabase, params.id, revRange),
  ]);
  if (res.notFound) notFound();

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={res.data?.company.name ?? "Empresa"}
      back={{ href: "/admin/empresas", label: "Empresas" }}
    >
      {res.error || !res.data ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar a empresa: {res.error ?? "dados indisponíveis"}.
        </div>
      ) : (
        <CompanyCentralTabs
          initialTab={
            searchParams?.aba === "listings"
              ? "listings"
              : searchParams?.aba === "reunioes"
              ? "meetings"
              : searchParams?.aba === "faturamento"
              ? "revenue"
              : searchParams?.aba === "notes"
              ? "notes"
              : "overview"
          }
          overview={
            <CompanyCentral
              data={res.data}
              period={period}
              editHref={`/admin/empresas/${params.id}/editar`}
              infoHref={`/admin/empresas/${params.id}/informacoes`}
              tasksHref={`/admin/empresas/${params.id}/tarefas`}
              previewHref={`/admin/empresas/${params.id}/ver-como-cliente`}
            />
          }
          meetings={
            <CompanyMeetings
              companyId={params.id}
              companyName={res.data.company.name}
              rows={meetings}
              directory={directory}
              currentUserId={profile.id}
              isAdmin={profile.role === "admin"}
              googleConnected={googleConnected}
            />
          }
          revenue={
            <CompanyRevenue
              key={`${revRange.start ?? ""}:${revRange.end ?? ""}`}
              companyId={params.id}
              initial={revenue}
              initialInsights={revenueInsights}
              range={revRange}
              filterInvalid={revInvalid}
            />
          }
          listings={
            <CompanyListings rows={listings} validations={listingValidations} />
          }
          notes={
            <CompanyNotes
              companyId={params.id}
              userId={profile.id}
              isAdmin
              notes={notes}
            />
          }
        />
      )}
    </AppShell>
  );
}
