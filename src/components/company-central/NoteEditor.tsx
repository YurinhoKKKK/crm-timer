"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  FileText,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paperclip,
  Redo2,
  SquareCode,
  Strikethrough,
  TextQuote,
  Table as TableIcon,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { btnPrimary, btnSecondary, inputClass } from "@/lib/ui";
import { formatBytes } from "@/lib/format";
import type { NoteAttachmentMeta } from "@/lib/notes";
import { ResizableImage } from "./resizable-image";

const MAX_IMAGE_MB = 5;
const MAX_DOC_MB = 20;

// Formatos de documento aceitos como anexo (além das imagens, que vão inline).
const DOC_EXTS = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"];
const DOC_ACCEPT = DOC_EXTS.map((e) => `.${e}`).join(",");

// Paletas discretas, coerentes com a marca (risd como primeiro acento).
const TEXT_COLORS = [
  { value: "#3145ff", label: "Azul Monvatti" },
  { value: "#1d4ed8", label: "Azul escuro" },
  { value: "#16a34a", label: "Verde" },
  { value: "#d97706", label: "Âmbar" },
  { value: "#dc2626", label: "Vermelho" },
  { value: "#7c3aed", label: "Roxo" },
  { value: "#db2777", label: "Rosa" },
  { value: "#6b7280", label: "Cinza" },
];

const HIGHLIGHT_COLORS = [
  { value: "#fef08a", label: "Amarelo" },
  { value: "#bbf7d0", label: "Verde" },
  { value: "#bfdbfe", label: "Azul" },
  { value: "#fbcfe8", label: "Rosa" },
  { value: "#fed7aa", label: "Laranja" },
  { value: "#e9d5ff", label: "Lilás" },
];

type MenuKey = "color" | "highlight" | "link" | "table";

