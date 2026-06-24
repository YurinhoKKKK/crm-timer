// Logo oficial da Monvatti. Escolhe a versão certa conforme o contexto:
// - variant="white": sempre a branca (sidebar e fundos escuros).
// - variant="blue": sempre a azul (fundos claros).
// - variant="auto": azul no tema claro e branca no escuro (troca por CSS,
//   sem JavaScript — depende de darkMode: "class" no Tailwind).
//
// Os arquivos ficam em public/ (ver public/README.md). Usamos <img> com
// altura fixa e largura automática para preservar a proporção original.

const AZUL = "/logo-azul.png";
const BRANCA = "/logo-branca.png";

export default function Logo({
  variant = "auto",
  className = "h-8 w-auto",
}: {
  variant?: "auto" | "white" | "blue";
  className?: string;
}) {
  if (variant === "white") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={BRANCA} alt="Monvatti" className={`${className} object-contain`} />;
  }

  if (variant === "blue") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={AZUL} alt="Monvatti" className={`${className} object-contain`} />;
  }

  return (
    <span role="img" aria-label="Monvatti" className="inline-flex">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={AZUL}
        alt=""
        aria-hidden="true"
        className={`${className} block object-contain dark:hidden`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BRANCA}
        alt=""
        aria-hidden="true"
        className={`${className} hidden object-contain dark:block`}
      />
    </span>
  );
}
