import type { Metadata } from "next";
import { guardRole } from "@/components/guardRole";
import ClientPortalPreview from "@/components/ClientPortalPreview";

export const metadata: Metadata = {
  title: "Ver como cliente — Monvatti",
  robots: { index: false, follow: false },
};

// "Ver como cliente" do ADMIN (passo 30). Sem AppShell de propósito: a graça é
// ver a tela exatamente como o cliente vê, sem sidebar nem menu. O guardRole
// barra quem não for admin; a autorização por empresa é revalidada no banco.
export default async function AdminVerComoClientePage({
  params,
}: {
  params: { id: string };
}) {
  await guardRole(["admin"]);

  return (
    <ClientPortalPreview
      companyId={params.id}
      backHref={`/admin/empresas/${params.id}`}
      backLabel="Voltar à empresa"
    />
  );
}
