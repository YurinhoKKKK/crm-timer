import ShellSkeleton from "@/components/ShellSkeleton";

// Esqueleto imediato enquanto o servidor resolve a página — a navegação não fica
// travada na tela anterior. O `role` só dimensiona o nº de itens do skeleton da
// sidebar (cosmético); aqui usamos o cargo mais frequente da rota.
export default function Loading() {
  return <ShellSkeleton role="colaborador" />;
}
