"use client";

import { useCallback } from "react";
import HistoryPanel from "@/components/history-panel/HistoryPanel";
import {
  TRAFFIC_AUDIT_PAGE,
  TRAFFIC_OPTIONS_BY_FIELD,
  optionLabel,
} from "@/lib/traffic-options";
import { fetchTrafficAudit, type TrafficAuditEntry } from "./actions";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function money(v: string | null): string {
  if (v == null) return "";
  const n = Number(v);
  return Number.isFinite(n) ? BRL.format(n) : v;
}

// Nome amigável da coluna (para as frases "alterou o Foco…", "o Orçamento…").
function nounOf(field: string): string {
  switch (field) {
    case "foco":
      return "o Foco";
    case "plataforma":
      return "a Plataforma";
    case "status":
      return "o Status";
    case "orcamento":
      return "o Orçamento";
    default:
      return "o campo";
  }
}

// Valor exibível de um campo: enum → rótulo; orçamento → BRL.
function fmt(field: string, v: string | null): string {
  if (field === "orcamento") return money(v);
  const options = TRAFFIC_OPTIONS_BY_FIELD[field];
  if (options) return optionLabel(options, v);
  return v ?? "";
}

// Monta a frase de cada registro. changed_by nulo → "Sistema".
function describe(e: TrafficAuditEntry): string {
  const by = e.changedByName ?? "Sistema";

  // Grupo manual tem frases próprias (mover / descartar).
  if (e.field === "grupo_manual") {
    // Descarte automático pelo sistema (empresa passou a acompanhar Empresas).
    if (e.changedByName == null && e.newValue == null) {
      return "Sistema descartou o grupo manual (empresa passou a acompanhar Empresas)";
    }
    if (e.oldValue != null && e.newValue != null) {
      return `${by} moveu de ${e.oldValue} para ${e.newValue}`;
    }
    if (e.oldValue == null && e.newValue != null) {
      return `${by} moveu para ${e.newValue}`;
    }
    if (e.oldValue != null && e.newValue == null) {
      return `${by} descartou o grupo manual (era ${e.oldValue})`;
    }
    return `${by} alterou o grupo manual`;
  }

  const noun = nounOf(e.field);
  if (e.oldValue == null && e.newValue != null) {
    return `${by} definiu ${noun} como ${fmt(e.field, e.newValue)}`;
  }
  if (e.oldValue != null && e.newValue == null) {
    return `${by} limpou ${noun} (era ${fmt(e.field, e.oldValue)})`;
  }
  if (e.oldValue != null && e.newValue != null) {
    return `${by} alterou ${noun} de ${fmt(e.field, e.oldValue)} para ${fmt(
      e.field,
      e.newValue
    )}`;
  }
  return `${by} atualizou ${noun}`;
}

export default function TrafficHistoryPanel({
  companyId,
  companyName,
  onClose,
}: {
  companyId: string;
  companyName: string;
  onClose: () => void;
}) {
  const load = useCallback(
    (offset: number) => fetchTrafficAudit(companyId, offset),
    [companyId]
  );

  return (
    <HistoryPanel<TrafficAuditEntry>
      eyebrow="Histórico — Tráfego"
      companyName={companyName}
      onClose={onClose}
      load={load}
      describe={describe}
      getKey={(e) => e.id}
      getWhenISO={(e) => e.changedAtISO}
      pageSize={TRAFFIC_AUDIT_PAGE}
    />
  );
}
