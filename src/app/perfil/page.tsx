import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import ProfileForm from "./ProfileForm";

type ShellRole = "admin" | "consultor" | "colaborador";

export default async function PerfilPage() {
  const { supabase, profile } = await guardRole([
    "admin",
    "consultor",
    "colaborador",
  ]);

  // guardRole não traz o e-mail; busca aqui (registro próprio, via RLS).
  const { data: extra } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", profile.id)
    .single();

  const backHref =
    profile.role === "admin"
      ? "/admin"
      : profile.role === "consultor"
        ? "/consultor"
        : "/colaborador";

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as ShellRole,
        avatarUrl: profile.avatarUrl,
      }}
      title="Meu perfil"
      back={{ href: backHref, label: "Voltar" }}
    >
      <div className="mx-auto max-w-2xl">
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <ProfileForm
            userId={profile.id}
            initialName={profile.full_name}
            email={extra?.email ?? ""}
            role={profile.role}
            initialAvatarPath={profile.avatar_path}
            initialAvatarUrl={profile.avatarUrl}
          />
        </section>
      </div>
    </AppShell>
  );
}
