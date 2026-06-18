import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import type { Database } from "@/lib/types";

type Role = "admin" | "consultor" | "colaborador";

// Garante que o usuário logado tem um dos cargos permitidos.
// Retorna o profile; redireciona caso contrário.
export async function guardRole(allowed: Role[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role === "pending") redirect("/pending");
  if (!allowed.includes(profile.role as Role)) redirect("/");

  return { supabase, profile };
}
