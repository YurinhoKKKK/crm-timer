import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanyRevenue from "@/components/company-central/CompanyRevenue";
import {
  loadCompanyRevenue,
  loadCompanyRevenueInsights,
  parseRevenueRange,
} from "@/lib/revenue";

// Faturamento — página própria da empresa para o COLABORADOR (decisão nova:
// colaborador lê E escreve faturamento nas empresas que já alcança). Mesma
// experiência completa de admin/consultor (canais + tabela + lançamento +
// correção): a RLS de company_revenues & cia. agora inclui
// my_collaborator_companies() (empresa em que ele tem tarefa). A empresa só é
// alcançável se ele tiver tarefa nela — se não, companies_select devolve null
// e caímos em notFound (e, ainda que passasse, a RLS do faturamento volta
// vazia). O portal do cliente nunca chega aqui.
export default async function ColaboradorRevenuePage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { fatDe?: string; fatAte?: string };
}) {
  const { supabase, profile } = await guardRole([
    "colaborador",
    "admin",
    "consultor",
  ]);
  const { range: revRange, invalid: revInvalid } = parseRevenueRange(
    searchParams?.fatDe,
    searchParams?.fatAte
  );

  const [{ data: company }, revenue, revenueInsights] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", params.companyId)
      .maybeSingle(),
    loadCompanyRevenue(supabase, params.companyId, revRange),
    loadCompanyRevenueInsights(supabase, params.companyId, revRange),
  ]);
  if (!company) notFound();

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor" | "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title={(company as { name: string }).name}
      back={{ href: `/colaborador/${params.companyId}`, label: "Empresa" }}
    >
      <CompanyRevenue
        key={`${revRange.start ?? ""}:${revRange.end ?? ""}`}
        companyId={params.companyId}
        initial={revenue}
        initialInsights={revenueInsights}
        range={revRange}
        filterInvalid={revInvalid}
      />
    </AppShell>
  );
}
