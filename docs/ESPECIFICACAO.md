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

**Tarefas padrão (Passo 15):** catálogo global de moldes reutilizáveis na tabela `standard_tasks` (título, descrição, instruções, `kind`, `weekdays`, `due_time`). O admin cria/edita/exclui o catálogo (aba "Tarefas Padrão" em `/admin/tarefas`; RLS `st_admin_all`); admin e consultor **atribuem** padrões às empresas na seção "Tarefas padrão desta empresa" (admin em `/admin/empresas/[id]`, consultor em `/consultor/[companyId]`). Ao atribuir, nasce um `task_template` normal ligado por `task_templates.standard_task_id` — daí toda a maquinaria existente (trigger da única, `generate_daily_tasks`, timer) funciona sem mudanças. **Ocorrência no dia da atribuição:** a única sempre gera a instância de hoje (via `trg_unique_template`, `start_date` = hoje); a diária gera a instância de hoje apenas se hoje for um dos `weekdays` **e** ainda estivermos dentro do `due_time` (função `generate_template_today` na migration 0013, disparada pelo gatilho `trg_diaria_template_today` na migration 0014; decisão avaliada no fuso de Brasília) — senão segue a recorrência normal do `generate_daily_tasks`. **Vínculo vivo:** editar a padrão chama `sync_standard_task(id)`, que propaga os campos-molde para os templates ligados e para as instâncias ainda `a_fazer` de todas as empresas; instâncias `iniciada`/`finalizada`/`cancelada` ficam **congeladas** (histórico). **Desvincular:** o template é desativado (`active=false`, para de gerar/atualizar) e as instâncias `a_fazer` são removidas; as finalizadas permanecem. Excluir a padrão do catálogo usa `on delete set null` — as tarefas já atribuídas permanecem, só perdem o vínculo vivo.

**Detalhamento do gráfico (Passo 17):** no dashboard, as barras do gráfico "tempo por empresa" são clicáveis — abrem um painel lateral com as tarefas que compõem aquele tempo (título, responsável, status, tempo), ordenadas da que mais consumiu para a menos, com o total batendo a barra. A `getCompanyTimeBreakdown(companyId, period)` usa o mesmo filtro por `task_date` do dashboard. O drill-down só liga quando `drilldownPeriod` é passado (o gráfico reaproveitado no detalhe do colaborador não passa, então lá as barras não são clicáveis).

**Correção de tempo pelo admin (Passo 16):** o admin pode corrigir o `total_seconds` de uma tarefa (casos de esquecer de pausar/finalizar o timer) no detalhe do responsável (`/admin/colaboradores/[id]`), em cada tarefa. A função `admin_adjust_time(task, novo_total, motivo)` (SECURITY DEFINER, checa `is_admin()`) fecha intervalos abertos, **reconcilia os `time_entries`** (insere um intervalo com o delta para a soma bater com o novo total, evitando que `timer_pause`/`timer_finish` sobrescrevam a correção) e registra em `time_adjustments` (quem, quando, valor anterior/novo, motivo). Um selo "tempo ajustado" com o histórico aparece na tarefa. Dashboards e resumos leem `total_seconds`, então refletem a correção na hora.

**Listagem de marcas (Passo 22):** um novo tipo de tarefa, sempre **pontual**, para registrar quais marcas pesquisar em quais marketplaces (Mercado Livre, Shopee, Amazon), se há **cálculo de margem** e, em caso positivo, a **alíquota** de imposto do cliente. O sistema apenas **armazena** — não calcula nada (o colaborador calcula por fora). Modelagem (migration 0020→`0022_listing_tasks`): em vez de poluir o enum `task_kind`, a listagem grava `kind='unica'` (reaproveitando o trigger `trg_unique_template`, que já cria a instância na hora com `due_at` no fuso de Brasília — sem trigger novo) e é distinguida pela coluna `task_templates.template_type` (enum `padrao`|`listagem`). Campos próprios no template: `listing_needs_margin`, `listing_tax_rate` (0–100), `listing_marketplaces` (`listing_marketplace[]`); as marcas (várias) ficam na tabela filha `listing_brands`. RLS de `listing_brands` herda a visibilidade do template (leitura) e restringe a gestão a admin/consultor da empresa. No front: subformulário compartilhado `ListingFields` (usado no cadastro e na edição de tarefa) e `ListingSummary` (leitura no detalhe da tarefa do colaborador/consultor); a lista de tarefas do admin rotula/filtra o tipo "Listagem de marcas".

