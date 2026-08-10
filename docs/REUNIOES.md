# Módulo de Reuniões (Google Calendar)

Integração do sistema com o Google Calendar. **O sistema é a fonte da verdade**
da reunião; o Google é destino/cópia. Construído em fatias, uma por vez.

## Escopo OAuth (decidido)

Escopo pedido: `calendar.events.owned` (+ `openid` + `email` só para identidade).
Verificado na documentação atual do Google (03/08/2026):

- **`calendar.events.owned`** = "See, create, change, and delete events on Google
  calendars you own." O verbo **See** é LEITURA. Ou seja, este escopo já permite
  **ler** os eventos — a importação da Fatia 2 **não exige ampliar escopo**, e
  ninguém que já conectou precisará reconectar.
- **Recorte por AGENDA que a conta POSSUI, não por "evento que a conta criou".**
  É mais amplo do que vínhamos assumindo: lê todos os eventos das agendas do
  usuário (primária + secundárias que ele possua), inclusive eventos que TERCEIROS
  criaram e para os quais ele só foi convidado.
- O campo **`visibility`** do evento (`default` / `public` / `private` /
  `confidential`) é **legível** em `events.get`/`events.list` — dá para respeitar
  privacidade. Atenção: `default` NÃO significa público (é o padrão da agenda);
  a maioria dos eventos pessoais fica em `default`.
- `creator.self` / `organizer.self` (booleanos) dizem se foi a própria conta que
  criou/organizou o evento.

## Fatia 1 — CRIAR e LISTAR (pronta, validada no navegador)

- **Página dedicada `/agenda`** (lar do módulo, na navegação de todos os cargos):
  lista de reuniões agrupada por dia, próximas primeiro. Visão de calendário/grade
  vem depois.
- **Aba "Reuniões" na central da empresa**: reuniões daquela empresa, com o botão
  de criar já pré-vinculado a ela.
- **Criar reunião**: empresa (obrigatória), título, tipo (meet / presencial no
  escritório / presencial no cliente), início/fim em horário de Brasília,
  descrição, participantes internos. Convites vão para os e-mails dos perfis; o
  **cliente NÃO é convidado**. Tipo `meet` → pede link do Meet ao Google.
- **Quem cria**: admin, consultor e colaborador, cada um nas empresas que alcança.
- **Regras mantidas**: grava no banco PRIMEIRO, depois tenta o Google; se não há
  conta conectada ou o Google falha, a reunião é criada assim mesmo com aviso e
  `google_sync_status` registrado (NUNCA se perde a reunião); o evento nasce na
  agenda de quem cria (token dele); token só no servidor; **nenhuma leitura de
  agenda nesta fatia**.
- **Aviso de conflito (não é bloqueio)**: ao escolher horário, avisa se algum
  participante (ou o criador) já tem reunião **no sistema** naquele intervalo. A
  verificação cobre só reuniões do sistema — eventos direto no Google ainda não
  são vistos (muda na Fatia 2).
- **Visibilidade**: todos os usuários internos veem as reuniões uns dos outros,
  com detalhes, inclusive de qual empresa. O portal do cliente fica intocado.

## Fatia 1.1 — EDITAR, EXCLUIR e ENVIAR AO GOOGLE (pronta)

Ainda **sem** visão de calendário e **sem** importação (essas são fatias
seguintes). O que entrou:

### Permissão: só QUEM CRIOU edita/exclui (decisão tomada)

