import ExcelJS from "exceljs";
import type { createClient } from "@/lib/supabase-server";
import {
  loadCompanyGroups,
  normalizeGroupColor,
  type CompanyGroup,
} from "@/lib/company-groups";
import {
  PROJECT_MODEL_LABEL,
  type ProjectModel,
} from "@/lib/company-details";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// =====================================================================
// Exportação do quadro de empresas em Excel (.xlsx) — admin-only.
//
// Uma planilha, agrupada EXATAMENTE como a tela /admin/empresas: grupos na
// ordem de `position` (balde "Sem grupo" por último), empresas ordenadas por
// nome dentro de cada grupo. Cada consultor e cada colaborador responsável
// ocupa UMA coluna própria (Consultor 1..N, Colaborador 1..M), com a largura
// calculada pelo máximo de responsáveis entre todas as empresas.
//
// A cor do grupo tinge a faixa de cabeçalho do grupo (tom claro, texto legível)
// e a coluna-indicadora à esquerda de cada linha (cor cheia) — mesmo princípio
// de uso da cor da tela (ver colorTints em company-groups).
// =====================================================================

type PersonRef = { id: string; name: string };

type ExportCompany = {
  id: string;
  name: string;
  groupId: string | null;
  projectModel: ProjectModel | null;
  startedOn: string | null; // "AAAA-MM-DD" (data pura, de company_details)
  consultants: PersonRef[];
  collaborators: PersonRef[];
};

// started_on é DATA pura "AAAA-MM-DD". Convertemos para o NÚMERO DE SÉRIE do
// Excel (dias desde 30/12/1899) por aritmética pura sobre ano/mês/dia — sem
// objeto Date, sem toISOString, sem fuso. A célula recebe esse número + formato
// de data, então o Excel a reconhece como DATA real (ordena/filtra como data).
// Ex.: "2026-10-01" → 46296 → exibe 01/10/2026 (nunca 30/09/2026).
function excelSerialFromPureDate(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // days_from_civil (Howard Hinnant): dias desde 1970-01-01 no calendário
  // gregoriano proléptico, puramente aritmético (sem Date).
  const yy = y - (mo <= 2 ? 1 : 0);
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (mo > 2 ? mo - 3 : mo + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const daysSinceUnixEpoch = era * 146097 + doe - 719468;
  // 25569 = dias de 1899-12-30 (epoch de série do Excel) até 1970-01-01.
  return daysSinceUnixEpoch + 25569;
}

// --- Cor -------------------------------------------------------------------

// ExcelJS espera ARGB (8 dígitos). Os grupos guardam #RRGGBB.
function toArgb(hex: string): string {
  return "FF" + normalizeGroupColor(hex).slice(1).toUpperCase();
}

// Mistura a cor com branco (factor 0 = cor cheia, 1 = branco). Usada para a
// faixa do grupo ficar clara o suficiente para o texto escuro ser legível —
// sem depender de alfa, que vários leitores de .xlsx renderizam sólido.
function tintArgb(hex: string, factor: number): string {
  const c = normalizeGroupColor(hex).slice(1);
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const mix = (ch: number) => Math.round(ch + (255 - ch) * factor);
  const h = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return "FF" + h(mix(r)) + h(mix(g)) + h(mix(b));
}

const INK = "FF1F2937"; // texto escuro (slate-800)
const HEADER_BG = "FF2B333B"; // gunmetal — cabeçalho das colunas
const HEADER_INK = "FFFFFFFF";
const LINE = "FFE5E7EB"; // borda clara
const SEM_GRUPO_COLOR = "#64748B"; // ardósia para o balde "Sem grupo"

// --- Carregamento ----------------------------------------------------------

type ConsultantLink = {
  company_id: string;
  consultant: { id: string; full_name: string | null; email: string } | { id: string; full_name: string | null; email: string }[] | null;
};
type CollaboratorLink = {
  company_id: string;
  collaborator: { id: string; full_name: string | null; email: string } | { id: string; full_name: string | null; email: string }[] | null;
};

function first<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}