**Finalização da listagem (Passo 22.1):** a listagem **não** finaliza com o "resumo do que foi feito" das tarefas comuns — o entregável são os **links das planilhas**. Migration `0023_listing_results`: para cada combinação **marca × marketplace** da tarefa, o colaborador informa OU o link OU uma justificativa de "não feita" (tabela `listing_results` com constraint `link XOR not_done_reason`; unique por `task_id, brand_id, marketplace`; RLS: leitura pela hierarquia da `task_instances`, escrita pelo executor). O resumo em texto vira **opcional** e, se preenchido, segue a escolha "enviar ao WhatsApp / só registrar". A finalização usa a RPC atômica `timer_finish_listing(p_task, p_note, p_send, p_results jsonb)` — fecha o intervalo, soma o tempo, marca finalizada, grava os resultados (substituindo) e só cria `activity_log`/WhatsApp se houver resumo. No front, o `Timer` mostra a captura por combinação quando a tarefa é listagem; `ListingResultsView` exibe os links clicáveis (ou a justificativa) na tarefa finalizada (colaborador e consultor). Esses links alimentam a aba "Minhas Listagens" (passo 23) e são visíveis ao cliente (passo 25); o resumo em texto não.

**Mensagem de WhatsApp da listagem (Passo 22.2):** ao finalizar uma listagem com "enviar ao WhatsApp", a mensagem ao grupo inclui **os links** (o entregável), não só o resumo. `buildListingWhatsappMessage(note, results)` (em `lib/listing.ts`) monta: resumo opcional no topo, depois as listagens **agrupadas por marca** (nome em `*negrito*` do WhatsApp), com cada marketplace e seu link OU a justificativa de "não feita" — todas as combinações, com quebras de linha e sem cortar links. Vale só para listagem; os outros tipos seguem enviando só o resumo (`finishTask`). Mesma integração Digisac (`send-whatsapp`, `contactId` do grupo). Testado com envio real ao grupo "Teste 1 (Yuri)".

**Aba "Minhas Listagens" (Passo 23):** a central da empresa ganha abas (`CompanyCentralTabs`, cliente com slots renderizados no servidor): "Visão geral" (a central do passo 19) e "Minhas Listagens". Esta lista **todas as entregas** de listagem daquela empresa — uma linha por marca × marketplace, com o **link clicável** (ou a justificativa de "não feita") e a data da entrega. `loadCompanyListings(companyId)` puxa por template→instância→resultado filtrando por id (escala; sem varrer tudo), com a RLS escopando admin (todas) e consultor (só as dele). O componente `CompanyListings` reaproveita os controles do sistema (`ListControls`): busca por marca, filtro por marketplace, ordenação (recentes/antigas/marca) e "ver mais" (paginação). Presente em admin e consultor.

**Anotações da empresa (Passo 24):** seção de anotações rich text (resumos de reunião, planos de ação etc.) por empresa, com editor **TipTap** nível "Word/Notion" — toolbar com ícones (lucide-react) agrupados por seção, com desfazer/refazer, títulos H1–H3, negrito/itálico/sublinhado/tachado/código inline, cor do texto e destaque (paletas), alinhamento (esq/centro/dir/justificado), listas (marcador, numerada e checklist), citação, bloco de código, linha horizontal, **tabelas** (inserir/linhas/colunas/cabeçalho) e **imagens** por botão, **Ctrl+V (colar print)** ou **arrastar e soltar** — upload automático no bucket público `note-images`, escrita restrita à pasta `<uid>/` do autor. Links pelo padrão moderno: popover no botão (aplicar/editar/remover) e colar URL sobre texto selecionado vira link (`linkOnPaste`). Migration `0024_company_notes`: tabela `company_notes` (`content_html`, `visible_to_client` **default false** — toda anotação nasce INTERNA; só as marcadas "visível ao cliente" aparecerão no acesso do cliente, passo 25) + trigger `company_notes_audit` que registra a edição (`updated_at`/`updated_by` = "editado por X em [data]") e congela autor/empresa/criação. RLS (`cn_*`): leitura/criação por quem tem acesso à empresa (admin tudo; consultor nas dele; colaborador onde tem tarefa — vínculo derivado); edição/exclusão só do **autor** ou admin. O HTML é sanitizado com DOMPurify no ponto único de leitura (`loadCompanyNotes` em `lib/notes.ts`) antes de renderizar. No front: aba "Anotações" na central da empresa (admin e consultor, `CompanyCentralTabs` agora com 3 abas) e seção "Anotações" na tela da empresa do colaborador (`/colaborador/[companyId]`, que também serve o "Meu Trabalho"); componentes `CompanyNotes` (lista mais recentes primeiro com "ver mais", badge Interna/Visível ao cliente, CRUD) e `NoteEditor` (TipTap carregado sob demanda via `next/dynamic`).

