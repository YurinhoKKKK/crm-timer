"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { TaskToggleResult } from "@/lib/task-checkbox";

export type TaskToggleFn = (
  index: number,
  checked: boolean
) => Promise<TaskToggleResult>;

// Rótulo padrão da caixa desabilitada para quem NÃO pode editar aquele conteúdo
// (visível, não clicável). No portal do cliente não se passa rótulo — a caixa
// fica só desabilitada, sem texto interno.
export const TASK_READONLY_TITLE =
  "Só quem pode editar este texto marca os itens.";

// Torna interativas as caixas de checklist (taskItem) de um conteúdo rich text
// renderizado via dangerouslySetInnerHTML. Opera sobre o DOM já pintado:
//
//  · A fonte da verdade do estado é o `data-checked` do <li> — a caixa é
//    sincronizada a partir dele (nunca do `checked` do <input>, que o
//    sanitizador pode mexer).
//  · Com permissão de edição, cada caixa fica clicável: ao marcar, reflete na
//    hora (otimista), chama a action pelo ÍNDICE do item (ordem no documento) e,
//    se a gravação falhar, volta ao estado anterior e emite o erro classificado.
//  · Sem permissão (ou no portal do cliente), a caixa aparece desabilitada,
//    com cursor "not-allowed" e, quando houver, o title explicando por quê.
//
// Rebinda quando o HTML muda (o innerHTML é substituído) ou quando a permissão
// muda. onToggle/onError são lidos de refs, então recriá-los a cada render não
// provoca rebinda nem perde um clique em andamento.
export function useTaskCheckboxes(opts: {
  containerRef: RefObject<HTMLElement | null>;
  html: string;
  canEdit: boolean;
  onToggle?: TaskToggleFn;
  readOnlyTitle?: string;
  onError?: (message: string | null) => void;
}): void {
  const { containerRef, html, canEdit, onToggle, readOnlyTitle, onError } = opts;

  const onToggleRef = useRef(onToggle);
  const onErrorRef = useRef(onError);
  const readOnlyTitleRef = useRef(readOnlyTitle);
  onToggleRef.current = onToggle;
  onErrorRef.current = onError;
  readOnlyTitleRef.current = readOnlyTitle;

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const items = Array.from(
      root.querySelectorAll<HTMLLIElement>('li[data-type="taskItem"]')
    );
    const cleanups: Array<() => void> = [];

    items.forEach((li, index) => {
      const input = li.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      );
      if (!input) return;

      // Estado exibido = data-checked do <li>.
      input.checked = li.getAttribute("data-checked") === "true";

      const editable = canEdit && !!onToggleRef.current;
      if (!editable) {
        input.disabled = true;
        input.style.cursor = "not-allowed";
        const title = readOnlyTitleRef.current;
        if (title) {
          input.title = title;
          li.querySelector("label")?.setAttribute("title", title);
        }
        return;
      }

      input.disabled = false;
      input.style.cursor = "pointer";

      const handler = async () => {
        const desired = input.checked;
        // Otimista: o data-checked guia o tachado (CSS) e a próxima leitura.
        li.setAttribute("data-checked", String(desired));
        input.disabled = true;
        onErrorRef.current?.(null);

        let res: TaskToggleResult | undefined;
        try {
          res = await onToggleRef.current?.(index, desired);
        } catch {
          res = undefined;
        }

        input.disabled = false;
        if (!res || res.ok === false) {
          // Reverte a caixa e o atributo ao estado anterior.
          const prev = !desired;
          li.setAttribute("data-checked", String(prev));
          input.checked = prev;
          onErrorRef.current?.(
            res && res.ok === false
              ? res.message
              : "Não foi possível salvar a alteração."
          );
        }
      };

      input.addEventListener("change", handler);
      cleanups.push(() => input.removeEventListener("change", handler));
    });

    return () => cleanups.forEach((fn) => fn());
  }, [containerRef, html, canEdit]);
}
