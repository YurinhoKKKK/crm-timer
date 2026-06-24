"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import Avatar from "@/components/Avatar";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";
import {
  updateProfileName,
  saveAvatarPath,
  removeAvatar,
} from "./actions";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  consultor: "Consultor",
  colaborador: "Colaborador",
  pending: "Pendente",
};

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export default function ProfileForm({
  userId,
  initialName,
  email,
  role,
  initialAvatarPath,
  initialAvatarUrl,
}: {
  userId: string;
  initialName: string;
  email: string;
  role: string;
  initialAvatarPath: string | null;
  initialAvatarUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initialName);
  const [nameStatus, setNameStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [nameError, setNameError] = useState<string | null>(null);

  const [avatarPath, setAvatarPath] = useState(initialAvatarPath);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameStatus("saving");
    setNameError(null);
    const { error } = await updateProfileName(name);
    if (error) {
      setNameStatus("error");
      setNameError(error);
      return;
    }
    setNameStatus("saved");
    startTransition(() => router.refresh());
    window.setTimeout(() => setNameStatus("idle"), 1500);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reenviar o mesmo arquivo depois
    if (!file) return;

    setAvatarError(null);
    if (!file.type.startsWith("image/")) {
      setAvatarError("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setAvatarError("A imagem deve ter no máximo 2 MB.");
      return;
    }

    setAvatarBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const newPath = `${userId}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(newPath, file, { cacheControl: "3600", upsert: true });
      if (uploadError) {
        setAvatarError(uploadError.message);
        return;
      }

      const { error: saveError } = await saveAvatarPath(newPath, avatarPath);
      if (saveError) {
        setAvatarError(saveError);
        return;
      }

      const { data } = supabase.storage.from("avatars").getPublicUrl(newPath);
      setAvatarPath(newPath);
      setAvatarUrl(data.publicUrl);
      startTransition(() => router.refresh());
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemove() {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const { error } = await removeAvatar(avatarPath);
      if (error) {
        setAvatarError(error);
        return;
      }
      setAvatarPath(null);
      setAvatarUrl(null);
      startTransition(() => router.refresh());
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Foto */}
      <section>
        <h2 className="mb-4 font-semibold text-fg">Foto de perfil</h2>
        <div className="flex items-center gap-5">
          <Avatar name={name} url={avatarUrl} size={72} />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={avatarBusy}
                className={btnSecondary}
              >
                {avatarBusy ? "Enviando…" : avatarUrl ? "Trocar foto" : "Adicionar foto"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={avatarBusy}
                  className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-red-300"
                >
                  Remover
                </button>
              )}
            </div>
            <p className="text-xs text-fg-subtle">PNG ou JPG, até 2 MB.</p>
            {avatarError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {avatarError}
              </p>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
        </div>
      </section>

      {/* Dados */}
      <form onSubmit={handleNameSubmit} className="space-y-4">
        <div>
          <label htmlFor="pf-name" className={labelClass}>
            Nome
          </label>
          <input
            id="pf-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pf-email" className={labelClass}>
              E-mail
            </label>
            <input
              id="pf-email"
              type="email"
              value={email}
              readOnly
              disabled
              className={`${inputClass} cursor-not-allowed opacity-70`}
            />
          </div>
          <div>
            <label htmlFor="pf-role" className={labelClass}>
              Cargo
            </label>
            <input
              id="pf-role"
              type="text"
              value={ROLE_LABEL[role] ?? role}
              readOnly
              disabled
              className={`${inputClass} cursor-not-allowed opacity-70`}
            />
          </div>
        </div>
        <p className="text-xs text-fg-subtle">
          E-mail e cargo são somente leitura. O cargo só pode ser alterado por um
          administrador.
        </p>

        {nameStatus === "error" && nameError && (
          <p className="text-sm text-red-600 dark:text-red-400">{nameError}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={nameStatus === "saving" || name.trim() === initialName.trim()}
            className={btnPrimary}
          >
            {nameStatus === "saving" ? "Salvando…" : "Salvar alterações"}
          </button>
          <span className="text-xs" aria-live="polite">
            {nameStatus === "saved" && <span className="text-risd">Salvo</span>}
          </span>
        </div>
      </form>
    </div>
  );
}
