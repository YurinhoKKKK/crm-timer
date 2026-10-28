/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // O @react-pdf/renderer (e o pdfkit por baixo) trazem binários/wasm e dados.
    // Externalizá-los do bundle do servidor evita que o webpack os quebre na
    // rota de exportação de PDF (runtime nodejs).
    serverComponentsExternalPackages: ["@react-pdf/renderer", "pdfkit", "fontkit"],
    // O pdfkit carrega as MÉTRICAS das fontes padrão (Helvetica.cjs etc.) por
    // import dinâmico (`#standard-fonts/Helvetica`). O rastreador de arquivos da
    // Vercel não enxerga esse require dinâmico, então esses .cjs ficavam de fora
    // do bundle da função — e a geração do PDF quebrava em produção com
    // "Cannot find module .../pdfkit/js/standard-fonts/Helvetica.cjs". Forçamos a
    // inclusão da pasta js do pdfkit (fontes + chunks) na função da rota.
    outputFileTracingIncludes: {
      "/api/admin/empresas/[id]/historico-pdf": [
        "./node_modules/pdfkit/js/**/*",
      ],
    },
  },
};
export default nextConfig;
