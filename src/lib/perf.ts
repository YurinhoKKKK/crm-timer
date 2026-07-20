// Instrumentação de performance dos Server Components (diagnóstico).
//
// Mede o tempo de CADA consulta ao Supabase dentro de uma rota e imprime um
// resumo no console do servidor — em `next start` local aparece no terminal;
// na Vercel, em Runtime Logs da função.
//
// DESLIGADA POR PADRÃO: só roda com PERF_LOG=1 no ambiente. Sem a variável,
// `timed` devolve a própria promise e `perfRoute` não imprime nada, então o
// custo em produção é zero.
//
// Uso:
//   const perf = perfRoute("/admin");
//   const [a, b] = await Promise.all([
//     perf.timed("instances", supabase.from("task_instances").select(...)),
//     perf.timed("companies", supabase.from("companies").select(...)),
//   ]);
//   perf.done();
//
// Como ler a saída: as consultas que rodam em Promise.all têm `start` parecido
// (~mesmo instante). Um `start` bem depois do fim das anteriores denuncia um
// WATERFALL — consulta que só começou porque esperou outra terminar.

const ON = process.env.PERF_LOG === "1";

type Mark = { label: string; start: number; ms: number };

export type PerfRoute = {
  /** Envolve uma consulta (ou qualquer promise) e cronometra. */
  timed: <T>(label: string, work: PromiseLike<T>) => Promise<T>;
  /** Marca manual, para trechos que não são promise (ex.: sanitização). */
  mark: (label: string, ms: number) => void;
  /** Imprime o resumo da rota. Chame no fim do Server Component. */
  done: () => void;
};

const NOOP: PerfRoute = {
  timed: <T,>(_label: string, work: PromiseLike<T>) => Promise.resolve(work),
  mark: () => {},
  done: () => {},
};

export function perfRoute(route: string): PerfRoute {
  if (!ON) return NOOP;

  const t0 = performance.now();
  const marks: Mark[] = [];

  return {
    timed<T>(label: string, work: PromiseLike<T>): Promise<T> {
      const start = performance.now();
      return Promise.resolve(work).then(
        (value) => {
          marks.push({ label, start: start - t0, ms: performance.now() - start });
          return value;
        },
        (err) => {
          marks.push({
            label: `${label} (erro)`,
            start: start - t0,
            ms: performance.now() - start,
          });
          throw err;
        }
      );
    },

    mark(label: string, ms: number) {
      marks.push({ label, start: performance.now() - t0 - ms, ms });
    },

    done() {
      const total = performance.now() - t0;
      const rows = marks
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((m) => ({
          consulta: m.label,
          "iniciou_em(ms)": Math.round(m.start),
          "durou(ms)": Math.round(m.ms),
        }));

      // Soma das durações vs. total: se a soma >> total, houve bom paralelismo.
      // Se soma ≈ total, as consultas rodaram em cascata (waterfall).
      const soma = marks.reduce((s, m) => s + m.ms, 0);

      console.log(
        `\n[perf] ${route} — total ${Math.round(total)}ms · ${marks.length} consultas · soma ${Math.round(soma)}ms (paralelismo ${(soma / Math.max(total, 1)).toFixed(1)}x)`
      );
      console.table(rows);
    },
  };
}