function personName(p: { full_name: string | null; email: string }): string {
  return (p.full_name && p.full_name.trim()) || p.email;
}

// Reúne tudo que a planilha precisa numa ida agregada por tabela (nunca uma
// query por empresa). A RLS de admin escopa aos vínculos de todas as empresas.
export async function loadEmpresasExportData(supabase: SupabaseServer): Promise<{
  groups: CompanyGroup[];
  companies: ExportCompany[];
}> {
  const [groups, companiesRes, consRes, colabRes] = await Promise.all([
    loadCompanyGroups(supabase),
    supabase
      .from("companies")
      // Modelo e data de início vêm no MESMO select, por join 1-para-1 com
      // company_details (company_id é PK lá), escopado pela mesma RLS de admin.
      // Nada de segunda consulta que pudesse truncar em 1000 linhas.
      .select(
        "id, name, group_id, company_details(project_model, started_on)"
      )
      .order("name", { ascending: true })
      .limit(5000),
    supabase
      .from("company_consultants")
      .select(
        "company_id, consultant:profiles!company_consultants_consultant_id_fkey(id, full_name, email)"
      ),
    supabase
      .from("company_collaborators")
      .select(
        "company_id, collaborator:profiles!company_collaborators_collaborator_id_fkey(id, full_name, email)"
      ),
  ]);

  const consByCompany = new Map<string, PersonRef[]>();
  for (const link of (consRes.data as ConsultantLink[]) ?? []) {
    const c = first(link.consultant);
    if (!c) continue;
    const list = consByCompany.get(link.company_id) ?? [];
    list.push({ id: c.id, name: personName(c) });
    consByCompany.set(link.company_id, list);
  }

  const colabByCompany = new Map<string, PersonRef[]>();
  for (const link of (colabRes.data as CollaboratorLink[]) ?? []) {
    const c = first(link.collaborator);
    if (!c) continue;
    const list = colabByCompany.get(link.company_id) ?? [];
    list.push({ id: c.id, name: personName(c) });
    colabByCompany.set(link.company_id, list);
  }

  const byName = (a: PersonRef, b: PersonRef) =>
    a.name.localeCompare(b.name, "pt-BR");

  type DetailEmbed = {
    project_model: ProjectModel | null;
    started_on: string | null;
  };
  type CompanyRow = {
    id: string;
    name: string;
    group_id: string | null;
    // Relação 1-para-1, mas o PostgREST pode devolver objeto ou lista 1-elem.
    company_details: DetailEmbed | DetailEmbed[] | null;
  };

  const companies: ExportCompany[] = (
    (companiesRes.data as CompanyRow[]) ?? []
  ).map((c) => {
    const detail = first(c.company_details);
    return {
      id: c.id,
      name: c.name,
      groupId: c.group_id ?? null,
      projectModel: detail?.project_model ?? null,
      startedOn: detail?.started_on ?? null,
      consultants: (consByCompany.get(c.id) ?? []).sort(byName),
      collaborators: (colabByCompany.get(c.id) ?? []).sort(byName),
    };
  });

  return { groups, companies };
}

// --- Construção do workbook ------------------------------------------------

