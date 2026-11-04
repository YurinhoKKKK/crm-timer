// Mensagem única (decisão 2): não se edita uma tarefa com timer rodando — o
// tempo aberto é de quem está cronometrando e trocar o responsável agora
// bagunçaria o registro. O NOME de quem está com o trecho aberto vem do banco
// (RPCs instance_timer_block / template_timer_block / raise 'TIMER_RODANDO:').
export function timerRunningMessage(name: string): string {
  return `Tarefa com timer rodando agora (por ${name}). Peça para pausar antes de trocar o responsável.`;
}

// Traduz o erro cru do PostgREST quando a RPC de reatribuição em massa recusa
// por timer aberto (raise 'TIMER_RODANDO:<nome>'); devolve null se não for esse
// caso (o chamador então usa a mensagem original).
export function timerMessageFromError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/TIMER_RODANDO:(.+)/);
  if (!m) return null;
  return timerRunningMessage(m[1].trim());
}
