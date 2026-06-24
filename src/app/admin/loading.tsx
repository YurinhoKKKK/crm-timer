import ShellSkeleton from "@/components/ShellSkeleton";

// Cobre /admin e todas as subrotas (tarefas, empresas, usuários, instâncias).
export default function Loading() {
  return <ShellSkeleton role="admin" />;
}
