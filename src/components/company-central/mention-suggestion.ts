import { initialsOf } from "@/lib/avatar";
import type { MentionUser } from "@/lib/mentions";

// Item exibido no seletor de @ — MentionUser com `label` (o que o nó de menção
// grava como data-label; o TipTap Mention usa id + label por padrão).
type MentionItem = MentionUser & { label: string };

// Monta a configuração de `suggestion` do @tiptap/extension-mention SEM lib de
// popup (sem tippy): um dropdown próprio, posicionado pelo caret, com busca por
// nome, teclado (setas/enter/esc) e uma linha DISCRETA explicando que só
// aparecem pessoas com acesso — pedido do Mauricio: nunca um aviso fixo na
// tela, só aqui, no momento da busca.
export function buildMentionSuggestion(
  getUsers: () => MentionUser[],
  hint: string
) {
  return {
    char: "@",
    // Só busca por nome, no que já veio filtrado por acesso do servidor.
    items: ({ query }: { query: string }): MentionItem[] => {
      const q = query.trim().toLowerCase();
      const users = getUsers();
      const list = q
        ? users.filter((u) => u.name.toLowerCase().includes(q))
        : users;
      return list.slice(0, 8).map((u) => ({ ...u, label: u.name }));
    },
    render: () => {
      let popup: HTMLDivElement | null = null;
      let items: MentionItem[] = [];
      let selected = 0;
      let command: ((item: MentionItem) => void) | null = null;

      function paint() {
        if (!popup) return;
        popup.innerHTML = "";

        const list = document.createElement("div");
        list.className = "flex max-h-64 flex-col overflow-y-auto p-1";

        if (items.length === 0) {
          const empty = document.createElement("p");
          empty.className = "px-3 py-2 text-sm text-fg-subtle";
          empty.textContent = "Nenhuma pessoa encontrada.";
          list.appendChild(empty);
        } else {
          items.forEach((item, i) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
              i === selected
                ? "bg-brand-tint text-risd"
                : "text-fg hover:bg-surface-2"
            }`;
            // Mousedown (não click) para não roubar o foco do editor antes de
            // inserir a menção.
            btn.addEventListener("mousedown", (e) => {
              e.preventDefault();
              select(i);
            });

            const av = document.createElement("span");
            av.className =
              "flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-[10px] font-semibold text-fg-muted";
            if (item.avatarUrl) {
              const img = document.createElement("img");
              img.src = item.avatarUrl;
              img.alt = "";
              img.className = "h-full w-full object-cover";
              av.appendChild(img);
            } else {
              av.textContent = initialsOf(item.name);
            }

            const name = document.createElement("span");
            name.className = "min-w-0 truncate";
            name.textContent = item.name;

            btn.appendChild(av);
            btn.appendChild(name);
            list.appendChild(btn);
          });
        }

        const foot = document.createElement("p");
        foot.className =
          "border-t border-line px-3 py-1.5 text-[11px] leading-snug text-fg-subtle";
        foot.textContent = hint;

        popup.appendChild(list);
        popup.appendChild(foot);
      }

      function position(rect: DOMRect | null | undefined) {
        if (!popup || !rect) return;
        popup.style.left = `${Math.round(rect.left)}px`;
        // Abaixo do caret; se não couber, acima.
        const belowTop = rect.bottom + 6;
        const wouldOverflow = belowTop + 260 > window.innerHeight;
        popup.style.top = wouldOverflow
          ? `${Math.max(8, Math.round(rect.top - 6 - 260))}px`
          : `${Math.round(belowTop)}px`;
      }

      function select(i: number) {
        const item = items[i];
        if (item && command) command(item);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {
        onStart: (props: any) => {
          items = props.items ?? [];
          selected = 0;
          command = props.command;
          popup = document.createElement("div");
          popup.className =
            "fixed z-lightbox w-72 max-w-[90vw] rounded-lg border border-line bg-surface shadow-pop";
          popup.style.position = "fixed";
          paint();
          document.body.appendChild(popup);
          position(props.clientRect?.());
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onUpdate: (props: any) => {
          items = props.items ?? [];
          command = props.command;
          if (selected > items.length - 1) selected = Math.max(0, items.length - 1);
          paint();
          position(props.clientRect?.());
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onKeyDown: (props: any): boolean => {
          const key = props.event?.key;
          if (key === "Escape") {
            return true; // deixa o suggestion fechar
          }
          if (items.length === 0) return false;
          if (key === "ArrowDown") {
            selected = (selected + 1) % items.length;
            paint();
            return true;
          }
          if (key === "ArrowUp") {
            selected = (selected - 1 + items.length) % items.length;
            paint();
            return true;
          }
          if (key === "Enter" || key === "Tab") {
            select(selected);
            return true;
          }
          return false;
        },
        onExit: () => {
          popup?.remove();
          popup = null;
        },
      };
    },
  };
}
