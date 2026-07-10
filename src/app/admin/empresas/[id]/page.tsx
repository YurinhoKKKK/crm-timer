import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanyCentral from "@/components/company-central/CompanyCentral";
import CompanyCentralTabs from "@/components/company-central/CompanyCentralTabs";
import CompanyListings from "@/components/company-central/CompanyListings";
import { loadCompanyCentral, type Period } from "@/lib/company-central";
import { loadCompanyListings } from "@/lib/listing";

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

function normalizePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return PERIODS.includes(v as Period) ? (v as Period) : "30d";
}

// Central da empresa (Passo 19) — visão completa + ações, para o admin (todas
// as empresas). A edição de dados/vínculos fica em ./editar.
export default async function EmpresaCentralPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { periodo?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);
  const period = normalizePeriod(searchParams?.periodo);

  const res = await loadCompanyCentral(supabase, profile, params.id, period);
  if (res.notFound) notFound();

  const listings = res.data ? await loadCompanyListings(supabase, params.id) : [];

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
          overview={
            <CompanyCentral
              data={res.data}
              period={period}
              editHref={`/admin/empresas/${params.id}/editar`}
            />
          }
          listings={<CompanyListings rows={listings} />}
        />
      )}
    </AppShell>
  );
}
