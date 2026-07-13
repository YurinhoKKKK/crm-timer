import { initialsOf } from "@/lib/avatar";

// Avatar reutilizável: mostra a foto quando há `url`, senão um círculo com as
// iniciais. `variant` ajusta as cores para fundo claro (default) ou escuro
// (sidebar). `size` é o lado em px.
export default function Avatar({
  name,
  url,
  size = 36,
  variant = "default",
}: {
  name: string;
  url?: string | null;
  size?: number;
  variant?: "default" | "onDark";
}) {
  const dimension = { width: size, height: size };

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        style={dimension}
        className="shrink-0 rounded-full object-cover ring-1 ring-inset ring-black/5"
      />
    );
  }

  const base =
    variant === "onDark"
      ? "bg-white/15 text-white ring-white/20"
      : "bg-brand-tint text-risd ring-risd/20";

  // Iniciais proporcionais nos tamanhos pequenos das listas densas.
  const textSize = size <= 24 ? "text-[9px]" : "text-xs";

  return (
    <span
      style={dimension}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset ${textSize} ${base}`}
    >
      {initialsOf(name)}
    </span>
  );
}
