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
