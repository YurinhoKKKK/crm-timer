"use client";

// Seletor de cor estilizado (sem o input nativo do navegador). Oferece uma
// paleta de presets bonitos + um campo hex para cor personalizada. Tema
// claro/escuro herdado dos tokens da marca.

export const BG_PRESETS = [
  "#4A2882", // Ema (roxo)
  "#3145FF", // risd
  "#001AD8", // chrysler
  "#2B333B", // gunmetal
  "#0F766E", // teal
  "#047857", // emerald
  "#B45309", // amber
  "#B91C1C", // red
  "#BE185D", // pink
  "#6D28D9", // violet
  "#0E7490", // cyan
  "#4D7C0F", // lime
];

export const TEXT_PRESETS = ["#FFFFFF", "#F5F5F4", "#2B333B", "#111827"];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default function ColorPicker({
  value,
  onChange,
  presets = BG_PRESETS,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  presets?: string[];
  label?: string;
}) {
  const upper = value.toUpperCase();
  const isPreset = presets.some((c) => c.toUpperCase() === upper);
  const validHex = HEX_RE.test(value);

  return (
    <div>
      {label && (
        <p className="mb-1.5 text-xs font-medium text-fg-muted">{label}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((c) => {
          const active = c.toUpperCase() === upper;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c.toUpperCase())}
              aria-label={`Cor ${c}`}
              aria-pressed={active}
              className={`h-7 w-7 rounded-full border transition ${
                active
                  ? "border-transparent ring-2 ring-risd ring-offset-2 ring-offset-surface"
                  : "border-line hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
            />
          );
        })}

        {/* Cor personalizada (hex) */}
        <label
          className={`flex items-center gap-1.5 rounded-full border px-2 py-1 transition ${
            !isPreset && validHex
              ? "border-risd ring-2 ring-risd ring-offset-2 ring-offset-surface"
              : "border-line hover:border-risd/50"
          }`}
          title="Cor personalizada (hex)"
        >
          <span
            className="h-4 w-4 shrink-0 rounded-full border border-line"
            style={{ backgroundColor: validHex ? value : "transparent" }}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => {
              let v = e.target.value.toUpperCase();
              if (v && !v.startsWith("#")) v = `#${v}`;
              onChange(v);
            }}
            placeholder="#RRGGBB"
            maxLength={7}
            className="w-[68px] bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>
      </div>
    </div>
  );
}
