import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import FollowupTabs from "@/components/followup/FollowupTabs";
import {
  loadFollowupBoard,
  loadFollowupLastSync,
  loadScoresMonth,
  loadUnlinkedCompanies,
  clampTab,
  clampMonth,
  monthOptions,
  type LoadResult,
  type ScoreMonthRow,
  type UnlinkedCompany,
} from "@/lib/followup";

// Acompanhamento de clientes — monitora se TODOS os clientes estão recebendo
// contato constante ("quem está esfriando?"), não ranqueia ninguém. Desde a 0150
// o contato vem SÓ das mensagens do Digisac (cor do dia), e a tela ganhou uma
// aba de Pontuação (admin). Admin vê todas as empresas de grupo ativo; consultor
// só a carteira dele (escopo garantido no banco, dentro das RPCs SECURITY
// DEFINER). Colaborador não acessa (guardRole barra).
//
// force-dynamic: os dados mudam a cada sync do Digisac; o período/mês/aba vêm da
// URL (estado de visão) e refazem a leitura no servidor.
export const dynamic = "force-dynamic";

export default async function AcompanhamentoPage({
  searchParams,
}: {
  searchParams: {
    aba?: string | string[];
    mes?: string | string[];
  };
}) {
  const { supabase, profile } = await guardRole(["admin", "consultor"]);
  const isAdmin = profile.role === "admin";

  // A aba de Pontuação só existe para o admin; consultor cai sempre no board.
  const tab = isAdmin ? clampTab(searchParams.aba) : "acompanhamento";
  // Mês ÚNICO para as duas abas (set/2026 → corrente; padrão corrente).
  const month = clampMonth(searchParams.mes);

  // O board e o "atualizado às" saem sempre (fonte da aba Acompanhamento e do
  // carimbo em ambas as abas). A pontuação do mês só quando o admin está na aba
  // Pontuação — uma ida a menos ao banco para consultor/aba de board.
  const onScores = isAdmin && tab === "pontuacao";
  const [boardRes, lastSync, scoresRes, unlinked] = await Promise.all([
    loadFollowupBoard(supabase, month),
    loadFollowupLastSync(supabase),
    onScores
      ? loadScoresMonth(supabase, month)
      : Promise.resolve({ rows: [], error: null } as LoadResult<ScoreMonthRow>),
    onScores
      ? loadUnlinkedCompanies(supabase)
      : Promise.resolve([] as UnlinkedCompany[]),
  ]);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor",
        avatarUrl: profile.avatarUrl,
      }}
      title="Acompanhamento de clientes"
      subtitle="Contato pelo Digisac — para atender de forma constante, não para ranquear."
    >
      <FollowupTabs
        role={profile.role as "admin" | "consultor"}
        tab={tab}
        board={boardRes.rows}
        boardError={boardRes.error}
        lastSync={lastSync}
        month={month}
        monthOptions={monthOptions()}
        scores={scoresRes.rows}
        scoresError={scoresRes.error}
        unlinked={unlinked}
      />
    </AppShell>
  );
}
