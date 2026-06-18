import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  switch (profile?.role) {
    case "admin":
      redirect("/admin");
    case "consultor":
      redirect("/consultor");
    case "colaborador":
      redirect("/colaborador");
    default:
      redirect("/pending");
  }
}
