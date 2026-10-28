import { parse } from "node-html-parser";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { monthYearLabel } from "@/lib/period";

// Helpers de SERVIDOR da exportação de PDF do Histórico. Arrastam o parser de
// HTML (node-html-parser), então só a rota (runtime nodejs) importa daqui — o
// modal cliente usa só o historico-pdf.ts leve.

// ---------------------------------------------------------------------------
// Datas em Brasília (o banco guarda UTC). Sem fixar o fuso, o PDF gerado no
// servidor da Vercel (UTC) mostraria horários do dia seguinte à noite.
// ---------------------------------------------------------------------------
const BRT = "America/Sao_Paulo";

const FMT_DATETIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRT,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const FMT_DATE_BR = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRT,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const FMT_DATE_CA = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRT,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// "2026-10-28T20:00:00Z" → "28/10/2026 · 17:00" (BRT). Mesmo estilo do feed.
export function brtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return FMT_DATETIME.format(d).replace(",", " ·");
}

// "…Z" → "28/10/2026" (BRT).
export function brtDateBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return FMT_DATE_BR.format(d);
}

// "…Z" → "2026-10-28" (BRT) — usado para filtrar anotações por data do dia.
export function brtDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return FMT_DATE_CA.format(d);
}

// "…Z" → "2026-10" (BRT) — chave de agrupamento por mês.
export function brtMonthKey(iso: string): string {
  return brtDateKey(iso).slice(0, 7);
}

// Carimbo "agora" em BRT, "28/10/2026 14:30" (para "Gerado por … em …").
export function brtNowStamp(): string {
  return FMT_DATETIME.format(new Date()).replace(",", "");
}

// "2026-10" → "Outubro de 2026" (cabeçalho de mês na linha do tempo).
export function monthHeading(ym: string): string {
  const [mon, yr] = monthYearLabel(ym).split("/");
  const cap = mon ? mon.charAt(0).toUpperCase() + mon.slice(1) : ym;
  return `${cap} de ${yr}`;
}

// ---------------------------------------------------------------------------
// Nome do arquivo: historico-<numero>-<slug>-AAAA-MM-DD.pdf
// O número da empresa é o prefixo do nome ("283. INNO" → "283"); o slug é o
// resto, sem acento e em minúsculas.
// ---------------------------------------------------------------------------
export function companyNumberFromName(name: string): string {
  const m = (name || "").match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

export function slugifyCompany(name: string): string {
  const slug = (name || "")
    .replace(/^\s*\d+[\s.\-–—)]*/, "") // remove número + pontuação inicial
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // remove acentos (diacríticos)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "empresa";
}

export function buildHistoricoFilename(name: string, todayYmd: string): string {
  const num = companyNumberFromName(name);
  const slug = slugifyCompany(name);
  const base = num ? `historico-${num}-${slug}` : `historico-${slug}`;
  return `${base}-${todayYmd}.pdf`;
}

// ---------------------------------------------------------------------------
// Rodapé carimbado em TODAS as páginas com pdf-lib, DEPOIS do react-pdf.
// (O rodapé `fixed` com `render` do react-pdf estoura em documentos longos.)
// Desenha uma linha fina + "Documento interno…" à esquerda e "Página X de Y" à
// direita, na margem inferior reservada pela página.
// ---------------------------------------------------------------------------
const FOOTER_LEFT = "Documento interno · Monvatti · CRM/Timer";

export async function stampHistoricoFooter(
  pdfBytes: Uint8Array
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const size = 7.5;
  const marginX = 44;
  const baseY = 24;
  const gray = rgb(0.42, 0.44, 0.47); // #6B7280 aprox.
  const line = rgb(223 / 255, 220 / 255, 219 / 255); // #DFDCDB

  pages.forEach((page, i) => {
    const { width } = page.getSize();
    page.drawLine({
      start: { x: marginX, y: baseY + 12 },
      end: { x: width - marginX, y: baseY + 12 },
      thickness: 0.75,
      color: line,
    });
    page.drawText(FOOTER_LEFT, { x: marginX, y: baseY, size, font, color: gray });
    const right = `Página ${i + 1} de ${total}`;
    const w = font.widthOfTextAtSize(right, size);
    page.drawText(right, {
      x: width - marginX - w,
      y: baseY,
      size,
      font,
      color: gray,
    });
  });

  return doc.save();
}

