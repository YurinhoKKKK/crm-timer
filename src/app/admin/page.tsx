import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";

type Section = {
  href: string;
  title: string;
  description: string;
  ready: boolean;
};

const SECTIONS: Section[] = [
  {
    href: "/admin/usuarios",
    title: "Usuários",
    description: "Liberar acessos e definir cargos (admin, consultor, colaborador).",
    ready: true,
  },
  {
    href: "/admin/empresas",
    title: "Empresas",
    description: "Cadastrar clientes, vincular grupo de WhatsApp e consultores.",
    ready: true,
  },
  {
    href: "/admin/tarefas",
    title: "Tarefas",
    description: "Criar tarefas únicas ou diárias para os colaboradores.",
    ready: true,
  },
];

export default async function AdminPage() {
  const { profile } = await guardRole(["admin"]);

  return (
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gunmetal">
              Painel do Administrador
            </h1>
            <p className="text-sm text-gunmetal/60">
              Bem-vindo, {profile.full_name}
            </p>
          </div>
          <LogoutButton />
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((section) =>
            section.ready ? (
              <Link
                key={section.href}
                href={section.href}
                className="group rounded-xl border border-platinum bg-white p-5 shadow-sm transition hover:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
              >
                <h2 className="font-medium text-gunmetal group-hover:text-risd">
                  {section.title}
                </h2>
                <p className="mt-1 text-sm text-gunmetal/60">
                  {section.description}
                </p>
              </Link>
            ) : (
              <div
                key={section.href}
                aria-disabled="true"
                className="rounded-xl border border-dashed border-platinum bg-white/50 p-5"
              >
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-gunmetal/50">{section.title}</h2>
                  <span className="rounded-full border border-platinum px-2 py-0.5 text-xs text-gunmetal/40">
                    em breve
                  </span>
                </div>
                <p className="mt-1 text-sm text-gunmetal/40">
                  {section.description}
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
}
