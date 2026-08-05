// Formatação de data do portal do cliente — sempre no fuso de Brasília,
// como todo o sistema.
export function formatPortalDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const TZ = "America/Sao_Paulo";

// "Terça-feira, 05 de agosto de 2026" — cabeçalho de uma reunião.
export function formatPortalLongDate(iso: string): string {
  const label = new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatPortalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "14:30 – 15:30"; se cruzar a meia-noite, mostra a data do fim junto.
export function formatPortalRange(startISO: string, endISO: string): string {
  const sameDay =
    new Date(startISO).toLocaleDateString("en-CA", { timeZone: TZ }) ===
    new Date(endISO).toLocaleDateString("en-CA", { timeZone: TZ });
  const end = sameDay
    ? formatPortalTime(endISO)
    : `${formatPortalDate(endISO)} ${formatPortalTime(endISO)}`;
  return `${formatPortalTime(startISO)} – ${end}`;
}
