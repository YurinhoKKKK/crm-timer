import Image from "@tiptap/extension-image";

// Imagem redimensionável do editor de anotações (passo 24): estende a extensão
// oficial Image com um atributo `width` persistido no HTML e um NodeView com
// alças nos 4 cantos (aparecem ao selecionar a imagem). Arrastar muda só a
// largura — a altura fica automática (CSS height:auto), preservando a
// proporção. Estilos das alças em globals.css (.img-resizer / .img-handle).
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute("width");
          if (attr) return parseInt(attr, 10) || null;
          const style = (element as HTMLElement).style?.width;
          return style ? parseInt(style, 10) || null : null;
        },
        renderHTML: (attributes) =>
          attributes.width ? { width: attributes.width } : {},
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node;

      const dom = document.createElement("span");
      dom.className = "img-resizer";

      const img = document.createElement("img");
      const applyAttrs = (n: typeof node) => {
        img.src = n.attrs.src as string;
        img.alt = (n.attrs.alt as string | null) ?? "";
        img.style.width = n.attrs.width ? `${n.attrs.width}px` : "";
      };
      applyAttrs(node);
      dom.appendChild(img);

      const startDrag = (corner: string) => (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = img.getBoundingClientRect().width;
        // Alças da esquerda: arrastar para fora (esquerda) aumenta.
        const dir = corner.includes("w") ? -1 : 1;
        const maxW = dom.parentElement?.clientWidth ?? Infinity;

        const onMove = (ev: PointerEvent) => {
          const w = Math.min(
            maxW,
            Math.max(60, Math.round(startW + dir * (ev.clientX - startX)))
          );
          img.style.width = `${w}px`;
        };
        const onUp = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          // Persiste a largura final no documento (uma única entrada no undo).
          const w = Math.round(img.getBoundingClientRect().width);
          const pos = typeof getPos === "function" ? getPos() : undefined;
          if (pos != null) {
            editor.view.dispatch(
              editor.view.state.tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                width: w,
              })
            );
          }
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      };

      for (const corner of ["nw", "ne", "sw", "se"]) {
        const handle = document.createElement("span");
        handle.className = `img-handle img-handle-${corner}`;
        handle.addEventListener("pointerdown", startDrag(corner));
        dom.appendChild(handle);
      }

      return {
        dom,
        update(updated) {
          if (updated.type.name !== currentNode.type.name) return false;
          currentNode = updated;
          applyAttrs(updated);
          return true;
        },
        selectNode() {
          dom.classList.add("selected");
        },
        deselectNode() {
          dom.classList.remove("selected");
        },
        // O redimensionamento mexe no DOM por fora do ProseMirror; sem isso o
        // editor tentaria "corrigir" a mutação no meio do arraste.
        ignoreMutation() {
          return true;
        },
      };
    };
  },
});
