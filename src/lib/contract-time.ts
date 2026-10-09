// Formatação do "tempo de contrato/projeto" — compartilhada entre o quadro CS
// (Tempo de Projeto) e o quadro Tráfego (Tempo de Contrato). Os dois recebem os
// mesmos campos vindos da função SQL `contract_duration` (meses e dias, a partir
// de age(ends_on, started_on)). Exibição: "12 meses", "6 meses e 10 dias",
// "0 dias" ou "Não informado" (quando falta alguma data).
export function formatProjectTime(
  months: number | null,
  days: number | null
): string {
  if (months == null || days == null) return "Não informado";
  const parts: string[] = [];
  if (months > 0) parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? "dia" : "dias"}`);
  return parts.length > 0 ? parts.join(" e ") : "0 dias";
}