**Autoatribuição (Passo 14):** além da gestão, admin e consultor podem assumir trabalho operacional. O admin pode se atribuir como responsável de empresas (em `company_consultants`) e de tarefas (no `collaborator_id`); o consultor pode se atribuir como responsável de tarefas apenas. Quando executam, usam o mesmo timer do colaborador, via a área **"Meu Trabalho"** (reaproveita as telas `/colaborador/*`). Não exigiu migration: o RLS já permitia executor de qualquer cargo, e o isolamento por colaborador (`ti_select`: `collaborator_id = auth.uid()`) continua impedindo que um colaborador veja a tarefa que o admin/consultor atribuiu a si.

**Admin como responsável de qualquer um (Passo 19):** os seletores de responsável passam a listar **admins** ao lado de quem já aparecia — o de empresa (consultor) lista `consultor`+`admin`, e o de tarefa (colaborador) lista `colaborador`+`admin` —, em todos os painéis (admin e consultor). Assim um admin pode ser atribuído por outro admin (ou por um consultor), não só por autoatribuição. O admin atribuído vê e executa normalmente: as policies de `task_instances`/`time_entries` já liberam por `is_admin()` (leitura/edição) e por `collaborator_id = auth.uid()` (registro de tempo). Só foi preciso a migration 0015, que amplia `profiles_select` para o **consultor** também ler perfis de `admin` (antes só `colaborador`) — necessário para os admins aparecerem no dropdown do painel do consultor e para exibir o nome do admin responsável nas listas dele.

**Reforma do Portal do Cliente (Passo 26):** o portal do passo 25 foi enriquecido **sem alterar segurança nem curadoria** — o conjunto de dados que o cliente vê continua o mesmo. Mudanças: (a) **terminologia** — "publicação/publicada" virou "listagem/listada" em todo o portal, que é como os clientes se referem à entrega; (b) **reframe do status** — o par binário "Publicada / Não publicada" foi substituído por "Listada" (com link) e "Não listada" em tom **neutro** seguida do motivo como nota editorial, porque não enviar uma listagem é **decisão de curadoria** (marca sem relevância ou pouca saída), não falha nem pendência; (c) **contadores removidos** ("X/Y publicadas" e "N marketplaces"), trocados por "Marcas" e "Listagens ativas" — a fração reintroduzia lógica de completude; (d) **ruído reduzido** — o botão cheio "Ver publicação", repetido dezenas de vezes, virou link discreto; (e) **abas** separando "Listagens" e "Atualizações do projeto"; (f) **busca e filtros** na aba Listagens (por marca, marketplace e listada/não listada), no visual dos `ListControls`; (g) **lightbox** nas imagens das atualizações (modal via React portal; a sanitização com DOMPurify continua no mesmo ponto único de leitura); (h) **contraste do tema claro** corrigido (o escuro já estava bom); (i) **identidade dos marketplaces** por cor + ícone genérico, centralizada num mapa único — **sem logos oficiais de terceiros**, decisão consciente de risco de marca (Mercado Livre `#FFE600`/`#2D3277`, Shopee `#EE4D2D`/`#FFFFFF`, Amazon `#232F3E`/`#FFFFFF` com acento `#FF9900`).

**Aba "Andamento" do Portal do Cliente (Passo 27):** primeira **nova fonte de dados** no portal desde o passo 25 — mostra movimento ("estamos trabalhando nisto" + "isto foi entregue") sem abrir a operação. Filtro exato do feed: `kind='unica'` **e** `standard_task_id IS NULL` (fora o catálogo de tarefas padrão) **e** `template_type='padrao'` (fora as listagens, que já vivem na aba própria) **e** `status IN ('iniciada','finalizada')` **e** `client_hidden = false`, sempre escopado à empresa do token. Padrão e diárias ficam de fora de propósito: são internas e repetitivas, virariam um mural de repetição para o cliente. O cliente vê **apenas** título e, nas finalizadas, a **data** de conclusão (fuso de Brasília, sem hora) — nada de `completion_note`, tempo, prazo, atraso ou responsável. A aba só aparece se houver ao menos um item. Migration adiciona `task_instances.client_hidden` (boolean, default false), com UPDATE restrito por RLS a admin e consultor da empresa; no lado interno há um toggle "ocultar do cliente" nas tarefas elegíveis. O modelo é **opt-out**: como os títulos das tarefas já são escritos pensando que serão lidos por clientes, o feed aparece automaticamente e se oculta por exceção.

