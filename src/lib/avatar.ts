// Constrói a URL pública de um avatar a partir do caminho salvo em
// profiles.avatar_path (bucket público "avatars"). Retorna null quando não há
// foto — nesse caso a UI cai no fallback de iniciais.
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/avatars/${path}`;
}

// Iniciais (até 2 letras) para o fallback quando não há foto.
export function initialsOf(name: string): string {
  return (
    (name || "?")
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
