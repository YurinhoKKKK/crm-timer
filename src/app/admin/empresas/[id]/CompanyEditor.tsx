"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Company } from "@/lib/types";
import { updateCompany } from "../../actions";

const inputClass =
  "w-full rounded-lg border border-platinum bg-white px-3 py-2 text-sm text-gunmetal shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2";

const labelClass = "mb-1 block text-sm font-medium text-gunmetal";

type Status = "idle" | "saving" | "saved" | "error";

export default function CompanyEditor({ company }: { company: Company }) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [groupName, setGroupName] = useState(company.whatsapp_group_name ?? "");
  const [contactId, setContactId] = useState(company.whatsapp_contact_id ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg(null);

    const { error } = await updateCompany(company.id, {
      name,
      whatsappContactId: contactId,
      whatsappGroupName: groupName,
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }

    setStatus("saved");
    startTransition(() => router.refresh());
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="edit-name" className={labelClass}>
          Nome da empresa
        </label>
        <input
          id="edit-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-group" className={labelClass}>
            Nome do grupo WhatsApp{" "}
            <span className="font-normal text-gunmetal/40">(opcional)</span>
          </label>
          <input
            id="edit-group"
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="edit-contact" className={labelClass}>
            contactId da Digisac{" "}
            <span className="font-normal text-gunmetal/40">(opcional)</span>
          </label>
          <input
            id="edit-contact"
            type="text"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {status === "error" && errorMsg && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-lg bg-risd px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "saving" ? "Salvando…" : "Salvar alterações"}
        </button>
        <span className="text-xs" aria-live="polite">
          {status === "saved" && <span className="text-risd">Salvo</span>}
        </span>
      </div>
    </form>
  );
}
