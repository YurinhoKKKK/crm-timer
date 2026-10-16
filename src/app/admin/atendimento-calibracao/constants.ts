// Constantes compartilhadas da Calibração. Mora num módulo NEUTRO (sem "use
// client") de propósito: a tela (page.tsx, server) e a visão (CalibrationView,
// client) precisam do MESMO valor. Se este const morasse no componente client,
// o server receberia um placeholder de referência ({}) em vez da string — o que
// quebrava o período ("invalid input syntax for type date").

export const CALIB_START = "2026-10-14"; // início da calibração