- **Só o criador** edita, exclui e sincroniza a própria reunião — é quem tem o
  token Google do evento. Para os demais, os botões ficam **desabilitados e
  EXPLICADOS** ("só quem criou pode editar/excluir — o evento pertence à agenda
  Google de quem criou"), nunca escondidos sem motivo.
- **Por que o admin NÃO edita/exclui pelo fluxo normal:** por construção (sem
  `service_role`, ver [[google-calendar-etapa1]]) o admin não tem o token Google
  do outro. Editar/excluir no banco deixaria o evento real intocado — o
  desencontro silencioso que o produto evita. A migration 0048 **alinhou o RLS**:
  `meetings_update`/`meetings_delete`/`mp_write` passaram a exigir
  `created_by = auth.uid()` (antes o update permitia `is_admin()` também).
- **Caso ÓRFÃO** (criador saiu / conta Google se foi): o admin tem uma saída
  separada e explícita — **"Remover do sistema"** (função `admin_delete_meeting`,
  SECURITY DEFINER, admin-only). Remove SÓ do sistema e **assume não tocar no
  Google**; a UI avisa que o evento pode permanecer na agenda de quem criou.
  Não existe "editar como admin".

### Editar

- Mesmos campos da criação. Salva no banco e faz **PATCH** no evento do Google
  (`sendUpdates=all`, os convidados são avisados). Mudança de participantes
  reflete nos convidados. O **aviso de conflito** roda também na edição (exclui a
  própria reunião do cálculo).
- **Troca de tipo trata o Meet:** virou `meet` → gera a conferência; deixou de
  ser `meet` → remove (`conferenceData: null`).
- Mesma filosofia da criação: se o Google falhar, a edição no banco **permanece**
  com `google_sync_status`/aviso — a reunião nunca se perde. Reunião criada
  offline e depois editada é **criada** no Google na hora (não havia evento).

### Excluir (decisão tomada: "excluir e avisar")

- Pede **confirmação** explícita (é destrutivo e avisa convidados).
- Apaga o evento no Google (`sendUpdates=all`) e depois a reunião no sistema.
  **404/410 = sucesso** (já não existe lá — não trava o usuário).
- **Se o Google falhar (fora 404): exclui do sistema MESMO ASSIM e avisa** que o
  evento pode ter permanecido na agenda. Trade-off aceito conscientemente: some
  da lista, mas perde-se o `google_event_id` → o evento pode virar órfão
  permanente no Google. (A alternativa — manter no banco e pedir retry — foi
  descartada pelo usuário.)

### Enviar para o Google Calendar (sincronizar depois)

- Reunião com `google_sync_status` em `nao_conectado`/`falhou` ganha a ação
  **"Enviar para o Google Calendar"**, disponível **só para o criador** e **só se
  ele estiver conectado agora**. Cria o evento e atualiza o status. Fecha o buraco
  do fallback: uma reunião criada com o Google desconectado não fica órfã para
  sempre.

### Mensagens de erro e cache

- Erros **classificados** (permissão / campo inválido / falha do Google / sessão),
  nunca chutando a causa — mesma disciplina do fix da 0047. Cache revalidado
  (`router.refresh`) após editar/excluir/enviar; o banner de resultado fica ACIMA
  da lista (o cartão some no refresh após excluir).

## Visão de calendário `/agenda` (pronta, validada no navegador)

A lista agrupada por dia da Fatia 1 deu lugar a um **calendário Dia / Semana / Mês**
(commit `0413427` + overhaul de UX `b1bd807`/`6ce1b78`):

- Grade com linhas de 30 min que **preenche a viewport** (altura medida no pai via
  CSS var, scrollbar compensada), painel lateral de pessoas **retrátil**, e modal
  de detalhe com **rodapé fixo**.
- **Arrastar para reagendar** — mover e redimensionar, sem biblioteca; ao soltar
  roda a MESMA verificação de conflito (todos os participantes + o criador) e, se
  houver sobreposição, **pede confirmação sem bloquear** (feedback otimista, revertido
  ao cancelar).
- **Cache por janela** (`Map<intervalo, itens>`) com pré-busca dos vizinhos para a
  navegação ser instantânea; cada leitura busca só o intervalo visível (+ folga),
  nunca a base inteira. A grade renderiza reuniões do sistema **e** eventos importados
  (Fatia 2) unidos.
- Filtro de pessoas: reunião do sistema aparece se alguém ligado é criador/participante;
  evento importado aparece se o DONO da agenda está ligado.

## Fatia 2a — aba "Reuniões" no PORTAL DO CLIENTE (pronta, migration `0049`)

O cliente passa a ver as reuniões da própria empresa no portal, com **curadoria
estrita**: modelo **opt-out** (`meetings.client_hidden`, default false = aparece),
alternável pela equipe (criador/admin/consultor) via `setMeetingClientHidden`. O
cliente vê título/horário/tipo — nunca a lista de participantes internos. Eventos
importados do Google (Fatia 2b) **não** entram no portal.

## Fatia 2b — IMPORTAÇÃO da agenda Google + conflito real (pronta, migration `0050`)

Resolve o dilema de privacidade registrado antes de construir:

- Tabela **`imported_google_events`** (espelho **só-leitura** da agenda de cada
  interno) alimentada por `syncMyGoogleCalendar` (auto ao abrir a `/agenda` se a
  última sync for velha, + botão manual). **Ninguém sincroniza agenda alheia:** o
  token e a escrita derivam de `auth.uid()`, sem `service_role`.
- **Privacidade resolvida:** evento que o usuário **não criou** (ou `visibility`
  privada) entra como **"Ocupado"** — o banco **esconde o título** (`title` null →
  a grade mostra "Ocupado"). Detalhe só nas reuniões do sistema e nas que ele mesmo
  criou. `imported_events_range()` (SECURITY DEFINER) já devolve assim; `anon` nunca
  recebe nada.
- **Detecção de conflito** passou a unir sistema + Google (`checkMeetingConflicts`),
  então o aviso de sobreposição cobre também eventos criados direto no Google.
- As reuniões DO SISTEMA são **descartadas** da importação (`toImportRow` faz
  `if (systemIds.has(ev.id)) return null`) — senão apareceriam duplicadas. É por isso
  que o status delas exige o read dirigido da Fatia B (abaixo), não a `events.list`.

## Fatia A — RESERVAR SALA do escritório (pronta, migration `0056`)

Duas salas (Grande / Pequena), escolhíveis só em `presencial_escritorio`
(`meetings.room`). Mecanismo: **convidar o endereço de agenda da sala como
participante** do evento na agenda de quem cria — um só evento-fonte, sem novo
escopo OAuth. O `accepted`/`declined` DA SALA é a confirmação/negação real da reserva
(choque de horário → decline) e flui pelo mesmo read das Fatias B/C. Os endereços são
config de servidor (`src/lib/rooms.ts`, `server-only`) — não vão ao banco nem ao
cliente; aqui mora só o rótulo. **A verificar no teste:** se essas agendas de sala
auto-aceitam convites (senão o status fica `needsAction` e a reserva não "confirma"
sozinha).

## Fatia B — LER o responseStatus dos convidados (pronta, migration `0057`)

Quem aceitou/recusou o convite. **Princípio invertido só aqui:** para respostas, o
**Google é a verdade**; o banco guarda um **espelho display-only**.

- `getCalendarEvent` faz **`events.get` por `google_event_id`** (não a `events.list`
  da importação, que descarta as reuniões do sistema). Só o **CRIADOR** consegue —
  só ele tem o token da agenda onde o evento vive.
- `refreshMeetingResponses(meetingId)` grava o espelho: `meeting_participants.response`
  (por `user_id`, casando attendee-email→id via `directoryEmailById` — e-mail nunca
  vai ao cliente) e `meetings.room_response` / `responses_synced_at`. Os demais internos
  só **LEEM**; o espelho nunca é autoridade. `EventGone` (attendee/evento sumiu no
  Google) avisa sem quebrar.
- Domínio dos valores = os do Google (`accepted`/`declined`/`tentative`/`needsAction`);
  `null` = ainda não lido / participante fora do evento.

## Fatia C — quadro de status no cartão (pronta, sem migration nova)

No `MeetingCard`: bolinha de status por participante (accepted=emerald, declined=red,
tentative=amber, needsAction=slate; `null` não desenha nada, para diferenciar "não lido"
de "lido e sem resposta") + bolinha na `RoomBadge` + painel-resumo (contagem por status
= legenda) com "lido há X" e botão **"Atualizar status"** (só do criador + Google
conectado; não-criador vê "Só {criador} atualiza"). Usa as colunas da 0057.

## Fatia D — participante ACEITA/RECUSA dentro do CRM (pronta, migration `0058`)

Pedida depois de A/B/C ("não achei a função de aceitar/recusar" — A/B/C eram só
LEITURA de resposta; responder era no Google Agenda). Botão Aceitar/Talvez/Recusar,
só para quem **é participante** (o criador é organizador, sem RSVP) e tem Google
conectado.

- O write vai ao Google com o token **do próprio participante** (`setMyResponseStatus`:
  GET cru → muda só o attendee `self` → PATCH com a lista inteira; `sendUpdates=none`,
  o Google já avisa o organizador). Mesma agenda/mesmo `google_event_id` — cada um age
  só na própria cópia, sem `service_role`.
- Espelho: RPC **`set_my_meeting_response`** (SECURITY DEFINER, migration `0058`) grava
  `response` SÓ da linha `(meeting, auth.uid())` — contorna a `mp_write` criador-only
  sem afrouxá-la. Se o espelho falhar, a resposta no Google já valeu e o próximo
  "Atualizar status" reconcilia.
- Depende do e-mail do perfil casar com a conta Google conectada (`self=true`); senão,
  erro claro.

### Correção: o espelho de status "não persistia" na `/agenda`

Sintoma relatado: os status sumiam ao **reabrir** o evento; era preciso "Atualizar
status" toda vez. **Diagnóstico:** o BANCO persistia certo (`meeting_participants.response`
/ `responses_synced_at` gravados; RLS `mp_write` `for all` autoriza o criador). O
problema era só no cliente do calendário — `Calendar.tsx` mantém um `cache` da sessão
e o modal `detail` renderiza o cartão a partir dele. O "Atualizar status" / RSVP
guardava o valor só no estado LOCAL do `MeetingCard` (de propósito, para não fechar o
modal via `onResult`), mas **nunca no cache do pai**; fechar+reabrir remontava o cartão
com props velhos (`response=null`) — só um reload de página (que relê o banco) trazia o
valor. **Fix:** `MeetingCard` ganhou o callback opcional `onResponses(meetingId, patch)`,
disparado no sucesso do refresh (byUser+room+syncedAt) e do RSVP (só o próprio user);
`Calendar` implementa `applyResponses`, que espelha o patch em TODAS as janelas do cache
E no `detail` aberto, **sem fechar o modal** (≠ `invalidate`). `MeetingList` (central da
empresa) omite o callback — já dá `router.refresh`, que relê do banco. Sem migration.

## Fora de escopo / a fazer

- **Multi-agenda:** hoje só a agenda **primária** de cada interno é lida/importada.
- **Teste ponta-a-ponta** da importação e das respostas com a agenda Google real do
  usuário (as Fatias A–D estão no ar aguardando validação no navegador).
