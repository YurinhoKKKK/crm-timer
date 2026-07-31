import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import ProfileForm from "./ProfileForm";
import GoogleCalendarCard from "./GoogleCalendarCard";

// A conexão do Google (conectado? qual conta? divergência?) é lida do banco a
// cada render. NUNCA pode servir de cache: logo após conectar/desconectar o
// estado exibido tem que refletir a linha real. force-dynamic garante SSR por
// requisição; o cliente ainda revalida via router.refresh após cada ação.
export const dynamic = "force-dynamic";

type ShellRole = "admin" | "consultor" | "colaborador";

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: { google?: string; g_msg?: string };
}) {
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

  // Conexão do Google Calendar — só metadados (as colunas de token não têm
  // grant para o navegador; ver migrations 0043/0044).
  const { data: gcal } = await supabase
    .from("google_accounts")
    .select("google_email, connected_at")
    .eq("user_id", profile.id)
    .maybeSingle();

  const systemEmail = extra?.email ?? "";
  const googleEmail = gcal?.google_email ?? null;
  // Divergência: conta Google conectada difere do e-mail do sistema.
  const emailMismatch =
    !!googleEmail &&
    !!systemEmail &&
    googleEmail.trim().toLowerCase() !== systemEmail.trim().toLowerCase();

  const flashStatus =
    searchParams.google === "connected"
      ? "connected"
      : searchParams.google === "error"
        ? "error"
        : null;

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

        <section className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <GoogleCalendarCard
            connected={!!gcal}
            googleEmail={googleEmail}
            connectedAt={gcal?.connected_at ?? null}
            emailMismatch={emailMismatch}
            systemEmail={systemEmail}
            flashStatus={flashStatus}
            flashMsg={searchParams.g_msg ?? null}
          />
        </section>
      </div>
    </AppShell>
  );
}
