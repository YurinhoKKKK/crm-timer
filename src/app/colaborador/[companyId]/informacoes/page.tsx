import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanyDetailsView from "@/components/company-central/CompanyDetailsView";
import { loadCompanyDetails } from "@/lib/company-details";
import { loadCompanyPauseInfo } from "@/lib/company-pause";

// Informações do cliente — página própria da empresa. Colaborador apenas
// VISUALIZA (canEdit=false; a RLS barra a escrita). A empresa só é alcançável
// se ele tiver tarefa nela (vínculo derivado da RLS).
export default async function ColaboradorCompanyInfoPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { supabase, profile } = await guardRole([
    "colaborador",
    "admin",
    "consultor",
  ]);

  const [{ data: company }, details, pauseInfo] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", params.companyId)
      .maybeSingle(),
    loadCompanyDetails(supabase, params.companyId),
    loadCompanyPauseInfo(supabase, params.companyId),
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
      <CompanyDetailsView
        companyId={params.companyId}
        initial={details}
        canEdit={false}
        pauseInfo={pauseInfo}
      />
    </AppShell>
  );
}
