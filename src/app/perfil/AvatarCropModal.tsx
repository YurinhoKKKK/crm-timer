"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import { croppedImageBlob, croppedImageDataUrl } from "@/lib/image-crop";

// Modal "Ajustar foto" (estilo rede social): recorte circular 1:1, arrastar
// (mouse e toque), zoom (slider 1x–3x, roda e pinça), girar 90° e prévia no
// tamanho do menu lateral (36px). O arquivo final (512×512 JPEG, fundo branco)
// é gerado no canvas e devolvido via onSave — o original nunca sobe.
export default function AvatarCropModal({
  imageSrc,
  onCancel,
  onSave,
}: {
  imageSrc: string;
  onCancel: () => void;
  onSave: (blob: Blob) => Promise<void> | void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, px: Area) => setAreaPixels(px), []);

  // Prévia ao vivo no tamanho do menu lateral (36px; render 2x p/ nitidez).
  useEffect(() => {
    if (!areaPixels) return;
    let active = true;
    croppedImageDataUrl(imageSrc, areaPixels, rotation, { outSize: 72 })
      .then((url) => {
        if (active) setPreview(url);
      })
      .catch(() => {
        /* a prévia é best-effort; o Salvar revalida */
      });
    return () => {
      active = false;
    };
  }, [areaPixels, rotation, imageSrc]);

  // Esc cancela (enquanto não está salvando).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  async function handleSave() {
    if (!areaPixels) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await croppedImageBlob(imageSrc, areaPixels, rotation, { outSize: 512 });
      if (!blob) {
        setError("Não foi possível gerar a imagem. Tente outra.");
        setSaving(false);
        return;
      }
      await onSave(blob); // o pai fecha o modal ao concluir
    } catch {
      setError("Não foi possível gerar a imagem. Tente outra.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-sheet flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        aria-hidden="true"
        onClick={() => !saving && onCancel()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ajustar foto"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      >
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">Ajustar foto</h2>
        </div>

        <div className="space-y-4 p-5">
          {/* Área de recorte (máscara circular, 1:1) */}
          <div className="relative h-64 w-full overflow-hidden rounded-xl bg-black">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              cropShape="round"
              showGrid={false}
              minZoom={1}
              maxZoom={3}
              zoomSpeed={0.2}
              restrictPosition
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={onCropComplete}
            />
          </div>

          {/* Controles: zoom + girar */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-subtle">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="h-1.5 flex-1 cursor-pointer accent-risd"
            />
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 2v6h-6" />
                <path d="M21 13a9 9 0 1 1-3-7.7L21 8" />
              </svg>
              Girar 90°
            </button>
          </div>

          {/* Prévia no tamanho do menu lateral */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-subtle">Prévia no menu lateral</span>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Prévia da foto"
                width={36}
                height={36}
                className="h-9 w-9 rounded-full object-cover ring-1 ring-inset ring-black/5"
              />
            ) : (
              <span className="h-9 w-9 animate-pulse rounded-full bg-surface-2" aria-hidden="true" />
            )}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onCancel} disabled={saving} className={btnSecondary}>
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !areaPixels} className={btnPrimary}>
            {saving ? "Salvando…" : "Salvar foto"}
          </button>
        </div>
      </div>
    </div>
  );
}
