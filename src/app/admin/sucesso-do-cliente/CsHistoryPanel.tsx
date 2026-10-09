"use client";

import { useCallback } from "react";
import { csStatusShort, CS_AUDIT_PAGE } from "@/lib/cs-status";
import HistoryPanel from "@/components/history-panel/HistoryPanel";
import { fetchCsAudit, type CsAuditEntry } from "./actions";

function roleLabel(role: CsAuditEntry["subjectRole"]): string {
  if (role === "ambos") return "Consultor e Colaborador";
  if (role === "consultor") return "Consultor";
  if (role === "colaborador") return "Colaborador";
  return "";
}

// 'AAAA-MM-DD' → 'DD/MM/AAAA' por recorte de texto (sem Date, sem fuso).
function dateBR(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function money(v: string | null): string {
  if (v == null) return "";
  const n = Number(v);
  return Number.isFinite(n) ? BRL.format(n) : v;
}

// Monta a frase do registro. Trata criar (de nada), limpar (para nada) e alterar.
// changed_by nulo (integração/SQL avulso) → "Sistema".
function describe(e: CsAuditEntry): string {
  const by = e.changedByName ?? "Sistema";
  const isDate =
    e.field === "data_reuniao" || e.field === "data_entrada" || e.field === "data_fim";
  const fmt = (v: string | null) => {
    if (isDate) return dateBR(v);
    if (e.field === "valor_projeto") return money(v);
    if (e.field === "parcelas") return v ?? "";
    return csStatusShort(v); // nps_geral / nps_pessoa
  };

  let noun: string;
  switch (e.field) {
    case "nps_pessoa": {
      const r = roleLabel(e.subjectRole);
      noun = `o NPS de ${e.subjectName ?? "(usuário removido)"}${r ? ` (${r})` : ""}`;
      break;
    }
    case "nps_geral":
      noun = "o NPS geral";
      break;
    case "data_reuniao":
      noun = "a Data da Reunião";
      break;
    case "valor_projeto":
      noun = "o valor do projeto";
      break;
    case "parcelas":
      noun = "as parcelas";
      break;
    case "data_entrada":
      noun = "a Data de Entrada";
      break;
    case "data_fim":
      noun = "o fim do contrato";
      break;
    default:
      noun = "o campo";
  }

  if (e.oldValue == null && e.newValue != null) {
    return `${by} definiu ${noun} como ${fmt(e.newValue)}`;
  }
  if (e.oldValue != null && e.newValue == null) {
    return `${by} limpou ${noun} (era ${fmt(e.oldValue)})`;
  }
  if (e.oldValue != null && e.newValue != null) {
    return `${by} alterou ${noun} de ${fmt(e.oldValue)} para ${fmt(e.newValue)}`;
  }
  return `${by} atualizou ${noun}`;
}

export default function CsHistoryPanel({
  companyId,
  companyName,
  onClose,
}: {
  companyId: string;
  companyName: string;
  onClose: () => void;
}) {
  const load = useCallback(
    (offset: number) => fetchCsAudit(companyId, offset),
    [companyId]
  );

  return (
    <HistoryPanel<CsAuditEntry>
      eyebrow="Histórico — Sucesso do Cliente"
      companyName={companyName}
      onClose={onClose}
      load={load}
      describe={describe}
      getKey={(e) => e.id}
      getWhenISO={(e) => e.changedAtISO}
      pageSize={CS_AUDIT_PAGE}
    />
  );
}