**Indicador global de timer ativo (Passo 28):** peça **preventiva** contra o esquecimento de timers rodando no intervalo ou no fim do expediente — até então o sistema só tinha o remédio (correção de tempo com auditoria, passo 16). Vive no shell compartilhado, aparece em todas as telas autenticadas dos **três cargos** (admin e consultor executam via "Meu Trabalho" desde o passo 14) e some quando não há `time_entries` abertos do próprio usuário. Traz "Pausar" embutido (reaproveitando a lógica de pause existente), leva à tarefa ao clicar, e o `document.title` também exibe o timer para denunciar a aba em segundo plano. Com **2+ timers simultâneos** o indicador sinaliza com destaque, porque os intervalos paralelos contam tempo **em dobro** — impedir isso automaticamente segue em aberto. **Regra crítica de cálculo (Passo 28.1):** o tempo exibido **nunca** é acumulado por ticks; a cada tick é **derivado** de `total_seconds + (agora − started_at)`, com o `setInterval` servindo só para redesenhar — assim remontar, trocar de rota ou perder ticks (throttle de aba em segundo plano) não afeta o número. O bug real em produção (pill 00:00 com o timer real em 06:10) não era acúmulo: o pill derivava do `started_at`, mas exibia **apenas o intervalo aberto**, esquecendo o `total_seconds` da tarefa — um indicador que **subestima** o tempo é pior que nenhum, porque tranquiliza justamente quem deveria estar sendo lembrado. A correção criou `src/lib/timer.ts` como **fonte de verdade única** (`taskElapsedSeconds`, `formatClock`, `formatElapsedCompact`, `parseStartedAt`), usado tanto pelo `Timer` da tela da tarefa quanto pelo `ActiveTimerIndicator`; o pill passou a buscar `total_seconds` junto do `time_entry` aberto. `parseStartedAt` força UTC quando a string vem sem offset (senão o fuso de Brasília deslocaria o tempo em 3h). A ressincronização acontece no poll (45s), no `visibilitychange` e no `online`, para capturar pausas de outra aba. **Qualquer nova superfície que mostre tempo de tarefa deve usar esse helper**, nunca recalcular por conta própria.

**Governança do acesso do cliente + "Ver como cliente" (Passo 30):** pré-requisito do passo 31 — se a senha do portal for legível por gente de dentro, qualquer regra de autoria de mensagem é aparência. O diagnóstico achou a senha **já** com hash forte (bcrypt); o furo real era outro: ela era **escolhida e digitada** pelo admin/consultor, ou seja, quem criava a conhecia para sempre. Mudanças (migration `0032_client_portal_governance`): (a) **gestão exclusiva de ADMIN**, reforçada no banco — a policy `cpa_select` passou a exigir `is_admin()` e as funções de escrita idem, então o consultor não alcança token nem hash **nem por tela nem por query direta**; (b) **senha sorteada pelo banco** (`client_portal_gen_password`: 16 caracteres de um alfabeto de 32 sem ambiguidade — sem `i`/`l`/`o`/`1`, porque um humano transcreve isso —, ~80 bits, em grupos de 4 para ser ditável por telefone), devolvida em claro **uma única vez** no retorno de `client_portal_set` e nunca mais recuperável; (c) **auditoria** em `client_portal_audit` (criado/senha_redefinida/link_girado/revogado), **sem policy de UPDATE nem DELETE** — ninguém edita nem apaga o próprio rastro —, exposta ao admin junto do estado numa ida só por `client_portal_admin_view`; (d) **"Ver como cliente"** em `/admin/empresas/[id]/ver-como-cliente` e `/consultor/[companyId]/ver-como-cliente`: somente leitura, sem AppShell, com faixa de pré-visualização, **sem token, sem senha e sem criar sessão de portal**, autorizado por cargo dentro do banco (`client_portal_can_preview`); o consultor mantém apenas um **status somente-leitura** (existe/ativo, via `client_portal_status`, que só devolve dois booleanos). **Decisão de arquitetura que mais importa:** a curadoria foi extraída para `client_portal_payload` / `client_portal_progress_payload`, chamadas pelos **dois** caminhos (sessão do cliente e preview), e a casca visual virou `PortalView`, usada pelas duas telas — se fossem cópias, um dia divergiriam e a pré-visualização passaria a **mentir** sobre o que o cliente vê. As 2 senhas anteriores foram **mantidas** (o hash já era forte; invalidá-las derrubaria clientes sem ganho), marcadas com `password_generated=false` para a tela sugerir a troca. **Limite honesto da garantia:** um consultor/colaborador não consegue se passar pelo cliente, mas o **admin vê a senha no instante em que a gera** — admins seguem sendo a fronteira de confiança. O ganho é que usar a senha do cliente deixa de ser silencioso: como ela não é recuperável, quem a perdeu precisa **redefinir**, o que derruba o acesso do cliente e deixa linha na auditoria.

