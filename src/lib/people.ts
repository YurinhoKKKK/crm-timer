export type PersonOption = { id: string; full_name: string; email: string };

// Acrescenta o próprio usuário ao topo de uma lista de pessoas, marcado com
// "(você)". Usado para que admin/consultor possam se autoatribuir como
// responsável de tarefas (Passo 14) ou, no caso do admin, como consultor de
// uma empresa. Se o usuário já estiver na lista, devolve-a inalterada.
export function withSelf(
  list: PersonOption[],
  self: { id: string; full_name: string }
): PersonOption[] {
  if (list.some((p) => p.id === self.id)) return list;
  return [
    { id: self.id, full_name: `${self.full_name} (você)`, email: "" },
    ...list,
  ];
}
