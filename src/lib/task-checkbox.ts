// Troca o estado de UM item de checklist (taskItem do TipTap) dentro de um HTML
// de conteúdo rich text, pelo ÍNDICE do item na ordem do documento.
//
// Por que uma função pura e separada do sanitizador:
//  · O cliente do navegador NUNCA envia HTML. A server action recebe id, índice,
//    novo estado e o token de conflito; lê o HTML atual do banco, chama ESTA
//    função para trocar só o item pedido e depois passa o resultado pelo
//    getNoteSanitizer antes de gravar. Assim o resto do documento fica idêntico.
//  · A fonte da verdade do estado é o atributo `data-checked` do
//    `<li data-type="taskItem">`. O `checked` do <input> é secundário (o
//    sanitizador pode mexer nele) — aqui ajustamos os dois por consistência,
//    mas a leitura sempre exibe pelo data-checked.
//
// O HTML vem SEMPRE do mesmo gerador (TipTap v3 + DOMPurify), cuja saída para um
// item é determinística:
//   <li data-checked="false" data-type="taskItem">
//     <label><input type="checkbox"><span></span></label><div><p>…</p></div>
//   </li>
// (quando marcado: data-checked="true" e <input type="checkbox" checked="checked">).
// Por isso uma transformação textual dirigida é segura e previsível — e evita
// arrastar um parser de HTML para dentro desta função pura.

// Resultado de uma marcação na leitura, compartilhado entre a server action
// (que o produz) e o renderizador (que reage a ele). Em caso de falha, a causa
// vem CLASSIFICADA — permissão (quem não pode editar), conflito (o texto mudou)
// ou falha genérica — para a tela devolver a caixa ao estado anterior e mostrar
// a mensagem certa.
export type TaskToggleReason = "permission" | "conflict" | "error";

export type TaskToggleResult =
  | { ok: true; token: string }
  | { ok: false; reason: TaskToggleReason; message: string };

// Mensagens padrão por causa (a action pode sobrescrever a de "error").
export const TASK_TOGGLE_MESSAGES: Record<TaskToggleReason, string> = {
  permission: "Só quem pode editar este texto marca os itens.",
  conflict:
    "Este texto foi alterado por outra pessoa. Recarregue para ver a versão atual.",
  error: "Não foi possível salvar a alteração.",
};

// Localiza as tags de ABERTURA de cada <li data-type="taskItem"> na ordem do
// documento. O data-type pode vir antes ou depois do data-checked; [^>]* cobre
// os dois casos dentro da mesma tag.
const TASK_ITEM_OPEN = /<li\b[^>]*\bdata-type="taskItem"[^>]*>/gi;
const DATA_CHECKED_ATTR = /\bdata-checked="[^"]*"/i;
const CHECKBOX_INPUT = /<input\b[^>]*\btype="checkbox"[^>]*>/i;
const CHECKED_ATTR = /\s*\bchecked(?:="[^"]*")?/i;

/**
 * Devolve um novo HTML com o `data-checked` (e o `checked` do <input>, por
 * consistência) do taskItem de posição `index` ajustado para `checked`.
 *
 * `index` é a ordem do item no documento (0-based), contando TODOS os
 * `<li data-type="taskItem">`, inclusive os aninhados — a mesma contagem que a
 * leitura usa ao numerar as caixas. Índice fora do intervalo (ou inválido)
 * lança RangeError: a server action trata como recusa e NÃO grava.
 */
export function setTaskItemChecked(
  html: string,
  index: number,
  checked: boolean
): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`índice de taskItem inválido: ${index}`);
  }

  TASK_ITEM_OPEN.lastIndex = 0;
  let count = -1;
  let target: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = TASK_ITEM_OPEN.exec(html)) !== null) {
    count += 1;
    if (count === index) {
      target = m;
      break;
    }
  }
  if (!target) {
    throw new RangeError(
      `índice de taskItem fora do intervalo: ${index} (itens: ${count + 1})`
    );
  }

  const desired = checked ? "true" : "false";
  const openTag = target[0];
  const openStart = target.index;

  // 1) Ajusta o data-checked da tag de abertura do <li> (a fonte da verdade).
  const newOpenTag = DATA_CHECKED_ATTR.test(openTag)
    ? openTag.replace(DATA_CHECKED_ATTR, `data-checked="${desired}"`)
    : openTag.replace(/^<li\b/i, `<li data-checked="${desired}"`);

  let out =
    html.slice(0, openStart) +
    newOpenTag +
    html.slice(openStart + openTag.length);

  // 2) Ajusta, por consistência, o <input type="checkbox"> daquele item — o
  //    PRIMEIRO input após a abertura do <li> é sempre o do próprio item
  //    (estrutura: li › label › input, antes do div com o texto e de qualquer
  //    lista aninhada).
  const afterOpen = openStart + newOpenTag.length;
  const rest = out.slice(afterOpen);
  const im = CHECKBOX_INPUT.exec(rest);
  if (im) {
    const inputTag = im[0];
    let newInput: string;
    if (checked) {
      // Já tem `checked`: normaliza o valor onde está. Senão, acrescenta ao
      // FINAL (antes do `>`), preservando a ordem canônica do TipTap
      // (`<input type="checkbox" checked="checked">`) — diff mínimo.
      newInput = CHECKED_ATTR.test(inputTag)
        ? inputTag.replace(CHECKED_ATTR, ' checked="checked"')
        : inputTag.replace(/>$/, ' checked="checked">');
    } else {
      newInput = inputTag.replace(CHECKED_ATTR, "");
    }
    out =
      out.slice(0, afterOpen) +
      rest.slice(0, im.index) +
      newInput +
      rest.slice(im.index + inputTag.length);
  }

  return out;
}
