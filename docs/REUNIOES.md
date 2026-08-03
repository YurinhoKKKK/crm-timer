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

## Fatia 1 — CRIAR e LISTAR (em construção)

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

## Fatia 2 — IMPORTAÇÃO de eventos do Google (futuro)

Ainda NÃO construída. Registro das **decisões pendentes** para não se perder:

### Privacidade × visibilidade total entre colegas (a resolver antes de importar)

O achado da Tarefa 0 muda o cálculo de privacidade que havíamos combinado:

- Como o escopo lê a **agenda inteira** da conta, a importação traz também
  eventos que **terceiros criaram** e para os quais o usuário só foi convidado —
  cujos títulos ele **não controla**.
- Isso **enfraquece** a proteção que havíamos combinado (marcar como "particular"
  no Google): ela cobre o que a pessoa CRIA, não o que CAI na agenda dela.
- Combinado com a nossa regra de **visibilidade total entre colegas**, um título
  alheio e sensível poderia ficar exposto a toda a equipe.

**Direção provável (a confirmar na Fatia 2):** importar tudo para efeito de
**DETECÇÃO DE CONFLITO**, mas exibir aos colegas apenas **"ocupado"** nos eventos
que o usuário **não criou** (usando `creator.self` / `organizer.self`), mostrando
detalhes só nas reuniões **criadas pelo sistema** e nas que **ele próprio criou**.
Considerar também tratar `visibility != public` como "ocupado, sem detalhes".

Fora de escopo por enquanto: tela de calendário/grade, edição/exclusão
sincronizada, reserva de salas, aba de reuniões no portal do cliente.
