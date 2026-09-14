import { pureDateDiffDays } from "@/lib/company-details";

// Etiqueta DERIVADA "Cliente Novo" — NUNCA gravada no banco. É 100% calculada de
// company_details.started_on na leitura: empresa cujo início de contrato caiu nos
// últimos 90 dias recebe o selo; passados 90 dias, ele some sozinho. Etiqueta
// gravada precisaria de alguém para apagar todo dia — derivada, nunca desatualiza.
// Por isso também não aparece na gestão de etiquetas nem pode ser posta à mão.
//
// Tudo em DATA PURA ("YYYY-MM-DD"): a diferença usa pureDateDiffDays (Date.UTC,
// sem fuso). O `today` deve ser todayBRT() — o dia civil de Brasília.

export const NEW_CLIENT_DAYS = 90;

// É "Cliente Novo"? started_on nos últimos 90 dias (0 = começou hoje). Sem data,
// contrato no FUTURO ou início há mais de 90 dias → false.
export function isNewClient(startedOn: string | null, today: string): boolean {
  if (!startedOn) return false;
  const age = pureDateDiffDays(startedOn, today); // hoje − início (≥0 no passado)
  return age >= 0 && age <= NEW_CLIENT_DAYS;
}

// "cliente há 47 dias" / "cliente há 2 meses" — há quanto tempo está na Monvatti,
// de started_on até hoje. Nunca negativo: sem data ou contrato ainda por começar
// → null (o chamador não mostra tooltip).
export function newClientTenure(
  startedOn: string | null,
  today: string
): string | null {
  if (!startedOn) return null;
  const days = pureDateDiffDays(startedOn, today);
  if (days < 0) return null; // contrato ainda vai começar
  if (days === 0) return "cliente desde hoje";
  if (days < 60) return `cliente há ${days} ${days === 1 ? "dia" : "dias"}`;
  const months = Math.round(days / 30);
  if (months < 12)
    return `cliente há ${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.round(months / 12);
  return `cliente há ${years} ${years === 1 ? "ano" : "anos"}`;
}
