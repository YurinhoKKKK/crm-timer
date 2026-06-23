"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type Period = "hoje" | "7d" | "30d" | "tudo";

const OPTIONS: { value: Period; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "tudo", label: "Tudo" },
];

export default function PeriodFilter({ value }: { value: Period }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(next: Period) {
    const sp = new URLSearchParams(params.toString());
    sp.set("periodo", next);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div
      role="group"
      aria-label="Período"
      className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card"
    >
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => select(o.value)}
            aria-pressed={active}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
              active
                ? "bg-risd text-white shadow-sm"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
