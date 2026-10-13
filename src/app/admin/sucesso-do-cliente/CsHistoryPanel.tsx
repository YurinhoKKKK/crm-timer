"use client";

import { useCallback } from "react";
import { csStatusShort, CS_AUDIT_PAGE } from "@/lib/cs-status";
import { churnReasonLabel } from "@/lib/churn";
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
  // Churn (etapa 1): a frase já vem pronta do banco ("Cliente cancelado: …",
  // "Projeto finalizado", "Churn revertido (voltou para …)"). Só prefixa o autor.
  if (e.field === "churn") {
    return `${by}: ${e.newValue ?? ""}`;
  }
  const isDate =
    e.field === "data_reuniao" ||
    e.field === "data_entrada" ||
    e.field === "data_fim" ||
    e.field === "churn_data";
  const fmt = (v: string | null) => {
    if (isDate) return dateBR(v);
    if (e.field === "valor_projeto" || e.field === "churn_mrr") return money(v);
    if (e.field === "parcelas") return v ?? "";
    if (e.field === "churn_motivo") return churnReasonLabel(v);
    if (e.field === "churn_vendedor") return v ?? "";
    return csStatusShort(v); // nps_geral / nps_pessoa
  };

  let noun: string;
  switch (e.field) {
    case "churn_data":
      noun = "a data do churn";
      break;
    case "churn_motivo":
      noun = "o motivo do churn";
      break;
    case "churn_vendedor":
      noun = "o vendedor do churn";
      break;
    case "churn_mrr":
      noun = "o MRR do churn";
      break;
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
  // Controle de Churn: filtra o histórico aos campos de churn da empresa.
  onlyChurn = false,
}: {
  companyId: string;
  companyName: string;
  onClose: () => void;
  onlyChurn?: boolean;
}) {
  const load = useCallback(
    (offset: number) => fetchCsAudit(companyId, offset, onlyChurn),
    [companyId, onlyChurn]
  );

  return (
    <HistoryPanel<CsAuditEntry>
      eyebrow={onlyChurn ? "Histórico — Controle de Churn" : "Histórico — Sucesso do Cliente"}
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
