"use client";

import { useCallback } from "react";
import HistoryPanel from "@/components/history-panel/HistoryPanel";
import {
  DEV_AUDIT_PAGE,
  DEV_OPTIONS_BY_FIELD,
  optionLabel,
} from "@/lib/dev-options";
import { fetchDevAudit, type DevAuditEntry } from "./actions";

// Valor exibível de um campo: status → rótulo do enum; grupo → já é o NOME do grupo.
function fmt(field: string, v: string | null): string {
  const options = DEV_OPTIONS_BY_FIELD[field];
  if (options) return optionLabel(options, v);
  return v ?? "";
}

// Monta a frase de cada registro. changed_by nulo → "Sistema".
function describe(e: DevAuditEntry): string {
  const by = e.changedByName ?? "Sistema";

  // Pausa manual do prazo: o new_value já vem como frase ("Pausado: {motivo}" ou
  // "Retomado"). "Sistema" aparece quando a pausa foi desligada ao sair de Em
  // Desenvolvimento.
  if (e.field === "pausa_manual") {
    if (e.newValue && e.newValue.startsWith("Pausado:")) {
      const motivo = e.newValue.slice("Pausado:".length).trim();
      return motivo
        ? `${by} pausou o prazo — ${motivo}`
        : `${by} pausou o prazo`;
    }
    return `${by} retomou o prazo`;
  }

  // Grupo: old/new são NOMES de grupo. "Fulano moveu de X para Y".
  if (e.field === "grupo") {
    if (e.oldValue != null && e.newValue != null) {
      return `${by} moveu de ${e.oldValue} para ${e.newValue}`;
    }
    if (e.oldValue == null && e.newValue != null) {
      return `${by} moveu para ${e.newValue}`;
    }
    if (e.oldValue != null && e.newValue == null) {
      return `${by} removeu do grupo ${e.oldValue}`;
    }
    return `${by} alterou o grupo`;
  }

  // Status: "Fulano alterou o status de X para Y".
  if (e.oldValue != null && e.newValue != null) {
    return `${by} alterou o status de ${fmt(e.field, e.oldValue)} para ${fmt(
      e.field,
      e.newValue
    )}`;
  }
  if (e.oldValue == null && e.newValue != null) {
    return `${by} definiu o status como ${fmt(e.field, e.newValue)}`;
  }
  if (e.oldValue != null && e.newValue == null) {
    return `${by} limpou o status (era ${fmt(e.field, e.oldValue)})`;
  }
  return `${by} atualizou o status`;
}

export default function DevHistoryPanel({
  companyId,
  companyName,
  onClose,
}: {
  companyId: string;
  companyName: string;
  onClose: () => void;
}) {
  const load = useCallback(
    (offset: number) => fetchDevAudit(companyId, offset),
    [companyId]
  );

  return (
    <HistoryPanel<DevAuditEntry>
      eyebrow="Histórico — Desenvolvimento"
      companyName={companyName}
      onClose={onClose}
      load={load}
      describe={describe}
      getKey={(e) => e.id}
      getWhenISO={(e) => e.changedAtISO}
      pageSize={DEV_AUDIT_PAGE}
    />
  );
}