export async function buildEmpresasWorkbook(data: {
  groups: CompanyGroup[];
  companies: ExportCompany[];
}): Promise<ExcelJS.Buffer> {
  const { groups, companies } = data;

  // Partição por grupo na ordem da tela; "Sem grupo" por último.
  const byGroup = new Map<string, ExportCompany[]>();
  const semGrupo: ExportCompany[] = [];
  for (const c of companies) {
    if (c.groupId == null) semGrupo.push(c);
    else {
      const list = byGroup.get(c.groupId) ?? [];
      list.push(c);
      byGroup.set(c.groupId, list);
    }
  }
  const sections: { name: string; color: string; items: ExportCompany[] }[] =
    groups.map((g) => ({
      name: g.name,
      color: g.color,
      items: byGroup.get(g.id) ?? [],
    }));
  if (semGrupo.length > 0) {
    sections.push({ name: "Sem grupo", color: SEM_GRUPO_COLOR, items: semGrupo });
  }

  // Largura da tabela: máximo de responsáveis entre todas as empresas (mínimo 1
  // coluna de cada, para a planilha nunca ficar sem a coluna).
  const maxCons = Math.max(
    1,
    ...companies.map((c) => c.consultants.length)
  );
  const maxColab = Math.max(
    1,
    ...companies.map((c) => c.collaborators.length)
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM Monvatti";
  wb.created = new Date();
  const ws = wb.addWorksheet("Quadro de empresas", {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  // Colunas: A = indicador de cor | B = Empresa | C = Modelo do Projeto |
  // D = Data de início | consultores | colaboradores. O grupo aparece como
  // faixa/seção (não há coluna textual de grupo), então as duas colunas novas
  // ficam logo após o nome da empresa.
  const consHeaders = Array.from({ length: maxCons }, (_, i) =>
    maxCons === 1 ? "Consultor responsável" : `Consultor ${i + 1}`
  );
  const colabHeaders = Array.from({ length: maxColab }, (_, i) =>
    maxColab === 1 ? "Colaborador responsável" : `Colaborador ${i + 1}`
  );
  const headers = [
    "",
    "Empresa",
    "Modelo do Projeto",
    "Data de início",
    ...consHeaders,
    ...colabHeaders,
  ];
  const totalCols = headers.length;
  // Primeira coluna de pessoa (após Empresa + Modelo + Data de início).
  const FIRST_PERSON_COL = 5;

  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 18; // Modelo do Projeto
  ws.getColumn(4).width = 14; // Data de início
  for (let i = FIRST_PERSON_COL; i <= totalCols; i++) ws.getColumn(i).width = 26;

  const thin = { style: "thin" as const, color: { argb: LINE } };
  const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

  // --- Título ---
  const titleRow = ws.addRow(["", "Quadro de empresas — Monvatti"]);
  ws.mergeCells(titleRow.number, 2, titleRow.number, totalCols);
  const titleCell = ws.getCell(titleRow.number, 2);
  titleCell.font = { bold: true, size: 16, color: { argb: INK } };
  titleCell.alignment = { vertical: "middle" };
  titleRow.height = 26;

  const now = new Date();
  const stamp = now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const subRow = ws.addRow([
    "",
    `Exportado em ${stamp} · ${companies.length} empresa${companies.length === 1 ? "" : "s"}`,
  ]);
  ws.mergeCells(subRow.number, 2, subRow.number, totalCols);
  ws.getCell(subRow.number, 2).font = {
    italic: true,
    size: 10,
    color: { argb: "FF6B7280" },
  };

  ws.addRow([]); // espaçador

  // --- Cabeçalho das colunas ---
  const headerRow = ws.addRow(headers);
  headerRow.height = 22;
  for (let col = 2; col <= totalCols; col++) {
    const cell = ws.getCell(headerRow.number, col);
    cell.font = { bold: true, color: { argb: HEADER_INK }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_BG },
    };
    // Modelo do Projeto (C) e Data de início (D) centralizados p/ acompanhar as
    // células; demais cabeçalhos à esquerda.
    cell.alignment = {
      vertical: "middle",
      horizontal: col === 3 || col === 4 ? "center" : "left",
    };
    cell.border = allBorders;
  }
  // Congela abaixo do cabeçalho das colunas e à direita da coluna Empresa.
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: headerRow.number }];

  // --- Seções (grupos) ---
  for (const section of sections) {
    const bandArgb = tintArgb(section.color, 0.82);
    const dotArgb = toArgb(section.color);

    // Faixa do grupo (B..última coluna mesclada); coluna A = cor cheia.
    const band = ws.addRow([""]);
    band.height = 22;
    ws.mergeCells(band.number, 2, band.number, totalCols);
    const aCell = ws.getCell(band.number, 1);
    aCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dotArgb } };
    const bandCell = ws.getCell(band.number, 2);
    bandCell.value = `${section.name}  (${section.items.length} empresa${
      section.items.length === 1 ? "" : "s"
    })`;
    bandCell.font = { bold: true, size: 12, color: { argb: INK } };
    bandCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: bandArgb },
    };
    bandCell.alignment = { vertical: "middle" };
    for (let col = 1; col <= totalCols; col++) {
      ws.getCell(band.number, col).border = {
        top: { style: "medium", color: { argb: dotArgb } },
        bottom: thin,
      };
    }

    if (section.items.length === 0) {
      const empty = ws.addRow(["", "— sem empresas —"]);
      ws.mergeCells(empty.number, 2, empty.number, totalCols);
      const ec = ws.getCell(empty.number, 2);
      ec.font = { italic: true, color: { argb: "FF9CA3AF" } };
      ws.getCell(empty.number, 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: dotArgb },
      };
      continue;
    }

    for (const company of section.items) {
      // Modelo como rótulo da tela (BPO / Consultoria / Ema); vazio se nulo.
      const modelLabel = company.projectModel
        ? PROJECT_MODEL_LABEL[company.projectModel] ?? ""
        : "";
      // Data de início como número de série do Excel (ou null = célula vazia).
      const startSerial = excelSerialFromPureDate(company.startedOn);

      const values: (string | number | null)[] = [
        "",
        company.name,
        modelLabel,
        startSerial,
      ];
      for (let i = 0; i < maxCons; i++) {
        values.push(company.consultants[i]?.name ?? "");
      }
      for (let i = 0; i < maxColab; i++) {
        values.push(company.collaborators[i]?.name ?? "");
      }
      const row = ws.addRow(values);
      row.height = 18;

      // Indicador de cor do grupo à esquerda.
      ws.getCell(row.number, 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: dotArgb },
      };

      const nameCell = ws.getCell(row.number, 2);
      nameCell.font = { bold: true, color: { argb: INK } };
      nameCell.alignment = { vertical: "middle" };
      nameCell.border = allBorders;

      // Modelo do Projeto (C): texto simples, centralizado; célula vazia fica
      // vazia mesmo (sem "—", para não atrapalhar filtro/ordenação no Excel).
      const modelCell = ws.getCell(row.number, 3);
      modelCell.alignment = { vertical: "middle", horizontal: "center" };
      modelCell.font = { color: { argb: INK } };
      modelCell.border = allBorders;

      // Data de início (D): DATA real (número de série + formato dd/mm/aaaa),
      // centralizada. Nula → célula vazia (nunca texto), p/ ordenar como data.
      const dateCell = ws.getCell(row.number, 4);
      dateCell.alignment = { vertical: "middle", horizontal: "center" };
      dateCell.font = { color: { argb: INK } };
      dateCell.border = allBorders;
      if (startSerial != null) dateCell.numFmt = "dd/mm/yyyy";

      // Pessoas (consultores/colaboradores): "—" quando a coluna não se aplica.
      for (let col = FIRST_PERSON_COL; col <= totalCols; col++) {
        const cell = ws.getCell(row.number, col);
        cell.alignment = { vertical: "middle" };
        cell.font = { color: { argb: INK } };
        cell.border = allBorders;
        if (!cell.value) {
          cell.value = "—";
          cell.font = { color: { argb: "FFC4C9D0" } };
        }
      }
    }
  }

  // Filtro automático no cabeçalho das colunas (não cobre as faixas de grupo,
  // mas permite ordenar/filtrar a tabela toda rapidamente).
  ws.autoFilter = {
    from: { row: headerRow.number, column: 2 },
    to: { row: headerRow.number, column: totalCols },
  };

  return wb.xlsx.writeBuffer();
}

// Nome do arquivo com a data (sem fuso ambíguo no nome).
export function empresasExportFilename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `quadro-empresas-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(
    d.getDate()
  )}.xlsx`;
}
