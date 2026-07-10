"use client";

import { useState } from "react";
import type { ListingMarketplace } from "@/lib/types";
import { MARKETPLACES } from "@/lib/listing";
import {
  inputClass,
  labelClass,
  hintClass,
  chipClass,
  btnSecondary,
} from "@/lib/ui";

// Estado do subformulário da "Listagem de marcas" (passo 22). O sistema apenas
// ARMAZENA estes dados — o cálculo de margem é feito por fora pelo colaborador.
export type ListingFormValue = {
  brands: string[];
  marketplaces: Set<ListingMarketplace>;
  needsMargin: boolean;
  taxRate: string; // percentual como texto (ex.: "12" ou "12.5")
};

export function emptyListingForm(): ListingFormValue {
  return {
    brands: [],
    marketplaces: new Set(),
    needsMargin: false,
    taxRate: "",
  };
}

export default function ListingFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: ListingFormValue;
  onChange: (patch: Partial<ListingFormValue>) => void;
}) {
  const [draft, setDraft] = useState("");

  function addBrand() {
    const name = draft.trim();
    if (!name) return;
    // Evita duplicatas (comparação sem diferenciar maiúsculas/minúsculas).
    const exists = value.brands.some(
      (b) => b.toLowerCase() === name.toLowerCase()
    );
    if (!exists) onChange({ brands: [...value.brands, name] });
    setDraft("");
  }

  function removeBrand(index: number) {
    onChange({ brands: value.brands.filter((_, i) => i !== index) });
  }

  function toggleMarketplace(mk: ListingMarketplace) {
    const next = new Set(value.marketplaces);
    if (next.has(mk)) next.delete(mk);
    else next.add(mk);
    onChange({ marketplaces: next });
  }

  return (
    <div className="space-y-5 rounded-xl border border-line bg-surface-2 p-4">
      {/* Marcas */}
      <div>
        <label htmlFor={`${idPrefix}-brand`} className={labelClass}>
          Marcas
        </label>
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-brand`}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Não submete o formulário inteiro ao adicionar uma marca.
                e.preventDefault();
                addBrand();
              }
            }}
            placeholder="Digite uma marca e pressione Enter"
            className={inputClass}
          />
          <button type="button" onClick={addBrand} className={btnSecondary}>
            Adicionar
          </button>
        </div>
        {value.brands.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {value.brands.map((brand, i) => (
              <li
                key={`${brand}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm text-fg"
              >
                <span>{brand}</span>
                <button
                  type="button"
                  onClick={() => removeBrand(i)}
                  aria-label={`Remover ${brand}`}
                  className="text-fg-subtle hover:text-fg"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 ${hintClass}`}>Nenhuma marca adicionada ainda.</p>
        )}
      </div>

      {/* Marketplaces */}
      <fieldset>
        <legend className={labelClass}>Marketplaces</legend>
        <div className="flex flex-wrap gap-2">
          {MARKETPLACES.map((mk) => {
            const checked = value.marketplaces.has(mk.value);
            return (
              <label key={mk.value} className={chipClass(checked)}>
                <input
                  type="checkbox"
                  className="accent-risd"
                  checked={checked}
                  onChange={() => toggleMarketplace(mk.value)}
                />
                {mk.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Cálculo de margem */}
      <fieldset>
        <legend className={labelClass}>Cálculo de margem</legend>
        <div className="flex gap-2">
          {[
            { on: true, label: "Sim" },
            { on: false, label: "Não" },
          ].map((opt) => {
            const active = value.needsMargin === opt.on;
            return (
              <label key={opt.label} className={chipClass(active)}>
                <input
                  type="radio"
                  name={`${idPrefix}-margin`}
                  className="accent-risd"
                  checked={active}
                  onChange={() => onChange({ needsMargin: opt.on })}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {value.needsMargin && (
        <div className="sm:max-w-[50%]">
          <label htmlFor={`${idPrefix}-tax`} className={labelClass}>
            Alíquota de imposto do cliente (%)
          </label>
          <input
            id={`${idPrefix}-tax`}
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={value.taxRate}
            onChange={(e) => onChange({ taxRate: e.target.value })}
            placeholder="Ex.: 12"
            className={inputClass}
          />
          <p className={`mt-1 ${hintClass}`}>
            Apenas registrado — o sistema não calcula a margem.
          </p>
        </div>
      )}
    </div>
  );
}
