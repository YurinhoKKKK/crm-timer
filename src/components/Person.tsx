import Avatar from "./Avatar";

// Nome de pessoa com o avatar ao lado — o jeito padrão de exibir gente em
// qualquer lista/detalhe do sistema. `size` menor (18–20) em listas densas,
// maior (24–36) em cabeçalhos. Sem foto, cai nas iniciais (fallback do Avatar).
export default function Person({
  name,
  avatarUrl,
  size = 20,
  className = "",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle ${className}`}
    >
      <Avatar name={name} url={avatarUrl} size={size} />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}
