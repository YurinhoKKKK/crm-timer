/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // O @react-pdf/renderer traz binários/wasm (yoga, fontkit). Externalizá-lo
    // do bundle do servidor evita que o webpack o quebre na rota de exportação
    // de PDF (runtime nodejs).
    serverComponentsExternalPackages: ["@react-pdf/renderer"],
  },
};
export default nextConfig;
