"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";

// Atualiza o nome do próprio usuário. A RLS (profiles_update_self) só permite
// alterar o próprio registro e impede mudar o cargo.
export async function updateProfileName(
  name: string
): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Informe seu nome." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: trimmed })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/perfil");
  return { error: null };
}

// Persiste o caminho da nova foto (já enviada ao Storage pelo cliente) e
// remove a anterior, se houver.
export async function saveAvatarPath(
  newPath: string,
  oldPath: string | null
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: newPath })
    .eq("id", user.id);

  if (error) return { error: error.message };

  if (oldPath && oldPath !== newPath) {
    await supabase.storage.from("avatars").remove([oldPath]);
  }

  revalidatePath("/perfil");
  return { error: null };
}

// Remove a foto de perfil (volta ao fallback de iniciais).
export async function removeAvatar(
  oldPath: string | null
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", user.id);

  if (error) return { error: error.message };

  if (oldPath) {
    await supabase.storage.from("avatars").remove([oldPath]);
  }

  revalidatePath("/perfil");
  return { error: null };
}
