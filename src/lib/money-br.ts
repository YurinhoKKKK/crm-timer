// Dinheiro em formato brasileiro — parser e formatadores COMPARTILHADOS pelo
// quadro CS (Valor Mensal) e pelo Tráfego (Orçamento). Regra de ouro: nunca
// representar dinheiro como float no JS; converte-se por TEXTO para "digits.dd"
// e envia-se como texto ao banco (que faz a conta exata em numeric).

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// "10000.00" (decimal em texto vindo do banco) → "R$ 10.000,00". Nulo/ inválido
// → null (quem chama decide o fallback, ex.: "Não definido").
export function formatBRL(text: string | null): string | null {
  if (text == null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? BRL.format(n) : null;
}

// O input aceita BR ("2.980,00"); convertemos por TEXTO para "digits.dd". Vírgula
// = decimal, ponto = milhar (convenção BR). Inválido → null.
export function brToDecimalString(raw: string): string | null {
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    if ((s.match(/,/g) || []).length > 1) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return `${i}.${(f + "00").slice(0, 2)}`;
}

// "10000.00" → "10.000,00" (pré-preenche o input em BR).
export function decimalToBRInput(ds: string): string {
  const [i, f = "00"] = ds.split(".");
  return `${Number(i).toLocaleString("pt-BR")},${(f + "00").slice(0, 2)}`;
}

// "digits.dd" → centavos (inteiro) — para prévia e otimismo, sem float de dinheiro.
export function decimalToCents(ds: string): number {
  const [i, f = "00"] = ds.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
}

// centavos (inteiro) → "digits.dd".
export function centsToDecimal(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

// centavos (inteiro) → "R$ 1.234,56" (só exibição).
export function centsToBRL(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  const reais = Math.floor(c / 100);
  return `R$ ${reais.toLocaleString("pt-BR")},${String(c % 100).padStart(2, "0")}`;
}