// Botão da toolbar: ícone + tooltip + estados de hover/ativo. O onMouseDown
// com preventDefault mantém a seleção do editor ao clicar.
function TBtn({
  onClick,
  active = false,
  disabled = false,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
        active
          ? "bg-brand-tint text-risd"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-fg-muted" : ""}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden="true" />;
}

// Botão com painel suspenso (cores, destaque, link, tabela). Fecha ao clicar
// fora; o gatilho e o painel vivem no mesmo contêiner para o clique no próprio
// botão não "fechar e reabrir".
function TMenu({
  open,
  onOpenChange,
  active = false,
  label,
  icon,
  children,
  panelClass = "",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  active?: boolean;
  label: string;
  icon: ReactNode;
  children: ReactNode;
  panelClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <TBtn
        onClick={() => onOpenChange(!open)}
        active={active || open}
        label={label}
      >
        {icon}
      </TBtn>
      {open && (
        <div
          className={`absolute left-0 top-full z-20 mt-1 rounded-lg border border-line bg-surface p-2 shadow-pop ${panelClass}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm text-fg transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
    >
      {children}
    </button>
  );
}

// Editor rich text das anotações da empresa (passo 24), nível "Word/Notion":
// formatação, cores/destaque, alinhamento, listas (inclusive checklist),
// citação/código/linha, links por popover, tabelas e imagens — por botão,
// COLADAS (Ctrl+V) ou arrastadas, com upload automático ao Storage. O toggle
// "visível ao cliente" nasce DESMARCADO — toda anotação é interna por padrão.
export default function NoteEditor({
  userId,
  initialHTML = "",
  initialVisible = false,
  initialAttachments = [],
  saveLabel = "Salvar anotação",
  onSave,
  onCancel,
}: {
  userId: string;
  initialHTML?: string;
  initialVisible?: boolean;
  initialAttachments?: NoteAttachmentMeta[];
  saveLabel?: string;
  onSave: (
    html: string,
    visibleToClient: boolean,
    attachments: NoteAttachmentMeta[]
  ) => Promise<{ error?: string | null } | void>;
  onCancel: () => void;
}) {
  const [visible, setVisible] = useState(initialVisible);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Erro transitório (upload): só aparece quando ocorre e some sozinho.
  const [imgError, setImgError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuKey | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [attachments, setAttachments] =
    useState<NoteAttachmentMeta[]>(initialAttachments);
  const fileRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  // Arquivos subidos NESTA edição (ainda não salvos na anotação): se o usuário
  // remover o chip ou cancelar, dá para apagar do Storage sem quebrar nada.
  const newPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!imgError) return;
    const t = setTimeout(() => setImgError(null), 6000);
    return () => clearTimeout(t);
  }, [imgError]);

  // Sobe a imagem para o Storage e insere no documento (na seleção atual ou,
  // no arrastar-e-soltar, na posição do cursor de drop). Usada pelo botão,
  // pelo Ctrl+V e pelo drag-and-drop.
  async function uploadAndInsert(file: File, view: EditorView, pos?: number) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setImgError(`A imagem deve ter no máximo ${MAX_IMAGE_MB} MB.`);
      return;
    }
    setUploading((n) => n + 1);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      // Pasta do próprio usuário — exigido pela política do bucket.
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upError } = await supabase.storage
        .from("note-images")
        .upload(path, file, { contentType: file.type || undefined });
      if (upError) {
        setImgError(`Falha ao enviar a imagem: ${upError.message}`);
        return;
      }
      const { data } = supabase.storage.from("note-images").getPublicUrl(path);
      const node = view.state.schema.nodes.image.create({
        src: data.publicUrl,
      });
      const tr =
        pos != null
          ? view.state.tr.insert(pos, node)
          : view.state.tr.replaceSelectionWith(node);
      view.dispatch(tr);
    } finally {
      setUploading((n) => n - 1);
    }
  }

  // Anexa um documento: valida formato/tamanho, sobe no bucket note-files e
  // adiciona aos metadados da anotação (gravados no salvar).
  async function uploadAttachment(file: File) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!DOC_EXTS.includes(ext)) {
      setImgError(
        `Formato não suportado. Aceitos: ${DOC_EXTS.join(", ").toUpperCase()}.`
      );
      return;
    }
    if (file.size > MAX_DOC_MB * 1024 * 1024) {
      setImgError(`O documento deve ter no máximo ${MAX_DOC_MB} MB.`);
      return;
    }
    setUploading((n) => n + 1);
    try {
      const supabase = createClient();
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upError } = await supabase.storage
        .from("note-files")
        .upload(path, file, { contentType: file.type || undefined });
      if (upError) {
        setImgError(`Falha ao enviar o documento: ${upError.message}`);
        return;
      }
      newPathsRef.current.add(path);
      setAttachments((prev) => [
        ...prev,
        { path, name: file.name, size: file.size, mime: file.type || "" },
      ]);
    } finally {
      setUploading((n) => n - 1);
    }
  }

  function removeAttachment(path: string) {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
    // Subiu agora e ainda não foi salvo: pode apagar do Storage sem risco.
    if (newPathsRef.current.has(path)) {
      newPathsRef.current.delete(path);
      void createClient().storage.from("note-files").remove([path]);
    }
  }

  function handleCancel() {
    // Descarta os uploads desta edição (ficariam órfãos no Storage).
    const orphans = Array.from(newPathsRef.current);
    if (orphans.length > 0) {
      void createClient().storage.from("note-files").remove(orphans);
      newPathsRef.current.clear();
    }
    onCancel();
  }

  const editor = useEditor({
    // Evita mismatch de hidratação no App Router (TipTap v3 + SSR) e mantém a
    // toolbar refletindo a formatação sob o cursor.
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // Colar uma URL sobre um texto selecionado vira link automaticamente.
        linkOnPaste: true,
        defaultProtocol: "https",
      }),
      ResizableImage,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: "Escreva a anotação…" }),
    ],
    content: initialHTML,
    editorProps: {
      attributes: { class: "rich-text" },
      // Ctrl+V com imagem na área de transferência (ex.: print) → upload.
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(
          (f) => f.type.startsWith("image/")
        );
        if (files.length === 0) return false;
        event.preventDefault();
        for (const f of files) void uploadAndInsert(f, view);
        return true;
      },
      // Arrastar e soltar imagem no editor → upload na posição do drop.
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        for (const f of files) void uploadAndInsert(f, view, coords?.pos);
        return true;
      },
    },
  });

  function openLinkMenu() {
    if (!editor) return;
    if (menu === "link") {
      setMenu(null);
      return;
    }
    setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
    setMenu("link");
  }

  function applyLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setMenu(null);
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    const { empty } = editor.state.selection;
    if (empty && !editor.isActive("link")) {
      // Sem seleção: insere a própria URL já como link.
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "text", text: href, marks: [{ type: "link", attrs: { href } }] },
        ])
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setMenu(null);
  }

  async function handleSave() {
    if (!editor || busy) return;
    if (editor.isEmpty) {
      setSaveError("Escreva algo antes de salvar.");
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      const res = await onSave(editor.getHTML(), visible, attachments);
      if (res && "error" in res && res.error) {
        setSaveError(res.error);
      } else {
        // Salvou: os uploads desta edição agora pertencem à anotação.
        newPathsRef.current.clear();
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  const swatchClass =
    "h-6 w-6 rounded-full border border-line transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";
  const inTable = !!editor?.isActive("table");

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      {/* Toolbar: histórico | títulos | formatação | cor/destaque | alinhamento
          | listas | blocos | inserção. Sticky: acompanha o scroll da página
          (top compensa o header fixo do AppShell) para formatar textos longos. */}
      <div
        role="toolbar"
        aria-label="Formatação"
        className="sticky top-[60px] z-10 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-line bg-surface px-2 py-1.5"
      >
        <TBtn
          onClick={() => editor?.chain().focus().undo().run()}
          disabled={!editor?.can().undo()}
          label="Desfazer (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().redo().run()}
          disabled={!editor?.can().redo()}
          label="Refazer (Ctrl+Y)"
        >
          <Redo2 size={16} />
        </TBtn>

        <Divider />

        <TBtn
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          active={!!editor?.isActive("heading", { level: 1 })}
          label="Título 1"
        >
          <Heading1 size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          active={!!editor?.isActive("heading", { level: 2 })}
          label="Título 2"
        >
          <Heading2 size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          active={!!editor?.isActive("heading", { level: 3 })}
          label="Título 3"
        >
          <Heading3 size={16} />
        </TBtn>

        <Divider />

        <TBtn
          onClick={() => editor?.chain().focus().toggleBold().run()}
          active={!!editor?.isActive("bold")}
          label="Negrito (Ctrl+B)"
        >
          <Bold size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          active={!!editor?.isActive("italic")}
          label="Itálico (Ctrl+I)"
        >
          <Italic size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          active={!!editor?.isActive("underline")}
          label="Sublinhado (Ctrl+U)"
        >
          <Underline size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          active={!!editor?.isActive("strike")}
          label="Tachado"
        >
          <Strikethrough size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleCode().run()}
          active={!!editor?.isActive("code")}
          label="Código inline"
        >
          <Code size={16} />
        </TBtn>

        <TMenu
          open={menu === "color"}
          onOpenChange={(v) => setMenu(v ? "color" : null)}
          active={!!editor?.getAttributes("textStyle").color}
          label="Cor do texto"
          icon={<Baseline size={16} />}
        >
          <div className="flex items-center gap-1.5">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={`Cor ${c.label}`}
                onClick={() => {
                  editor?.chain().focus().setColor(c.value).run();
                  setMenu(null);
                }}
                className={swatchClass}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
          <MenuItem
            onClick={() => {
              editor?.chain().focus().unsetColor().run();
              setMenu(null);
            }}
          >
            Remover cor
          </MenuItem>
        </TMenu>

        <TMenu
          open={menu === "highlight"}
          onOpenChange={(v) => setMenu(v ? "highlight" : null)}
          active={!!editor?.isActive("highlight")}
          label="Destacar texto"
          icon={<Highlighter size={16} />}
        >
          <div className="flex items-center gap-1.5">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={`Destaque ${c.label}`}
                onClick={() => {
                  editor
                    ?.chain()
                    .focus()
                    .toggleHighlight({ color: c.value })
                    .run();
                  setMenu(null);
                }}
                className={swatchClass}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
          <MenuItem
            onClick={() => {
              editor?.chain().focus().unsetHighlight().run();
              setMenu(null);
            }}
          >
            Remover destaque
          </MenuItem>
        </TMenu>

        <Divider />

        <TBtn
          onClick={() => editor?.chain().focus().toggleTextAlign("left").run()}
          active={!!editor?.isActive({ textAlign: "left" })}
          label="Alinhar à esquerda"
        >
          <AlignLeft size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleTextAlign("center").run()}
          active={!!editor?.isActive({ textAlign: "center" })}
          label="Centralizar"
        >
          <AlignCenter size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleTextAlign("right").run()}
          active={!!editor?.isActive({ textAlign: "right" })}
          label="Alinhar à direita"
        >
          <AlignRight size={16} />
        </TBtn>
        <TBtn
          onClick={() =>
            editor?.chain().focus().toggleTextAlign("justify").run()
          }
          active={!!editor?.isActive({ textAlign: "justify" })}
          label="Justificar"
        >
          <AlignJustify size={16} />
        </TBtn>

        <Divider />

        <TBtn
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          active={!!editor?.isActive("bulletList")}
          label="Lista com marcadores"
        >
          <List size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          active={!!editor?.isActive("orderedList")}
          label="Lista numerada"
        >
          <ListOrdered size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
          active={!!editor?.isActive("taskList")}
          label="Lista de tarefas"
        >
          <ListTodo size={16} />
        </TBtn>

        <Divider />

        <TBtn
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          active={!!editor?.isActive("blockquote")}
          label="Citação"
        >
          <TextQuote size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          active={!!editor?.isActive("codeBlock")}
          label="Bloco de código"
        >
          <SquareCode size={16} />
        </TBtn>
        <TBtn
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          label="Linha horizontal"
        >
          <Minus size={16} />
        </TBtn>

        <Divider />

        <TMenu
          open={menu === "link"}
          onOpenChange={(v) => (v ? openLinkMenu() : setMenu(null))}
          active={!!editor?.isActive("link")}
          label={editor?.isActive("link") ? "Editar link" : "Inserir link"}
          icon={<Link2 size={16} />}
          panelClass="w-72 max-w-[80vw]"
        >
          <div className="flex flex-col gap-2">
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === "Escape") setMenu(null);
              }}
              placeholder="https://…"
              className={inputClass}
              autoFocus
            />
            <div className="flex items-center justify-end gap-1.5">
              {editor?.isActive("link") && (
                <button
                  type="button"
                  onClick={() => {
                    editor
                      ?.chain()
                      .focus()
                      .extendMarkRange("link")
                      .unsetLink()
                      .run();
                    setMenu(null);
                  }}
                  className="rounded-md px-2.5 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  Remover
                </button>
              )}
              <button type="button" onClick={applyLink} className={btnPrimary}>
                Aplicar
              </button>
            </div>
            <p className="text-xs text-fg-subtle">
              Dica: selecione um texto e cole uma URL sobre ele para virar link.
            </p>
          </div>
        </TMenu>

        <TBtn
          onClick={() => fileRef.current?.click()}
          disabled={uploading > 0}
          label="Inserir imagem (ou cole/arraste no texto)"
        >
          <ImagePlus size={16} />
        </TBtn>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && editor) void uploadAndInsert(f, editor.view);
            e.target.value = "";
          }}
        />

        <TBtn
          onClick={() => docRef.current?.click()}
          disabled={uploading > 0}
          label={`Anexar documento (${DOC_EXTS.join(", ").toUpperCase()})`}
        >
          <Paperclip size={16} />
        </TBtn>
        <input
          ref={docRef}
          type="file"
          accept={DOC_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) {
              void uploadAttachment(f);
            }
            e.target.value = "";
          }}
        />

        <TMenu
          open={menu === "table"}
          onOpenChange={(v) => setMenu(v ? "table" : null)}
          active={inTable}
          label="Tabela"
          icon={<TableIcon size={16} />}
        >
          {inTable ? (
            <div className="flex flex-col">
              <MenuItem
                onClick={() => editor?.chain().focus().addRowBefore().run()}
              >
                Inserir linha acima
              </MenuItem>
              <MenuItem
                onClick={() => editor?.chain().focus().addRowAfter().run()}
              >
                Inserir linha abaixo
              </MenuItem>
              <MenuItem
                onClick={() => editor?.chain().focus().addColumnBefore().run()}
              >
                Inserir coluna à esquerda
              </MenuItem>
              <MenuItem
                onClick={() => editor?.chain().focus().addColumnAfter().run()}
              >
                Inserir coluna à direita
              </MenuItem>
              <MenuItem
                onClick={() =>
                  editor?.chain().focus().toggleHeaderRow().run()
                }
              >
                Alternar linha de cabeçalho
              </MenuItem>
              <MenuItem
                onClick={() => editor?.chain().focus().deleteRow().run()}
              >
                Excluir linha
              </MenuItem>
              <MenuItem
                onClick={() => editor?.chain().focus().deleteColumn().run()}
              >
                Excluir coluna
              </MenuItem>
              <MenuItem
                onClick={() => {
                  editor?.chain().focus().deleteTable().run();
                  setMenu(null);
                }}
              >
                Excluir tabela
              </MenuItem>
            </div>
          ) : (
            <MenuItem
              onClick={() => {
                editor
                  ?.chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run();
                setMenu(null);
              }}
            >
              Inserir tabela 3×3
            </MenuItem>
          )}
        </TMenu>

        {uploading > 0 && (
          <span className="ml-1 text-xs text-fg-subtle">Enviando imagem…</span>
        )}
      </div>

      {/* Área de escrita */}
      <EditorContent editor={editor} />

      {/* Documentos anexos (ficam na anotação, não no meio do texto) */}
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-line px-3 py-2.5">
          {attachments.map((a) => (
            <li
              key={a.path}
              className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-fg"
            >
              <FileText size={15} className="shrink-0 text-fg-muted" />
              <span className="min-w-0 truncate" title={a.name}>
                {a.name}
              </span>
              <span className="shrink-0 text-xs text-fg-subtle">
                {formatBytes(a.size)}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(a.path)}
                aria-label={`Remover anexo ${a.name}`}
                title="Remover anexo"
                className="shrink-0 rounded p-0.5 text-fg-subtle transition hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:text-red-400"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Erro transitório de imagem — só quando de fato ocorre */}
      {imgError && (
        <p
          role="alert"
          className="border-t border-line px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {imgError}
        </p>
      )}

      {/* Rodapé: visibilidade + ações */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
            className="h-4 w-4 rounded border-line text-risd focus:ring-risd"
          />
          Visível ao cliente
          <span className="text-xs text-fg-subtle">
            (desmarcado = interna, o padrão)
          </span>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className={btnSecondary}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || uploading > 0}
            className={btnPrimary}
          >
            {busy ? "Salvando…" : saveLabel}
          </button>
        </div>
      </div>

      {saveError && (
        <p className="px-3 pb-3 text-sm text-red-600 dark:text-red-400">
          {saveError}
        </p>
      )}
    </div>
  );
}
