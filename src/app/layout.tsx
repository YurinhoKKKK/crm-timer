import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM/Timer — Monvatti",
  description: "Gestão de tarefas e tempo por projeto",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
