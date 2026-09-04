import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanyDetailsView from "@/components/company-central/CompanyDetailsView";
import { loadCompanyDetails } from "@/lib/company-details";

// Informações do cliente — página própria da empresa. Colaborador apenas
// VISUALIZA (canEdit=false; a RLS barra a escrita). O cruzamento "canais
// contratados vs ativos" fica de fora AQUI (loadCompanyDetails(..., false) nem
// lê os canais ativos) — é da tela de Informações, à parte da tela própria de
// Faturamento (esta sim o colaborador acessa, ver .../faturamento). A empresa
// só é alcançável se ele tiver tarefa nela (vínculo derivado da RLS).
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

  const [{ data: company }, details] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", params.companyId)
      .maybeSingle(),
    loadCompanyDetails(supabase, params.companyId, false),
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
      />
    </AppShell>
  );
}
