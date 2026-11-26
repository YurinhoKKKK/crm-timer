// =====================================================================
// Guard COMPARTILHADO dos auto-syncs da agenda Google. Dois lugares disparam o
// sync automático com a mesma regra de 10 min: o GoogleAutoSync (montado no
// AppShell, em toda tela) e o Calendar da /agenda. Sem um guard comum, a
// primeira carga da /agenda com sync velho disparava os DOIS ao mesmo tempo —
// rajada dupla de chamadas ao Google e duas varreduras de reconciliação.
//
// Duas camadas: um mutex em memória (mesmo bundle/página) e o carimbo de 10 min
// no localStorage (entre navegações e abas). O botão MANUAL "Sincronizar" não
// passa por aqui — clique do usuário sempre vale.
// =====================================================================

// A chave leva o ID DO USUÁRIO: o guard é por pessoa, não por navegador. Sem
// isso, o sync do admin no mesmo navegador segurava por 10 min o auto-sync de
// quem logasse em seguida (ex.: troca de conta em teste).
const GUARD_KEY_PREFIX = "agenda:lastAutoSync:";
export const AUTO_SYNC_STALE_MS = 10 * 60 * 1000;

let inFlight = false;

// true = pode sincronizar (e o carimbo já foi gravado); false = outro disparo
// recente/em andamento cobre este. Quem recebe true DEVE chamar endAutoSync()
// ao terminar (sucesso ou falha).
//
// `force`: ignora o carimbo de 10 min (mas não o mutex em memória). A PRIMEIRA
// sincronização logo após conectar precisa rodar mesmo que um auto-sync recente
// (quando ainda NÃO conectado, resultado nao_conectado) tenha carimbado o guard
// há menos de 10 min — senão a agenda só sincronizava no clique manual.
export function tryBeginAutoSync(userId: string, opts?: { force?: boolean }): boolean {
  if (inFlight) return false;
  try {
    const key = GUARD_KEY_PREFIX + userId;
    if (!opts?.force) {
      const last = Number(window.localStorage.getItem(key) ?? 0);
      if (Date.now() - last < AUTO_SYNC_STALE_MS) return false;
    }
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    // localStorage indisponível (modo privado etc.): fica só o mutex em memória
    // — o servidor aguenta (sync incremental) e a varredura tem o próprio teto.
  }
  inFlight = true;
  return true;
}

export function endAutoSync(): void {
  inFlight = false;
}
