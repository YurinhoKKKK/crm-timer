# CRM/Timer — Monvatti · Especificação

Documento-mapa do projeto. Cobre o que já está pronto e o que falta construir, com detalhes suficientes para seguir a construção (manualmente ou via Claude Code).

---

## 1. Visão geral

Sistema de gestão de tarefas e tempo, com três cargos e três painéis. O fluxo central: tarefas são atribuídas a colaboradores → o colaborador executa cronometrando o tempo (play/pause) → ao finalizar, escreve um resumo que pode ser enviado ao grupo de WhatsApp da empresa (via Digisac) e fica registrado no log de atividades. Todo tempo é somado por empresa/projeto.

**Stack:** Next.js 14 (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind CSS · Digisac (WhatsApp) · Deploy na Vercel.

---

## 2. Cargos e acesso

| Cargo | Vê | Faz |
|-------|-----|-----|
| **Admin** | Tudo | Cadastra consultores/colaboradores (atribui cargo), empresas, tarefas. Atribui empresas a consultores. Dashboards gerais. Resumos por colaborador. |
| **Consultor** | Só seus clientes | Cadastra tarefas para colaboradores nas suas empresas. Sem dashboards gerais. |
| **Colaborador** | Só suas tarefas | Vê empresas (derivadas das tarefas dele), executa tarefas com timer, finaliza com resumo. |

Novos usuários nascem como `pending` e só acessam após o admin atribuir um cargo.

**Tarefas padrão (Passo 15):** catálogo global de moldes reutilizáveis na tabela `standard_tasks` (título, descrição, instruções, `kind`, `weekdays`, `due_time`). O admin cria/edita/exclui o catálogo (aba "Tarefas Padrão" em `/admin/tarefas`; RLS `st_admin_all`); admin e consultor **atribuem** padrões às empresas na seção "Tarefas padrão desta empresa" (admin em `/admin/empresas/[id]`, consultor em `/consultor/[companyId]`). Ao atribuir, nasce um `task_template` normal ligado por `task_templates.standard_task_id` — daí toda a maquinaria existente (trigger da única, `generate_daily_tasks`, timer) funciona sem mudanças. **Vínculo vivo:** editar a padrão chama `sync_standard_task(id)`, que propaga os campos-molde para os templates ligados e para as instâncias ainda `a_fazer` de todas as empresas; instâncias `iniciada`/`finalizada`/`cancelada` ficam **congeladas** (histórico). **Desvincular:** o template é desativado (`active=false`, para de gerar/atualizar) e as instâncias `a_fazer` são removidas; as finalizadas permanecem. Excluir a padrão do catálogo usa `on delete set null` — as tarefas já atribuídas permanecem, só perdem o vínculo vivo.

**Detalhamento do gráfico (Passo 17):** no dashboard, as barras do gráfico "tempo por empresa" são clicáveis — abrem um painel lateral com as tarefas que compõem aquele tempo (título, responsável, status, tempo), ordenadas da que mais consumiu para a menos, com o total batendo a barra. A `getCompanyTimeBreakdown(companyId, period)` usa o mesmo filtro por `task_date` do dashboard. O drill-down só liga quando `drilldownPeriod` é passado (o gráfico reaproveitado no detalhe do colaborador não passa, então lá as barras não são clicáveis).

**Correção de tempo pelo admin (Passo 16):** o admin pode corrigir o `total_seconds` de uma tarefa (casos de esquecer de pausar/finalizar o timer) no detalhe do responsável (`/admin/colaboradores/[id]`), em cada tarefa. A função `admin_adjust_time(task, novo_total, motivo)` (SECURITY DEFINER, checa `is_admin()`) fecha intervalos abertos, **reconcilia os `time_entries`** (insere um intervalo com o delta para a soma bater com o novo total, evitando que `timer_pause`/`timer_finish` sobrescrevam a correção) e registra em `time_adjustments` (quem, quando, valor anterior/novo, motivo). Um selo "tempo ajustado" com o histórico aparece na tarefa. Dashboards e resumos leem `total_seconds`, então refletem a correção na hora.

**Autoatribuição (Passo 14):** além da gestão, admin e consultor podem assumir trabalho operacional. O admin pode se atribuir como responsável de empresas (em `company_consultants`) e de tarefas (no `collaborator_id`); o consultor pode se atribuir como responsável de tarefas apenas. Quando executam, usam o mesmo timer do colaborador, via a área **"Meu Trabalho"** (reaproveita as telas `/colaborador/*`). Não exigiu migration: o RLS já permitia executor de qualquer cargo, e o isolamento por colaborador (`ti_select`: `collaborator_id = auth.uid()`) continua impedindo que um colaborador veja a tarefa que o admin/consultor atribuiu a si.

---

## 3. Modelo de dados (já aplicado no Supabase)

Projeto Supabase: `odpcgeiaikdvpoydcfyu` (CRM/Timer - Monvatti).

- **profiles** — extende `auth.users`; guarda `full_name`, `email`, `role`.
- **companies** — clientes; guarda `whatsapp_contact_id` (o contactId do grupo na Digisac) e `whatsapp_group_name`.
- **company_consultants** — vínculo empresa ↔ consultor (atribuído pelo admin).
- **task_templates** — o molde da tarefa. `kind` = `unica` ou `diaria`. Para diárias, `weekdays` (array 0-6, 0=domingo) define a recorrência. `due_time` é o horário-limite.
- **task_instances** — a execução concreta (o que o colaborador vê e cronometra). Tem `status`, `due_at`, `task_date`, `total_seconds`, `completion_note`.
- **time_entries** — cada intervalo play→pause (registro preciso de tempo).
- **activity_log** — registro de atividades por empresa; toda finalização entra aqui.

**Vínculo colaborador ↔ empresa é DERIVADO:** o colaborador "pertence" a uma empresa enquanto tiver ao menos uma `task_instance` atribuída a ele nela. Não há tabela de atribuição de colaborador.

### Automações no banco
- Trigger `on_auth_user_created` → cria profile `pending` no registro.
- Trigger `trg_unique_template` → ao criar template `unica`, gera a instância na hora.
- Função `generate_daily_tasks(date)` → gera as instâncias das tarefas diárias do dia. **Ainda falta agendar com pg_cron** (ver seção 7).

### Segurança (RLS)
Todas as tabelas têm RLS ativo. Funções auxiliares `is_admin()`, `my_consultant_companies()`, `my_collaborator_companies()` (todas `SECURITY DEFINER`). O isolamento por colaborador é garantido na política `ti_select` (`collaborator_id = auth.uid()`).

---

## 4. O que já está construído (fundação)

```
crm-timer/
├── package.json, tsconfig, tailwind, postcss, next.config   ← configs
├── .env.local.example                                        ← variáveis
├── supabase/migrations/                                      ← 3 migrations (aplicadas)
├── docs/ESPECIFICACAO.md                                     ← este arquivo
└── src/
    ├── middleware.ts                  ← mantém sessão, protege rotas
    ├── lib/
    │   ├── supabase-browser.ts        ← client browser
    │   ├── supabase-server.ts         ← client server
    │   └── types.ts                   ← tipos (stub; gerar completo depois)
    ├── components/
    │   ├── LogoutButton.tsx
    │   └── guardRole.ts               ← guarda de cargo (server)
    └── app/
        ├── layout.tsx, globals.css
        ├── page.tsx                   ← roteia por cargo
        ├── login/page.tsx             ← login + registro  ✅ funcional
        ├── pending/page.tsx           ← tela de espera     ✅ funcional
        ├── admin/page.tsx             ← placeholder
        ├── consultor/page.tsx         ← placeholder
        └── colaborador/page.tsx       ← placeholder
```

Auth, roteamento por cargo e proteção de rotas já funcionam de ponta a ponta. Os três painéis validam o cargo correto, mas o conteúdo é placeholder.

---

## 5. O que falta construir (frontend)

### 5.1 Painel do Administrador
- **Dashboards** (cards clicáveis): contagem de tarefas a fazer / iniciadas / finalizadas / canceladas. Ao clicar, abre a lista das tarefas daquele status.
- **Outras métricas úteis:** tempo total gasto no período, tarefas atrasadas, ranking de empresas por tempo.
- **Cadastro de usuários:** lista de profiles; atribuir/alterar cargo (`pending` → consultor/colaborador/admin).
- **Cadastro de empresas:** nome + vínculo ao grupo WhatsApp (dropdown com grupos da Digisac — ver 5.4). Atribuir consultor(es) à empresa.
- **Cadastro de tarefas:** título, descrição, instruções, empresa, colaborador, tipo (única/diária), dias da semana (se diária), prazo. Cria um `task_template`.
- **Resumos por colaborador:** tempo total gasto, % de tarefas concluídas, etc.

### 5.2 Painel do Consultor
Igual ao admin em cadastro de tarefas, mas:
- Só lista/usa as empresas atribuídas a ele (RLS já garante).
- Sem dashboards gerais.
- Pode ver progresso das tarefas das suas empresas.

### 5.3 Painel do Colaborador
- **Tela inicial:** lista das empresas dele (derivadas das tarefas). Para cada empresa: barra de progressão (% concluído), nº de tarefas pendentes, alerta de atrasadas / perto do prazo.
- **Tela da empresa:** progressão (feitas × não feitas) + lista de tarefas com ordenação (mais antiga, mais recente, próximas do prazo).
- **Tela da tarefa:** título, descrição, instruções, prazo. **Timer** com play/pause/finalizar. Cada play→pause grava um `time_entry`; `total_seconds` é a soma. Ao finalizar: caixa de texto para o resumo, com opção "enviar ao grupo WhatsApp" ou "apenas salvar no registro".

**Tudo escopado ao colaborador logado** — ele nunca vê tarefas de outros, mesmo na mesma empresa.

### 5.4 Lógica do timer (detalhe importante)
- Ao dar **play**: insere `time_entry` com `started_at = now()`, status da tarefa → `iniciada`.
- Ao dar **pause**: fecha o `time_entry` aberto (`ended_at = now()`, `seconds` = diferença), soma em `total_seconds`.
- Ao **finalizar**: fecha qualquer intervalo aberto, status → `finalizada`, salva `completion_note`, cria `activity_log`, e (se escolhido) envia ao WhatsApp.
- **Persistência:** como cada intervalo é gravado no banco, fechar a aba não perde o tempo já contabilizado. Um intervalo aberto (sem `ended_at`) pode ser recuperado ao reabrir.

---

## 6. Integração WhatsApp (Digisac)

Validado e funcionando. Para enviar a um grupo:

```
POST {DIGISAC_DOMAIN}/api/v1/messages
Authorization: Bearer {DIGISAC_TOKEN}
Content-Type: application/json
{
  "text": "<resumo da tarefa>",
  "contactId": "<companies.whatsapp_contact_id>",
  "serviceId": "{DIGISAC_SERVICE_ID}",
  "origin": "bot",
  "dontOpenTicket": true
}
```

**Importante:** usar `contactId` (ID interno do contato/grupo na Digisac), NÃO o `number` com `@g.us` — a API confunde com contato individual.

**Listar grupos** (para o dropdown de cadastro de empresa): `GET /api/v1/contacts?type=group`. A API pagina em 15 e ignora `limit`; é preciso varrer páginas com `page=N` até juntar todos. Cada grupo traz `id` (contactId), `name` e `data.number`.

**Onde rodar o envio:** numa Edge Function do Supabase ou numa Route Handler do Next.js (server-side), nunca no client (o token não pode vazar). Recomendado: Edge Function `send-whatsapp` que recebe `{ companyId, message }`, busca o `whatsapp_contact_id` da empresa e dispara.

---

## 7. Pendências de infraestrutura

- ✅ **`generate_daily_tasks` agendada** com pg_cron (migration `0007`). Job `generate-daily-tasks`, schedule `5 3 * * *` (03:05 UTC = 00:05 BRT, UTC-3 fixo). A função é idempotente (`on conflict (template_id, task_date) do nothing`), então re-execuções não duplicam instâncias.
  ```sql
  select cron.schedule('generate-daily-tasks', '5 3 * * *',
    $$ select generate_daily_tasks(current_date); $$);
  ```
- **Gerar tipos TypeScript completos** do banco:
  ```
  npx supabase gen types typescript --project-id odpcgeiaikdvpoydcfyu > src/lib/types.ts
  ```
- **Trocar o token da Digisac** (o usado nos testes foi exposto no chat).
- **Configurar variáveis na Vercel** (as do `.env.local.example`).

---

## 8. Como rodar localmente

```bash
npm install
cp .env.local.example .env.local   # preencher com URL + anon key reais
npm run dev
```

Primeiro acesso: registre-se, depois promova seu próprio usuário a `admin` direto no Supabase (tabela `profiles`, campo `role`). A partir daí você atribui os demais cargos pela própria interface.

---

## 9. Ordem sugerida de construção

1. Setup local + gerar tipos + criar o primeiro admin
2. Painel admin: cadastro de usuários (atribuir cargo) → empresas → tarefas
3. Edge Function de listar grupos Digisac (para o dropdown de empresa)
4. Painel colaborador: empresas → tarefas → **timer** → finalização
5. Edge Function de envio WhatsApp (no finalizar)
6. Painel consultor (reaproveita componentes do admin, escopado)
7. Dashboards do admin + resumos por colaborador
8. Agendar pg_cron + testes de recorrência