// ---------------------------------------------------------------------------
// Sanitização de texto para as fontes PADRÃO do PDF (WinAnsi/CP1252). As 14
// fontes padrão do PDF (Helvetica etc.) não têm biblioteca TTF embutida: só
// desenham o conjunto CP1252. Os acentos do português estão todos lá; o que NÃO
// está (setas, emoji, outros alfabetos) quebraria a renderização. Trocamos
// setas por "->" e descartamos o resto — nunca embutir fonte externa (risco de
// deploy, igual ao da fixação do DOMPurify).
// ---------------------------------------------------------------------------
const CP1252_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function pdfText(input: string | null | undefined): string {
  if (!input) return "";
  // Qualquer seta (blocos Unicode de setas) vira "->".
  const s = input.replace(
    new RegExp("[\\u2190-\\u21FF\\u27F0-\\u27FF\\u2900-\\u297F]", "g"),
    "->"
  );
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10) {
      out += ch; // tab / quebra de linha
    } else if (c >= 0x20 && c <= 0x7e) {
      out += ch; // ASCII
    } else if (c >= 0xa0 && c <= 0xff) {
      out += ch; // Latin-1 (acentos do português)
    } else if (CP1252_EXTRA.has(c)) {
      out += ch; // aspas curvas, travessão, reticências, • …
    }
    // demais (emoji, CJK, etc.): descartados
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTML das anotações (já sanitizado pelo DOMPurify) → blocos para o react-pdf.
// O editor é TipTap, então o HTML é bem-formado e usa um conjunto pequeno de
// tags. Convertemos em parágrafos / títulos / citações / itens de lista, com
// trechos inline (negrito, itálico, sublinhado; links viram texto).
// ---------------------------------------------------------------------------
export type PdfRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  link?: boolean;
};

export type PdfBlock = {
  type: "paragraph" | "heading" | "blockquote" | "listitem";
  runs: PdfRun[];
  headingLevel?: number;
  // listitem:
  ordered?: boolean;
  index?: number;
  level?: number; // profundidade da lista (1 = primeiro nível)
};

type Style = Omit<PdfRun, "text">;
type ListCtx = { ordered: boolean; counter: number };

