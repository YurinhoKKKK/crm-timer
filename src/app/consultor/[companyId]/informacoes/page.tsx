import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanyDetailsView from "@/components/company-central/CompanyDetailsView";
import { loadCompanyDetails } from "@/lib/company-details";

// Informações do cliente — página própria da empresa. Consultor apenas
// VISUALIZA (a RLS barra a escrita; canEdit=false esconde a edição). A empresa
// só é alcançável se for da carteira dele (RLS companies_select).
export default async function ConsultorCompanyInfoPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { supabase, profile } = await guardRole(["consultor"]);

  const [{ data: company }, details] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", params.companyId)
      .maybeSingle(),
    loadCompanyDetails(supabase, params.companyId, true),
  ]);
  if (!company) notFound();

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: "consultor",
        avatarUrl: profile.avatarUrl,
      }}
      title={(company as { name: string }).name}
      back={{ href: `/consultor/${params.companyId}`, label: "Empresa" }}
    >
      <CompanyDetailsView
        companyId={params.companyId}
        initial={details}
        canEdit={false}
      />
    </AppShell>
  );
}
