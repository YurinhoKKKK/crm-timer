// Permissão de GESTÃO dos quadros de área (Desenvolvimento e Tráfego) — FONTE
// ÚNICA no app, que espelha EXATAMENTE a regra do banco:
//   · Desenvolvimento: dev_can_manage()  = is_admin() OR role = 'desenvolvedor'
//   · Tráfego:         regra inline das RPCs = is_admin() OR role = 'gestor_trafego'
//
// As listas de cargos abaixo são consumidas PELA TELA (guardRole nas páginas) E
// PELAS SERVER ACTIONS (guardRole), para a permissão nunca divergir entre os dois
// — nada de decidir "é admin" espalhado. Os helpers booleanos derivam das MESMAS
// listas (não podem divergir) e servem a qualquer necessidade de gating na UI.
//
// Atenção: a permissão de GESTÃO do quadro NÃO é a mesma coisa que as ações
// exclusivas do admin dentro do quadro (abrir a central da empresa pelo nome,
// configurar correspondência/gestão de grupos) — essas continuam gated por admin.

export const DEV_BOARD_ROLES = ["admin", "desenvolvedor"] as const;
export const TRAFFIC_BOARD_ROLES = ["admin", "gestor_trafego"] as const;

export function canManageDevBoard(role: string | null | undefined): boolean {
  return !!role && (DEV_BOARD_ROLES as readonly string[]).includes(role);
}

export function canManageTrafficBoard(role: string | null | undefined): boolean {
  return !!role && (TRAFFIC_BOARD_ROLES as readonly string[]).includes(role);
}
