import { Suspense } from "react";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import MyListings from "./MyListings";
import { loadMyListings } from "@/lib/listing";

// "Minhas Listagens" do COLABORADOR (visão única, cruzando empresas). Primeira
// tela em que um colaborador vê dados atravessando empresas: o isolamento por
// executor é garantido no BANCO (RPC my_listings — SECURITY INVOKER, filtra por
// collaborator_id = auth.uid() e roda sob a RLS do chamador). A tela só filtra
// EM MEMÓRIA sobre o conjunto já escopado, então nada de fora do escopo aparece.
export default async function ColaboradorListagensPage() {
  const { supabase, profile } = await guardRole(["colaborador"]);
  const rows = await loadMyListings(supabase);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Minhas Listagens"
      subtitle="Todas as suas entregas de listagem, com o veredito do cliente"
    >
      {/* useSearchParams (destaque da notificação) exige fronteira de Suspense. */}
      <Suspense fallback={null}>
        <MyListings rows={rows} />
      </Suspense>
    </AppShell>
  );
}
