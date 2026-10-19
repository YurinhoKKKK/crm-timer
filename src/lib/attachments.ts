// Tipos de anexo aceitos nos editores de texto rico (Atualizações da empresa,
// notas de Tráfego/Site, notas de CS, chamados de Suporte e respostas). FONTE
// ÚNICA, compartilhada pelo upload (NoteEditor) e pela exibição (AttachmentList).
//
// Imagens são tratadas à parte no editor (vão inline, limite próprio); aqui ficam
// os ANEXOS: documentos, áudios e arquivos comprimidos.

export type AttachmentKind = "doc" | "audio" | "archive";

// Documentos: comportamento anterior (limite 20 MB). Áudio e comprimidos: 25 MB.
export const DOC_EXTS = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"];
export const AUDIO_EXTS = ["mp3", "m4a", "ogg", "opus", "wav", "aac", "webm"];
export const ARCHIVE_EXTS = ["zip", "rar", "7z"];

export const MAX_DOC_MB = 20;
export const MAX_MEDIA_MB = 25; // áudio e comprimidos

const KIND_BY_EXT = new Map<string, AttachmentKind>([
  ...DOC_EXTS.map((e) => [e, "doc"] as const),
  ...AUDIO_EXTS.map((e) => [e, "audio"] as const),
  ...ARCHIVE_EXTS.map((e) => [e, "archive"] as const),
]);

export function extOf(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

// `accept` do <input type=file>: todas as extensões + a família de áudio por
// MIME (o seletor nativo é só uma conveniência; a validação real é no upload).
export const ATTACHMENT_ACCEPT = [
  ...DOC_EXTS,
  ...AUDIO_EXTS,
  ...ARCHIVE_EXTS,
].map((e) => `.${e}`).concat("audio/*").join(",");

// Classifica um anexo pela EXTENSÃO (autoritativa). Fallback: um arquivo de
// áudio cuja extensão não reconhecemos ainda cai em "audio" pelo MIME.
export function attachmentKind(name: string, mime = ""): AttachmentKind | null {
  const k = KIND_BY_EXT.get(extOf(name));
  if (k) return k;
  if (mime.toLowerCase().startsWith("audio/")) return "audio";
  return null;
}

export function isAudioAttachment(name: string, mime = ""): boolean {
  return attachmentKind(name, mime) === "audio";
}

// Alguns navegadores mandam .opus/.rar/.7z (e às vezes CSV/zip) com MIME genérico
// ou vazio — não dá para confiar só no MIME. A extensão é o filtro; o MIME só
// REJEITA quando é específico e de outra família (ex.: um .mp3 que chega como
// image/png — arquivo renomeado).
const GENERIC_MIMES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/download",
]);

function mimeMatchesKind(kind: AttachmentKind, mime: string): boolean {
  if (GENERIC_MIMES.has(mime)) return true;
  switch (kind) {
    case "audio":
      return mime.startsWith("audio/");
    case "archive":
      return [
        "application/zip",
        "application/x-zip-compressed",
        "application/x-zip",
        "application/vnd.rar",
        "application/x-rar-compressed",
        "application/x-rar",
        "application/x-7z-compressed",
      ].includes(mime);
    case "doc":
      // Documentos sempre foram validados só por extensão; mantemos tolerante
      // (qualquer text/* ou application/*), rejeitando só famílias claramente
      // alheias (image/*, video/*…).
      return mime.startsWith("text/") || mime.startsWith("application/");
  }
}

export type AttachmentCheck =
  | { ok: true; kind: AttachmentKind }
  | { ok: false; message: string };

// Valida um arquivo escolhido para anexo: tipo (extensão + MIME tolerante) e
// tamanho (25 MB áudio/comprimido; 20 MB documento). Mensagens prontas p/ a UI.
export function checkAttachment(file: {
  name: string;
  type: string;
  size: number;
}): AttachmentCheck {
  const kind = attachmentKind(file.name, file.type);
  if (!kind) {
    return {
      ok: false,
      message:
        "Formato não suportado. Aceitos: documentos, áudio e arquivos .zip/.rar/.7z.",
    };
  }
  const mime = (file.type || "").toLowerCase();
  if (!mimeMatchesKind(kind, mime)) {
    return {
      ok: false,
      message:
        "Formato não suportado. Aceitos: documentos, áudio e arquivos .zip/.rar/.7z.",
    };
  }
  const maxMb = kind === "doc" ? MAX_DOC_MB : MAX_MEDIA_MB;
  if (file.size > maxMb * 1024 * 1024) {
    return {
      ok: false,
      message:
        kind === "doc"
          ? `O documento deve ter no máximo ${MAX_DOC_MB} MB.`
          : "Arquivo acima de 25 MB.",
    };
  }
  return { ok: true, kind };
}
