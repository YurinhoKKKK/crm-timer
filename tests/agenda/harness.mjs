// =====================================================================
// Harness dos testes de lógica pura da agenda (node --test, sem framework).
//
// Problema: toImportRow/toForwardOp (google-import-actions.ts) e o diff de
// convidados (meeting-actions.ts) vivem em arquivos "use server" que importam
// next/headers via supabase-server — impossíveis de importar no Node puro. E as
// funções puras não são exportadas (um arquivo "use server" só pode exportar
// actions async).
//
// Solução: carregar o FONTE REAL, transpilar com o typescript do repo
// (type-stripping para CommonJS) e avaliar num escopo com require() falso que
// entrega stubs para os imports de infraestrutura. `appendExports` permite
// expor funções internas (module-private) para o teste SEM alterar o fonte.
// Nada aqui toca rede ou banco.
// =====================================================================
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

// Carrega um módulo TS do repo com imports substituídos por stubs.
// - file: caminho relativo à raiz do repo (ex.: "src/app/google-import-actions.ts")
// - stubs: { "especificador-de-import": objetoStub }
// - appendExports: nomes de funções internas a expor em module.exports.__test
export function loadServerModule(file, stubs = {}, appendExports = []) {
  let src = readFileSync(path.join(repoRoot, file), "utf8");
  if (appendExports.length > 0) {
    src += `\n;(module as any).exports.__test = { ${appendExports.join(", ")} };\n`;
  }
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
  });
  const mod = { exports: {} };
  const fakeRequire = (spec) => {
    if (spec in stubs) return stubs[spec];
    // Imports relativos/aliases não cobertos por stub: resolve dentro do repo
    // (só para módulos igualmente puros).
    if (spec.startsWith("@/")) {
      return loadServerModule(`src/${spec.slice(2)}.ts`, stubs);
    }
    return require(spec);
  };
  new Function("require", "module", "exports", out.outputText)(
    fakeRequire,
    mod,
    mod.exports
  );
  return mod.exports;
}

// ---------------------------------------------------------------------
// Mock mínimo do cliente Supabase para exercitar uma server action de ponta a
// ponta sem rede. Grava cada operação em `ops` para o teste inspecionar.
// Responde na ordem configurada por tabela+verbo via `respond`.
// ---------------------------------------------------------------------
export function mockSupabase({ user, responses }) {
  const ops = [];
  const queue = new Map(); // "tabela:verbo" -> [respostas...]
  for (const [key, list] of Object.entries(responses ?? {})) {
    queue.set(key, [...list]);
  }
  const next = (key, fallback) => {
    const list = queue.get(key);
    if (list && list.length > 0) return list.shift();
    return fallback;
  };

  function chain(table, verb, payload) {
    const op = { table, verb, payload, filters: {} };
    ops.push(op);
    const result = () =>
      next(`${table}:${verb}`, { data: null, error: null });
    const c = {
      eq: (col, val) => ((op.filters[`eq:${col}`] = val), c),
      in: (col, vals) => ((op.filters[`in:${col}`] = vals), c),
      is: (col, val) => ((op.filters[`is:${col}`] = val), c),
      gte: (col, val) => ((op.filters[`gte:${col}`] = val), c),
      gt: (col, val) => ((op.filters[`gt:${col}`] = val), c),
      lt: (col, val) => ((op.filters[`lt:${col}`] = val), c),
      not: (col, kind, val) => ((op.filters[`not:${col}`] = `${kind}:${val}`), c),
      order: () => c,
      select: (cols) => ((op.select = cols), c),
      single: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve(result()),
      then: (res, rej) => Promise.resolve(result()).then(res, rej),
    };
    return c;
  }

  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => ({
      select: (cols) => chain(table, "select", cols),
      insert: (rows) => chain(table, "insert", rows),
      update: (patch) => chain(table, "update", patch),
      delete: () => chain(table, "delete"),
    }),
    rpc: (fn, args) => {
      const op = { table: `rpc:${fn}`, verb: "rpc", payload: args, filters: {} };
      ops.push(op);
      return Promise.resolve(next(`rpc:${fn}`, { data: null, error: null }));
    },
  };
  return { client, ops };
}
