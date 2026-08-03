// =====================================================================
// Layout de sobreposição numa coluna-dia (o que separa um calendário bom de um
// ruim). Algoritmo clássico de colunas: eventos que se sobrepõem formam um
// "cluster"; dentro do cluster cada evento pega a primeira coluna livre e todos
// dividem a largura em partes iguais (1/maxColunas). Assim dois eventos no mesmo
// horário ficam LADO A LADO, sem se cobrir.
// =====================================================================

export type Interval<T> = { item: T; startMin: number; endMin: number };
export type Placed<T> = Interval<T> & { col: number; cols: number };

function overlaps(a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

export function layoutDay<T>(events: Interval<T>[]): Placed<T>[] {
  const sorted = [...events].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin
  );

  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const cols = Math.max(...cluster.map((e) => e.col + 1));
    for (const e of cluster) e.cols = cols;
    out.push(...cluster);
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const ev of sorted) {
    // Fecha o cluster quando abre um buraco (nada mais se sobrepõe ao grupo).
    if (ev.startMin >= clusterEnd) flush();
    // Primeira coluna livre entre os eventos do cluster que colidem com este.
    const used = new Set(
      cluster.filter((e) => overlaps(e, ev)).map((e) => e.col)
    );
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...ev, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  }
  flush();
  return out;
}
