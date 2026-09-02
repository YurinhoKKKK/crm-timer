import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanyDetailsView from "@/components/company-central/CompanyDetailsView";
import { loadCompanyDetails } from "@/lib/company-details";

// Informações do cliente — página própria da empresa. Admin EDITA.
export default async function AdminCompanyInfoPage({
  params,
}: {
  params: { id: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const [{ data: company }, details] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.id).maybeSingle(),
    loadCompanyDetails(supabase, params.id, true),
  ]);
  if (!company) notFound();

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={(company as { name: string }).name}
      back={{ href: `/admin/empresas/${params.id}`, label: "Empresa" }}
    >
      <CompanyDetailsView companyId={params.id} initial={details} canEdit />
    </AppShell>
  );
}
