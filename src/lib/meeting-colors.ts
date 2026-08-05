// Cor por pessoa — consistente pelo id (hash determinístico), para cruzar
// agendas na grade do calendário. Paleta distinta e legível nos dois temas.
// Estilo INLINE (hex) porque o id do usuário é dinâmico e o Tailwind não geraria
// classes por id. A cor do evento é a do CRIADOR (dono do evento).

const PALETTE = [
  "#2F6BFF", // azul
  "#E8590C", // laranja
  "#2B8A3E", // verde
  "#9C36B5", // roxo
  "#0B7285", // teal escuro
  "#C2255C", // rosa
  "#5C7CFA", // índigo
  "#E67700", // âmbar
  "#087F5B", // esmeralda
  "#6741D9", // violeta
  "#1098AD", // ciano
  "#D6336C", // magenta
];

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function personColor(id: string): string {
  return PALETTE[hash(id) % PALETTE.length];
}

// Estilo de um bloco de evento: tinta suave da cor + barra colorida à esquerda.
// A tinta com alpha baixo funciona tanto sobre superfície clara quanto escura;
// a barra dá a identidade forte da pessoa. O texto usa a cor de fg do tema.
export function eventBlockStyle(hex: string): {
  backgroundColor: string;
  borderLeft: string;
} {
  return {
    backgroundColor: `${hex}26`, // ~15% alpha
    borderLeft: `3px solid ${hex}`,
  };
}

// Estilo de um evento IMPORTADO do Google (Fatia 2): mantém a cor da PESSOA (para
// cruzar agendas), mas com HACHURA diagonal + borda tracejada e barra mais fina —
// deixando óbvio, à distância, que veio do Google e é somente-leitura (não se
// arrasta nem edita por aqui). A hachura usa a própria cor bem apagada sobre uma
// tinta mínima, legível nos dois temas.
export function importedBlockStyle(hex: string): {
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  borderLeft: string;
  border: string;
} {
  return {
    backgroundColor: `${hex}14`, // ~8% alpha (base bem suave)
    backgroundImage: `repeating-linear-gradient(45deg, ${hex}2e 0, ${hex}2e 1px, transparent 1px, transparent 7px)`,
    backgroundSize: "auto",
    borderLeft: `3px dashed ${hex}`,
    border: `1px dashed ${hex}55`,
  };
}