**Performance — diagnóstico e correções (Passo 29):** investigação da lentidão ao navegar. O achado que importa: **o gargalo não era query nem falta de índice**. O banco é pequeno (398 `task_instances`, 118 `companies`) e o Postgres responde instantaneamente; o custo era o **número de idas ao Supabase × latência de cada ida**, e sobretudo o **`isomorphic-dompurify` (jsdom) importado no topo de `src/lib/notes.ts`**, cobrando ~1,5s a cada **cold start** em quatro rotas — incluindo o portal do cliente. Local isso é pago uma vez (o processo do `next start` fica vivo); na Vercel, a cada cold start — o que explicava exatamente o "a Vercel é mais lenta que o local" e o caráter intermitente. Aplicado: carregador **preguiçoso memoizado** (`getNoteSanitizer`), medido em 739ms → 105ms no carregamento do módulo da rota (**−634ms por cold start**), mantendo a sanitização no **mesmo ponto único de leitura** e com o hook registrado uma única vez por processo; **região das funções da Vercel movida para `gru1` (São Paulo)**, alinhada ao Supabase em `sa-east-1`, cortando ~60% da latência de cada ida; **`guardRole` memoizado com `cache()` do React**, deduplicando a validação dentro do mesmo request sem enfraquecer a autorização; e **waterfalls desfeitos** (na central da empresa, `loadCompanyCentral` + `loadCompanyListings` + `loadCompanyNotes` passaram a rodar em `Promise.all`, 3 ondas → 1; labels em paralelo em `/admin/tarefas` e `/colaborador`). ⚠️ **A versão do `isomorphic-dompurify` deve permanecer em 2.26.0** — 2.27+ derruba a produção com `ERR_REQUIRE_ESM`. Instrumentação opcional por `PERF_LOG=1` (desligada por padrão, custo zero em produção).

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
- **`task_instances.client_hidden`** — boolean (default `false`) que tira uma tarefa do feed "Andamento" do portal do cliente (passo 27). UPDATE restrito por RLS a admin e consultor da empresa.
- **client_portal_access** — o link (`token`) e a senha (`password_hash`, bcrypt) do portal, um por empresa. Leitura **só de admin** desde o passo 30; escrita só pelas funções SECURITY DEFINER. `password_generated` distingue a senha sorteada pelo sistema da senha antiga escolhida por uma pessoa.
- **client_portal_sessions** — sessões do cliente (segredo só em hash, validade de 7 dias). RLS ligada e **sem policy nenhuma**: só as funções tocam nelas.
- **client_portal_audit** — quem gerou/redefiniu/girou/revogou o acesso e quando. Leitura só de admin; **sem policy de UPDATE nem DELETE** (rastro imutável).

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
- ✅ **Região da Vercel alinhada** para `gru1` (São Paulo), junto do Supabase em `sa-east-1` (passo 29). Configurada **pelo painel**, sem `vercel.json` — decisão consciente para não ter duas fontes de verdade. Se o projeto for recriado na Vercel, **reconfigurar a região**.
- 🔴 **Agregado do dashboard sem `.limit()` — risco de números SILENCIOSAMENTE ERRADOS.** `/admin` busca todas as `task_instances` do período e agrega em JavaScript. Hoje o volume é pequeno, mas com a recorrência diária × 118 empresas o teto padrão de linhas do PostgREST pode truncar o resultado **sem erro e sem aviso**, fazendo o dashboard exibir números errados. Não é só performance, é **correção**. Caminho: agregar no banco via RPC, como já se faz em `company_overview`.
- ⚠️ **`isomorphic-dompurify` fixado em 2.26.0** — não subir. A 2.27+ derruba a produção com `ERR_REQUIRE_ESM`.
- ⏸️ **Índices adicionais em `task_instances`**: não criar por ora. Com o volume atual o seq scan é mais rápido e `idx_task_instances_status` é quase inútil (baixa cardinalidade). Revisitar quando o volume justificar.
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
