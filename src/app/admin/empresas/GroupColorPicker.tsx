"use client";

import { GROUP_COLOR_PRESETS, normalizeGroupColor } from "@/lib/company-groups";

// Seletor de cor do grupo: PRESETS da paleta Monvatti em amostras clicáveis + um
// seletor LIVRE (<input type="color">), com a amostra atual sempre visível. Não
// há cálculo de contraste porque a cor só tinge barra/bolinha/cabeçalho em baixa
// opacidade (ver colorTints); qualquer hex é seguro.
export default function GroupColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const current = normalizeGroupColor(value);
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-fg">Cor</span>
      <div className="flex flex-wrap items-center gap-2">
        {GROUP_COLOR_PRESETS.map((preset) => {
          const active = preset.value.toUpperCase() === current;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() => onChange(preset.value)}
              title={preset.name}
              aria-label={`Cor ${preset.name}`}
              aria-pressed={active}
              className={`h-7 w-7 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                active
                  ? "border-fg ring-2 ring-fg ring-offset-2 ring-offset-canvas"
                  : "border-line hover:scale-110"
              }`}
              style={{ backgroundColor: preset.value }}
            />
          );
        })}

        {/* Seletor livre: qualquer hex. A amostra atual é o próprio quadrado. */}
        <label
          className="ml-1 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted transition hover:border-risd/50"
          title="Escolher uma cor personalizada"
        >
          <span
            className="h-5 w-5 rounded-full border border-line"
            style={{ backgroundColor: current }}
            aria-hidden="true"
          />
          <span>Personalizar</span>
          <input
            type="color"
            value={current}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Cor personalizada"
            className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
      </div>
    </div>
  );
}
