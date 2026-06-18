# CRM/Timer — Monvatti

Sistema de gestão de tarefas e tempo por projeto, com integração WhatsApp (Digisac).

## Stack
Next.js 14 (App Router) · Supabase · Tailwind CSS · Vercel

## Início rápido
```bash
npm install
cp .env.local.example .env.local   # preencher com suas chaves
npm run dev
```

Depois de se registrar, promova seu usuário a `admin` no Supabase (tabela `profiles`).

## Documentação
Veja `docs/ESPECIFICACAO.md` para o mapa completo do projeto: modelo de dados,
o que já está pronto, o que falta construir e a integração WhatsApp.

## Banco de dados
As migrations em `supabase/migrations/` já foram aplicadas no projeto Supabase.
Para um banco novo, rode-as em ordem (0001 → 0002 → 0003).