export function htmlToPdfBlocks(html: string): PdfBlock[] {
  const root = parse(html || "");
  const blocks: PdfBlock[] = [];
  let current: PdfBlock | null = null;
  let pending: { ordered: boolean; index: number; level: number } | null = null;

  function applyPending() {
    if (current && pending) {
      current.type = "listitem";
      current.ordered = pending.ordered;
      current.index = pending.index;
      current.level = pending.level;
      pending = null;
    }
  }
  function flush() {
    if (current) {
      const runs = current.runs;
      if (runs.length) {
        runs[0].text = runs[0].text.replace(/^[ \t]+/, "");
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/[ \t]+$/, "");
        for (let i = runs.length - 1; i >= 0; i--) {
          if (runs[i].text === "") runs.splice(i, 1);
        }
      }
      if (current.runs.length || current.type === "listitem") blocks.push(current);
      current = null;
    }
  }
  function ensure(type: PdfBlock["type"], extra?: Partial<PdfBlock>) {
    flush();
    current = { type, runs: [], ...extra };
    applyPending();
  }
  function getBlock(): PdfBlock {
    if (!current) {
      current = { type: "paragraph", runs: [] };
      applyPending();
    }
    return current;
  }
  function addText(text: string, style: Style) {
    if (text === "") return;
    getBlock().runs.push({ text, ...style });
  }

  function walk(node: ReturnType<typeof parse>, style: Style, lists: ListCtx[]) {
    for (const child of node.childNodes) {
      // TEXT_NODE
      if (child.nodeType === 3) {
        const t = (child.text || "").replace(/\s+/g, " ");
        addText(t, style);
        continue;
      }
      // ELEMENT_NODE
      if (child.nodeType !== 1) continue;
      const el = child as unknown as { tagName?: string } & ReturnType<typeof parse>;
      const tag = el.tagName ? String(el.tagName).toUpperCase() : "";
      switch (tag) {
        case "STRONG":
        case "B":
          walk(el, { ...style, bold: true }, lists);
          break;
        case "EM":
        case "I":
          walk(el, { ...style, italic: true }, lists);
          break;
        case "U":
          walk(el, { ...style, underline: true }, lists);
          break;
        case "A":
          walk(el, { ...style, link: true }, lists);
          break;
        case "S":
        case "STRIKE":
        case "DEL":
        case "SPAN":
        case "MARK":
        case "CODE":
          walk(el, style, lists);
          break;
        case "BR":
          addText("\n", style);
          break;
        case "P":
        case "DIV":
        case "PRE":
          ensure("paragraph");
          walk(el, style, lists);
          flush();
          break;
        case "H1":
        case "H2":
        case "H3":
        case "H4":
        case "H5":
        case "H6":
          ensure("heading", { headingLevel: Number(tag.slice(1)) });
          walk(el, { ...style, bold: true }, lists);
          flush();
          break;
        case "BLOCKQUOTE":
          ensure("blockquote");
          walk(el, style, lists);
          flush();
          break;
        case "UL":
          walk(el, style, [...lists, { ordered: false, counter: 0 }]);
          break;
        case "OL":
          walk(el, style, [...lists, { ordered: true, counter: 0 }]);
          break;
        case "LI": {
          const ctx = lists[lists.length - 1];
          if (ctx) ctx.counter += 1;
          pending = {
            ordered: ctx?.ordered ?? false,
            index: ctx?.counter ?? 1,
            level: Math.max(1, lists.length),
          };
          walk(el, style, lists);
          flush();
          pending = null;
          break;
        }
        default:
          walk(el, style, lists);
      }
    }
  }

  walk(root, {}, []);
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// Linha do tempo unificada (atividades + anotações), agrupada por mês.
// ---------------------------------------------------------------------------
export type ActivityEntry = {
  kind: "activity";
  at: string; // ISO
  typeLabel: string;
  authorName: string;
  content: string;
};

// Etiqueta de área já pronta para o PDF: rótulo + cores oficiais (as mesmas da
// tela — ML amarelo, Amazon escuro, Shopee laranja, etc.).
export type NoteAreaTag = { label: string; bg: string; fg: string };

export type NoteEntry = {
  kind: "note";
  at: string; // ISO (created_at)
  authorName: string;
  blocks: PdfBlock[];
  areas: NoteAreaTag[];
  visibleToClient: boolean;
  attachments: string[]; // nomes dos anexos
  edited: boolean;
};

export type TimelineEntry = ActivityEntry | NoteEntry;

export type TimelineGroup = { heading: string; entries: TimelineEntry[] };

// Ordena CRONOLOGICAMENTE (mais antigo primeiro) e agrupa por mês (BRT).
export function groupByMonth(entries: TimelineEntry[]): TimelineGroup[] {
  const sorted = [...entries].sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    if (ta !== tb) return ta - tb;
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  });
  const groups: TimelineGroup[] = [];
  let currentKey = "";
  for (const e of sorted) {
    const key = brtMonthKey(e.at);
    if (key !== currentKey) {
      currentKey = key;
      groups.push({ heading: monthHeading(key), entries: [] });
    }
    groups[groups.length - 1].entries.push(e);
  }
  return groups;
}
