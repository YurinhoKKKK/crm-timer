import { FileArchive, FileAudio, FileSpreadsheet, FileText } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { attachmentKind, extOf } from "@/lib/attachments";
import type { NoteAttachmentView } from "@/lib/notes";

// Exibição (leitura) dos anexos de uma anotação/resposta/chamado. FONTE ÚNICA:
// substitui as cópias que viviam em CompanyNotes, NotesPanel, ReplyThread e
// SupportView. Documentos e comprimidos abrem/baixam num cartão; ÁUDIO toca num
// player embutido (<audio controls>) no lugar do link.

function AttachmentIcon({ name }: { name: string }) {
  const ext = extOf(name);
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet size={15} className="shrink-0 text-fg-muted" />;
  }
  if (["zip", "rar", "7z"].includes(ext)) {
    return <FileArchive size={15} className="shrink-0 text-fg-muted" />;
  }
  return <FileText size={15} className="shrink-0 text-fg-muted" />;
}

const cardClass =
  "flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-fg transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";

// Um anexo de áudio: nome + tamanho e um player. O <a> interno é o fallback de
// download para navegadores que não tocam o formato.
function AudioAttachment({
  a,
  textClass,
}: {
  a: NoteAttachmentView;
  textClass: string;
}) {
  return (
    <div className="flex w-full max-w-[20rem] flex-col gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-2">
      <div className={`flex items-center gap-2 ${textClass} text-fg`}>
        <FileAudio size={15} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 truncate" title={a.name}>
          {a.name}
        </span>
        <span className="shrink-0 text-xs text-fg-subtle">{formatBytes(a.size)}</span>
      </div>
      <audio controls preload="metadata" src={a.url} className="w-full">
        <a href={a.url} target="_blank" rel="noopener noreferrer">
          Baixar {a.name}
        </a>
      </audio>
    </div>
  );
}

export default function AttachmentList({
  items,
  // Classe do <ul>. Padrão com margem superior (uso dentro das anotações); o
  // chamado de Suporte passa sem margem, pois o contêiner já espaça.
  className = "mt-3 flex flex-wrap gap-2",
  // Texto menor (painel lateral de notas).
  compact = false,
}: {
  items: NoteAttachmentView[];
  className?: string;
  compact?: boolean;
}) {
  if (items.length === 0) return null;
  const textClass = compact ? "text-xs" : "text-sm";
  return (
    <ul className={className}>
      {items.map((a) => (
        <li key={a.path} className="max-w-full">
          {attachmentKind(a.name, a.mime) === "audio" ? (
            <AudioAttachment a={a} textClass={textClass} />
          ) : (
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Abrir/baixar ${a.name}`}
              className={`${cardClass} ${textClass}`}
            >
              <AttachmentIcon name={a.name} />
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="shrink-0 text-xs text-fg-subtle">
                {formatBytes(a.size)}
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
