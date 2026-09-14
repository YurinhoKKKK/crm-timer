import { isNewClient, newClientTenure } from "@/lib/new-client";
import { todayBRT } from "@/lib/company-details";

// Chip DERIVADO "Cliente Novo" (ver [[new-client]]). Renderiza só quando a
// empresa é nova (started_on ≤ 90 dias); caso contrário devolve null, então pode
// ser colocado ao lado das etiquetas comuns sem condicional no chamador.
//
// Visual PROPOSITALMENTE distinto das etiquetas comuns (que são pílulas de cor
// cheia): borda tracejada + tom âmbar + faísca, sinalizando que é automático — não
// dá para editar nem existe no gerenciador de etiquetas. No hover, o tempo de casa.
//
// Puramente visual (sem estado): serve em Server e Client Components. `today` é
// injetável para testes; por padrão usa o dia civil de Brasília, determinístico
// (mesmo dia no servidor e na hidratação — sem mismatch).
export default function NewClientChip({
  startedOn,
  size = "sm",
  today,
}: {
  startedOn: string | null;
  size?: "sm" | "md";
  today?: string;
}) {
  const t = today ?? todayBRT();
  if (!isNewClient(startedOn, t)) return null;
  const tenure = newClientTenure(startedOn, t) ?? undefined;

  const pad =
    size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  const icon = size === "md" ? 13 : 11;

  return (
    <span
      title={tenure}
      className={`inline-flex items-center gap-1 rounded-full border border-dashed border-amber-400/80 bg-amber-50 font-semibold text-amber-700 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-300 ${pad}`}
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2l1.9 5.6L19.5 9l-4.6 1.6L12 16l-2.9-5.4L4.5 9l5.6-1.4L12 2z" />
      </svg>
      Cliente Novo
    </span>
  );
}
