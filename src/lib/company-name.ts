// Helpers de NOME FANTASIA (companies.trade_name) — puros, sem "use client",
// para servir tanto Server Components (cabeçalho da empresa) quanto Client
// Components (boards e seletores). A normalização replica `norm` de
// ListControls (minúsculas + sem acento) para busca consistente com o resto.

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Texto secundário (cinza) do nome fantasia. Retorna null quando vazio OU igual
// ao nome (decisão: não mostrar quando vazio ou igual ao nome). O número está no
// prefixo do nome, então "354. PAGNAN (Aiva)" vs "Aiva" nunca são iguais.
export function tradeHint(
  name: string,
  trade?: string | null
): string | null {
  const t = (trade ?? "").trim();
  if (!t) return null;
  if (normalize(t) === normalize(name)) return null;
  return t;
}

// Casa um termo de busca contra o NOME ou o NOME FANTASIA de uma empresa, sem
// acento e sem caixa. O NÚMERO está embutido no nome (prefixo "354. "), então
// buscar "354" casa pelo nome. Termo vazio = sem filtro (casa tudo).
export function matchesCompany(
  query: string,
  name: string,
  trade?: string | null
): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  if (normalize(name).includes(q)) return true;
  const t = (trade ?? "").trim();
  return t ? normalize(t).includes(q) : false;
}
