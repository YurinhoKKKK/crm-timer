import Logo from "@/components/Logo";
import type {
  PortalListing,
  PortalProgress,
  PortalUpdate,
  PortalSource,
} from "@/lib/client-portal";
import PortalContent from "./PortalContent";

// A CASCA do portal do cliente: hero, barra superior e abas. Usada pelos DOIS
// caminhos — o portal real (/cliente/[token], autenticado por token + senha) e
// o "Ver como cliente" interno (passo 30).
//
// Por que compartilhar: se a pré-visualização replicasse este layout, as duas
// telas divergiriam com o tempo e o preview passaria a mostrar algo diferente
// do que o cliente realmente vê — que é exatamente o que ele existe para
// evitar. O conteúdo também vem da mesma curadoria no banco
// (client_portal_payload), então nem o dado nem a forma podem divergir.
//
// Este componente é PURO: recebe tudo pronto e não consulta nada.
export default function PortalView({
  companyName,
  listings,
  progress,
  updates,
  source,
  actions,
  banner,
}: {
  companyName: string;
  listings: PortalListing[];
  progress: PortalProgress;
  updates: PortalUpdate[];
  // De onde o "ver mais" do Andamento puxa a próxima página.
  source: PortalSource;
  // Canto superior direito: tema + sair (portal) ou tema + voltar (preview).
  actions: React.ReactNode;
  // Faixa acima de tudo — usada pelo preview para deixar inequívoco o modo.
  banner?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-canvas">
      {banner}
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Logo variant="auto" className="h-8 w-auto max-w-[160px]" />
          <div className="flex items-center gap-2">{actions}</div>
        </div>

        <header className="portal-hero relative mb-8 overflow-hidden rounded-2xl p-6 shadow-pop sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 -left-12 h-56 w-56 rounded-full bg-white/[0.07] blur-2xl"
          />
          <p className="relative text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
            Portal do cliente
          </p>
          <h1 className="relative mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {companyName}
          </h1>
          <p className="relative mt-3 max-w-xl text-sm leading-relaxed text-white/85">
            Bem-vindo! Aqui você acompanha as entregas e as novidades do seu
            projeto com a Monvatti.
          </p>
        </header>

        <PortalContent
          source={source}
          listings={listings}
          progress={progress}
          updates={updates}
        />

        <footer className="mt-8 pb-4 text-center text-xs text-fg-subtle">
          Monvatti · acesso exclusivo do cliente
        </footer>
      </div>
    </main>
  );
}
