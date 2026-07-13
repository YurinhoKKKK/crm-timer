// Helpers de formatação reutilizados nas telas.

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "0min";
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDue(due: string | null): string {
  if (!due) return "Sem prazo";
  // due_at é um instante (timestamptz). Exibimos SEMPRE no horário de Brasília,
  // independentemente do fuso do runtime (o servidor Next roda em UTC; o browser
  // do usuário, em BRT). Sem fixar o timeZone, a mesma tela mostraria horários
  // diferentes no SSR e no cliente.
  return new Date(due).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
