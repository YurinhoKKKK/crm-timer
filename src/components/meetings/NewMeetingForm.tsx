"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MeetingForm from "./MeetingForm";
import ResultBanner from "./ResultBanner";
import type { DirectoryUser, ReachableCompany } from "@/lib/meetings";
import { btnPrimary } from "@/lib/ui";

// "Nova reunião": botão que abre o formulário de criação (MeetingForm em modo
// create) e mostra o banner de resultado (sucesso ou aviso de sincronização).
// A empresa vem travada dentro da central; livre (seletor) na /agenda.
export default function NewMeetingForm({
  directory,
  companies,
  lockedCompany,
}: {
  directory: DirectoryUser[];
  companies?: ReachableCompany[];
  lockedCompany?: ReachableCompany;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ warning: string | null } | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="mb-6">
      {result && (
        <ResultBanner
          warning={result.warning}
          successText="Reunião criada e adicionada à sua agenda do Google."
          onClose={() => setResult(null)}
        />
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
          className={btnPrimary}
        >
          Nova reunião
        </button>
      ) : (
        <MeetingForm
          mode="create"
          directory={directory}
          companies={companies}
          lockedCompany={lockedCompany}
          onDone={(warning) => {
            setResult({ warning });
            setOpen(false);
            startTransition(() => router.refresh());
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}
