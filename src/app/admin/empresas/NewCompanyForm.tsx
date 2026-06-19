"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompany } from "../actions";

type ConsultantOption = { id: string; full_name: string; email: string };

const inputClass =
  "w-full rounded-lg border border-platinum bg-white px-3 py-2 text-sm text-gunmetal shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2";

export default function NewCompanyForm({
  consultores,
}: {
  consultores: ConsultantOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contactId, setContactId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName("");
    setContactId("");
    setGroupName("");
    setSelected(new Set());
    setError(null);
  }

  function toggleConsultant(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const { error: actionError } = await createCompany({
      name,
      whatsappContactId: contactId,
      whatsappGroupName: groupName,
      consultantIds: Array.from(selected),
    });

    if (actionError) {
      setError(actionError);
      return;
    }

    reset();
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-risd px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
        >
          Nova empresa
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 space-y-4 rounded-xl border border-platinum bg-white p-5 shadow-sm"
    >
      <h2 className="font-medium text-gunmetal">Nova empresa</h2>

      <div>
        <label
          htmlFor="company-name"
          className="mb-1 block text-sm font-medium text-gunmetal"
        >
          Nome da empresa
        </label>
        <input
          id="company-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="group-name"
            className="mb-1 block text-sm font-medium text-gunmetal"
          >
            Nome do grupo WhatsApp{" "}
            <span className="font-normal text-gunmetal/40">(opcional)</span>
          </label>
          <input
            id="group-name"
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="contact-id"
            className="mb-1 block text-sm font-medium text-gunmetal"
          >
            contactId da Digisac{" "}
            <span className="font-normal text-gunmetal/40">(opcional)</span>
          </label>
          <input
            id="contact-id"
            type="text"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-xs text-gunmetal/40">
        O dropdown automático com os grupos da Digisac chega no próximo passo;
        por enquanto preencha à mão se já tiver os dados.
      </p>

      {consultores.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gunmetal">
            Consultores responsáveis
          </legend>
          <div className="flex flex-wrap gap-2">
            {consultores.map((c) => {
              const checked = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                    checked
                      ? "border-risd bg-brand-soft text-gunmetal"
                      : "border-platinum bg-white text-gunmetal/70 hover:border-risd/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-risd"
                    checked={checked}
                    onChange={() => toggleConsultant(c.id)}
                  />
                  {c.full_name || c.email}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-risd px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Salvando…" : "Salvar empresa"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-lg border border-platinum bg-white px-4 py-2 text-sm text-gunmetal/70 transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
