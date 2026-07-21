import type { Metadata } from "next";
import { guardRole } from "@/components/guardRole";
import ClientPortalPreview from "@/components/ClientPortalPreview";

export const metadata: Metadata = {
  title: "Ver como cliente — Monvatti",
  robots: { index: false, follow: false },
};

// "Ver como cliente" do CONSULTOR (passo 30). Ele não tem — e não passa a ter
// — acesso ao token nem à senha: esta tela é alimentada por uma função que
// autoriza pelo CARGO e só devolve o conteúdo curado. Empresa que não é dele
// cai em 404 pela checagem no banco, não por esconder o botão.
export default async function ConsultorVerComoClientePage({
  params,
}: {
  params: { companyId: string };
}) {
  await guardRole(["consultor"]);

  return (
    <ClientPortalPreview
      companyId={params.companyId}
      backHref={`/consultor/${params.companyId}`}
      backLabel="Voltar à empresa"
    />
  );
}
