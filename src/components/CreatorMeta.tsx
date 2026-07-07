// Linha de transparência "criada/cadastrada por [nome] em [data]", visível a
// todos os cargos. Também sinaliza origem: tarefa padrão ou geração automática
// pela recorrência. Presentacional (sem estado) — pode rodar no servidor.

function formatWhen(iso: string | null, dateOnly: boolean): string {
  if (!iso) return "data não registrada";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "data não registrada";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  });
}

const clockIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="mt-0.5 shrink-0"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export default function CreatorMeta({
  label,
  who,
  whenISO,
  dateOnly = false,
  fromStandard = false,
  systemGenerated = false,
  hasOrigin = true,
  systemLabel = "Gerada automaticamente pelo sistema",
  className = "",
}: {
  label: string; // "Criada por" | "Cadastrada por"
  who: string | null;
  whenISO: string | null;
  dateOnly?: boolean;
  fromStandard?: boolean;
  systemGenerated?: boolean;
  hasOrigin?: boolean;
  systemLabel?: string;
  className?: string;
}) {
  const when = formatWhen(whenISO, dateOnly);

  return (
    <div className={`flex items-start gap-1.5 text-xs text-fg-subtle ${className}`}>
      {clockIcon}
      <div className="min-w-0">
        {hasOrigin ? (
          <p>
            {label}{" "}
            <span className="font-medium text-fg-muted">
              {who ?? "usuário não identificado"}
            </span>
            {fromStandard && (
              <span className="text-fg-subtle"> (a partir de tarefa padrão)</span>
            )}{" "}
            em <span className="text-fg-muted">{when}</span>
          </p>
        ) : (
          <p>
            {systemLabel} em <span className="text-fg-muted">{when}</span>
          </p>
        )}
        {hasOrigin && systemGenerated && (
          <p className="text-fg-subtle">
            Esta ocorrência foi gerada automaticamente pela recorrência.
          </p>
        )}
      </div>
    </div>
  );
}
