# Roteiro de construção — prompts para o Claude Code

Copie e cole cada prompt no Claude Code **na ordem**. Construa uma peça por vez, teste no navegador, e só então avance. Não pule etapas — cada uma depende da anterior.

---

## Identidade visual (cole isto uma vez, logo no início)

```
A identidade visual deste projeto usa a paleta da marca Monvatti, já 
configurada em tailwind.config.ts:

- risd (#3145FF) — azul elétrico, é o ACENTO PRINCIPAL (botões primários, 
  links ativos, destaques, barras de progresso)
- chrysler (#001AD8) — azul profundo, para hover de botões e ênfase forte
- gunmetal (#2B333B) — escuro de superfície (texto principal, sidebars, headers)
- platinum (#DFDCDB) — cinza claro (bordas, divisores, fundos sutis)
- paper (#F5F5F4) — fundo geral das páginas

Diretrizes de estilo para TODAS as telas que você criar:
- Fundo das páginas: paper. Superfícies/cards: branco com borda platinum.
- Ações primárias: fundo risd, texto branco, hover chrysler.
- Texto principal em gunmetal; texto secundário em gunmetal/60.
- Cantos arredondados (rounded-lg/xl), sombras sutis, espaçamento generoso.
- Visual limpo e profissional, tipo ferramenta SaaS. Sem emojis nos botões.
- Sempre responsivo (funciona no celular) e com foco de teclado visível.

Aplique essa identidade de forma consistente. Confirme que entendeu.
```

---

## PASSO 1 — Tipos TypeScript (Feito)

```
Gere os tipos TypeScript completos do banco com o Supabase CLI e substitua 
o stub em src/lib/types.ts. O project-id é odpcgeiaikdvpoydcfyu. Se pedir 
login, me avise o comando a rodar. Depois confirme que o projeto compila.
```

---

## PASSO 2.1 — Admin: cadastro de usuários (Feito)

```
Construa, no painel admin (src/app/admin), a tela de gestão de usuários:
- Lista todos os profiles (nome, email, cargo atual).
- Permite ao admin alterar o cargo de cada um: pending, consultor, 
  colaborador, admin (um <select> que salva na hora).
- Destaque visual para usuários "pending" (aguardando liberação).
- Use a identidade visual da marca.
Teste que alterar um cargo persiste no banco e reflete no acesso da pessoa.
```

## PASSO 2.2 — Admin: cadastro de empresas (Feito)

```
Agora a gestão de empresas no painel admin:
- Lista as empresas (nome, grupo WhatsApp vinculado, consultor responsável).
- Botão "Nova empresa": formulário com nome da empresa.
- Campo para vincular o grupo de WhatsApp: por enquanto, um input de texto 
  simples para o whatsapp_contact_id e whatsapp_group_name (o dropdown 
  automático da Digisac vem no passo 3).
- Permite atribuir um ou mais consultores à empresa (grava em 
  company_consultants).
Teste criar uma empresa e atribuir um consultor.
```

## PASSO 2.3 — Admin: cadastro de tarefas (Feito)

```
Agora o cadastro de tarefas no painel admin. Cria registros em 
task_templates:
- Campos: título, descrição, instruções (textarea), empresa (select), 
  colaborador (select de profiles com role=colaborador), tipo 
  (única ou diária).
- Se "diária": mostrar seleção dos dias da semana (dom a sáb → array 
  weekdays 0-6) e um horário-limite (due_time).
- Se "única": um campo de data (start_date) e horário-limite.
- Lembre: ao salvar, os triggers do banco já geram as task_instances 
  automaticamente (única na hora; diária via generate_daily_tasks).
Teste criar uma tarefa única e confirmar que a task_instance apareceu.
```

---

## PASSO 3 — Edge Function: listar grupos da Digisac (Feito)

```
Crie uma Supabase Edge Function chamada "digisac-groups" que lista os 
grupos de WhatsApp da Digisac para o dropdown de cadastro de empresa.

Detalhes da API Digisac (ver docs/ESPECIFICACAO.md seção 6):
- GET {DIGISAC_DOMAIN}/api/v1/contacts?type=group
- Header: Authorization: Bearer {DIGISAC_TOKEN}
- A API pagina de 15 em 15 e IGNORA o parâmetro limit. É preciso varrer 
  páginas com page=1, page=2... até cobrir todos (campo total/lastPage 
  na resposta).
- Para cada grupo retorne: id (que é o contactId), name, data.number.
- Use as variáveis de ambiente DIGISAC_DOMAIN e DIGISAC_TOKEN (configure 
  como secrets da Edge Function, NUNCA no código).

Depois, no formulário de empresa (passo 2.2), troque os inputs de texto 
por um dropdown que chama essa função e lista os grupos pelo nome, salvando 
o contactId selecionado em whatsapp_contact_id.
```

---

## PASSO 4.1 — Colaborador: tela inicial (empresas) (Feito)

```
Construa a tela inicial do painel do colaborador (src/app/colaborador):
- Lista as empresas DELE (derivadas das task_instances onde 
  collaborator_id = usuário logado; a função my_collaborator_companies 
  e o RLS já garantem o escopo).
- Para cada empresa, um card com: nome, barra de progressão (% de tarefas 
  finalizadas sobre o total dele naquela empresa), nº de tarefas pendentes, 
  e um alerta visual se houver tarefas atrasadas (due_at < agora e status 
  != finalizada) ou perto do prazo (vencendo em < 24h).
- Barra de progressão na cor risd.
- Clicar no card leva para a tela da empresa (passo 4.2).
IMPORTANTE: o colaborador só pode ver as próprias tarefas, nunca as de 
outros colaboradores na mesma empresa.
```

## PASSO 4.2 — Colaborador: tela da empresa (Feito)

```
Crie a tela da empresa no painel do colaborador 
(src/app/colaborador/[companyId]):
- Cabeçalho com nome da empresa e progressão geral (feitas × não feitas).
- Lista das tarefas DELE naquela empresa, com ordenação selecionável: 
  mais antiga, mais recente, próximas do prazo final.
- Cada item mostra título, status (badge colorido), prazo, e tempo já 
  gasto (total_seconds formatado em h:m).
- Clicar numa tarefa leva para a tela da tarefa (passo 4.3).
```

## PASSO 4.3 — Colaborador: tela da tarefa + TIMER (Feito)

```
Esta é a tela mais importante. Crie a tela da tarefa 
(src/app/colaborador/[companyId]/[taskId]) com o timer.

Exibir: título, descrição, instruções, prazo, empresa.

TIMER (lógica precisa, ver docs/ESPECIFICACAO.md seção 5.4):
- Botões: Iniciar / Pausar / Finalizar.
- Ao Iniciar (play): cria um time_entry com started_at=now() e ended_at 
  nulo; muda status da task para "iniciada". Cronômetro visível contando.
- Ao Pausar: fecha o time_entry aberto (ended_at=now(), seconds=diferença) 
  e soma em task_instances.total_seconds.
- Ao Finalizar: fecha qualquer intervalo aberto, abre uma caixa de texto 
  obrigatória para o resumo do que foi feito. Ao confirmar: status → 
  "finalizada", salva completion_note, grava finished_at, cria registro 
  em activity_log. Dois botões: "Finalizar e enviar ao WhatsApp" e 
  "Finalizar e apenas salvar no registro".
- PERSISTÊNCIA: como cada intervalo está no banco, recarregar a página 
  não perde o tempo. Ao abrir a tela, se existir um time_entry aberto 
  (sem ended_at), o cronômetro deve retomar de onde parou.
- O envio ao WhatsApp em si vem no passo 5; por enquanto, o botão de 
  enviar pode só marcar note_sent_whatsapp e logar (deixe um TODO claro).

Cores: cronômetro e botão Iniciar em risd; Finalizar em chrysler.
Teste todo o ciclo: iniciar, pausar, retomar, finalizar com resumo.
```

---

## PASSO 5 — Edge Function: envio ao WhatsApp (Feito)

```
Crie a Supabase Edge Function "send-whatsapp" que envia o resumo de uma 
tarefa ao grupo da empresa.

- Recebe { companyId, message }.
- Busca o whatsapp_contact_id da empresa (tabela companies).
- Faz POST {DIGISAC_DOMAIN}/api/v1/messages com:
  { text: message, contactId: <whatsapp_contact_id>, 
    serviceId: <DIGISAC_SERVICE_ID>, origin: "bot", dontOpenTicket: true }
  Header: Authorization: Bearer {DIGISAC_TOKEN}
- IMPORTANTE: usar contactId, NÃO o number com @g.us (a API confunde com 
  contato individual). Isso já foi validado em teste real.
- Secrets: DIGISAC_DOMAIN, DIGISAC_TOKEN, DIGISAC_SERVICE_ID.
- Se a empresa não tiver whatsapp_contact_id, retorne erro claro.

Depois, conecte o botão "Finalizar e enviar ao WhatsApp" (passo 4.3) a 
esta função. Teste com uma empresa vinculada ao grupo "Teste 1 (Yuri)" 
(contactId b5e63f85-f65a-4392-8689-9c2b2640c733).
```

---

## PASSO 6 — Painel do consultor (Feito)

```
Construa o painel do consultor (src/app/consultor). É similar ao admin, 
mas reduzido e escopado:
- Lista só as empresas atribuídas a ele (RLS já garante via 
  my_consultant_companies).
- Pode cadastrar tarefas para colaboradores nessas empresas (reaproveite 
  o componente de cadastro de tarefas do passo 2.3, filtrando as empresas).
- Pode ver o progresso das tarefas das suas empresas.
- NÃO tem dashboards gerais nem gestão de usuários.
Reaproveite ao máximo os componentes já criados para o admin.
```

---

## PASSO 7 — Dashboards do admin (Feito)

```
Agora os dashboards do painel admin (a tela principal):
- Cards clicáveis com contagem de task_instances por status: a fazer, 
  iniciadas, finalizadas, canceladas. Ao clicar num card, abre a lista 
  das tarefas daquele status.
- Métricas extras: tempo total gasto no período, tarefas atrasadas, 
  ranking de empresas por tempo gasto.
- Seção "Resumo por colaborador": para cada colaborador, tempo total 
  gasto e % de tarefas concluídas.
- Visual de dashboard limpo, números grandes, acento risd. Considere usar 
  um gráfico simples (pode ser com recharts) para o tempo por empresa.
```

---

## PASSO 8 — Recorrência (pg_cron) e finalização (Feito)

```
Vamos finalizar a infraestrutura:
1. Agende a função generate_daily_tasks com pg_cron para rodar todo dia. 
   O servidor é UTC; quero que rode equivalente a 00:05 no horário de 
   Brasília. Monte o cron.schedule adequado e me explique o horário 
   escolhido.
2. Teste a recorrência: crie uma tarefa diária marcada para hoje e rode 
   generate_daily_tasks(current_date) manualmente para confirmar que a 
   instância é gerada (e que rodar de novo não duplica).
3. Faça uma revisão geral: verifique se há algum console.error, rota 
   quebrada, ou política RLS bloqueando algo indevidamente.
```

---

# CORREÇÕES E MELHORIAS (pós-construção)

Estes passos vêm depois do sistema funcionando. Os passos 9 e 10 são 
**correções de bug** — faça-os ANTES das melhorias (11-13), porque não faz 
sentido construir em cima de algo quebrado. Continue a regra de ouro: um 
passo por vez, testando no navegador antes de avançar.

---

## PASSO 9 — Correção: exclusão de tarefas (Feito)

```
Há um bug na exclusão de tarefas: ao apagar uma tarefa no painel admin, 
ela some da tela do admin mas continua existindo nos painéis do consultor 
e do colaborador, e os dados do dashboard e do resumo por colaborador 
continuam contando a tarefa apagada. Ou seja, a exclusão não está 
removendo o registro de verdade do banco.

Corrija para que a exclusão apague realmente a tarefa do banco (e suas 
dependências: time_entries e activity_log relacionados), refletindo em 
TODOS os painéis e em todos os números (dashboard, resumos).

Regras de permissão para excluir:
- Admin: pode excluir qualquer tarefa.
- Consultor: pode excluir apenas tarefas que ele mesmo criou.
- Colaborador: NÃO pode excluir tarefas.
Confirme que o RLS no banco reforça essas regras, não só a interface 
(esconder o botão não é segurança real; a política tem que estar no banco).

Proteção contra perda de histórico: antes de excluir uma tarefa que já 
tenha tempo registrado (total_seconds > 0), mostre uma confirmação que 
informe o tempo que será perdido, ex: "Esta tarefa tem 8h12 registradas. 
Apagar removerá esse tempo permanentemente do total da empresa. Confirmar?". 
Para tarefas sem tempo, uma confirmação simples basta.

Teste: apague uma tarefa e confirme que ela some de todos os painéis e que 
os números do dashboard se atualizam corretamente.
```

---

## PASSO 10 — Investigação: performance / lentidão (Feito)

```
O sistema está com lentidão perceptível: ao navegar entre abas, há um 
delay até a nova tela abrir. Investigue e otimize.

Possíveis causas a verificar:
- Queries pesadas ou repetidas a cada navegação (ex: buscar todos os dados 
  toda vez em vez de paginar ou cachear).
- Falta de índices no banco para as consultas mais usadas.
- Componentes recarregando dados que poderiam ser reaproveitados.
- Falta de estados de carregamento (loading) que fazem a tela parecer 
  travada enquanto busca dados.

Faça um diagnóstico, me diga o que encontrou como causa provável, e aplique 
as otimizações cabíveis. Adicione indicadores de carregamento (skeletons ou 
spinners) onde a espera for inevitável, para a navegação não parecer travada.
Meça e me diga se melhorou.
```

---

## PASSO 11 — Busca e filtros (tarefas, empresas, usuários) (Feito)

```
Adicione barra de busca e filtros nas telas de listagem do painel admin:

1. Tela de Tarefas: barra de busca por título; filtros por status 
   (a fazer, iniciada, finalizada, cancelada), por empresa, por colaborador 
   e por tipo (única/diária).
2. Tela de Empresas: barra de busca por nome; filtro por consultor 
   responsável.
3. Tela de Usuários: barra de busca por nome/email; filtro por cargo.

A busca deve ser instantânea (filtra conforme digita). Os filtros podem 
combinar entre si. Mantenha a identidade visual da marca, com os controles 
de filtro discretos no topo de cada lista.
Teste cada busca e filtro.
```

---

## PASSO 12 — Tela de tarefas nos painéis de consultor e colaborador (Feito)

```
Hoje só o painel admin tem uma tela com a lista geral de tarefas. Crie uma 
tela equivalente nos painéis do consultor e do colaborador, sempre 
respeitando o escopo de cada um (o RLS já garante, mas confirme na query):

- Consultor: vê as tarefas das empresas atribuídas a ele (de todos os 
  colaboradores dessas empresas).
- Colaborador: vê apenas as tarefas atribuídas a ele mesmo, nunca as de 
  outros colaboradores.

Reaproveite o componente de lista de tarefas do admin, incluindo a busca e 
os filtros do passo 11 (adaptando os filtros ao que faz sentido para cada 
cargo — ex: o colaborador não precisa filtrar por colaborador).
Teste nos dois painéis e confirme que o escopo está correto (um consultor 
não vê tarefa de empresa que não é dele; um colaborador não vê tarefa de 
outro colaborador).
```

---

## PASSO 13 — Perfil de usuário com foto (Feito)

```
Crie uma tela de perfil acessível por qualquer usuário logado (admin, 
consultor, colaborador):

- Mostra nome, email e cargo, já preenchidos conforme o usuário logado. 
  Email e cargo são somente leitura (cargo só o admin muda); o nome pode 
  ser editável pelo próprio usuário.
- Permite anexar/trocar uma foto de perfil. Faça o upload usando Supabase 
  Storage (crie um bucket apropriado, ex: "avatars", com as políticas de 
  acesso corretas — cada um só altera a própria foto). Salve a URL/caminho 
  da foto no profile.
- Onde o sistema já mostra o nome do usuário (ex: rodapé da sidebar, 
  resumos, listas), passe a mostrar também a foto de perfil ao lado. Onde 
  não houver foto, mantenha o círculo com as iniciais como fallback.

Mantenha a identidade visual da marca. Teste o upload e confirme que a foto 
aparece nos lugares onde o nome já aparece.
```

---

## PASSO 14 — Autoatribuição: admin e consultor como responsáveis (Feito)

Contexto: hoje o sistema assume papéis separados (admin gerencia, consultor
atende clientes, colaborador executa). Este passo permite que admin e
consultor também ASSUMAM trabalho operacional, sem perder suas funções de
gestão. É uma mudança que toca a fundação (RLS), então exige cuidado e
testes mais rigorosos que o normal.

```
Quero permitir que admin e consultor também assumam trabalho operacional,
mantendo suas funções de gestão. Implemente com cuidado, pois isso altera
suposições da fundação (RLS).

REGRAS:
- Admin pode se atribuir como responsável de empresas (igual a um consultor,
  gravando em company_consultants) E como responsável de tarefas (igual a um
  colaborador, no collaborator_id da task).
- Consultor pode se atribuir como responsável de TAREFAS apenas (não de
  empresas — ele já recebe empresas do admin).
- Quando admin ou consultor executa uma tarefa, ele usa o TIMER exatamente
  como um colaborador (iniciar/pausar/finalizar, resumo, envio ao WhatsApp,
  registro de tempo) — reaproveite integralmente a tela e a lógica do timer
  que já existem, sem duplicar.

INTERFACE — crie uma área "Meu Trabalho" no painel do admin (e a equivalente
no consultor):
- Uma seção separada das telas de gestão, mostrando:
  (a) as empresas atribuídas diretamente a ele (no caso do admin), e
  (b) as tarefas atribuídas diretamente a ele para executar.
- Reaproveite os componentes do painel do colaborador (cards de empresa com
  progressão, lista de tarefas, tela da tarefa com timer) para essa área —
  o comportamento de execução é idêntico ao do colaborador.
- Nas telas de cadastro de tarefa, o admin/consultor deve poder selecionar
  a si mesmo no campo de responsável/colaborador. No cadastro/edição de
  empresa, o admin deve poder se incluir como consultor responsável.

SEGURANÇA (RLS) — atenção redobrada:
- Hoje as políticas assumem que admin não é colaborador de nada. Ajuste as
  políticas para que admin/consultor enxerguem e operem as tarefas/empresas
  atribuídas a eles como executores, SEM quebrar o que já veem como gestores
  e SEM abrir acesso indevido a dados de outros.
- Garanta que um consultor que se autoatribui uma tarefa só veja a própria
  tarefa, não as de outros colaboradores da mesma empresa (a regra de
  isolamento por colaborador continua valendo).
- Teste explicitamente: admin executando uma tarefa, consultor executando
  uma tarefa, e confirme que o tempo registrado aparece corretamente nos
  dashboards e resumos (o admin/consultor executor deve contar como quem
  gastou o tempo).

Mantenha a identidade visual da marca e a responsividade.
Ao terminar, me mostre a área "Meu Trabalho" do admin e confirme, item a
item, que as regras de permissão acima foram respeitadas.
```

### Checklist de validação (faça você mesmo, com rigor extra)
- Abra o painel admin e confirme que "Meu Trabalho" aparece separado das
  telas de gestão (Usuários, Empresas, Tarefas, Dashboard).
- Autoatribua uma empresa e uma tarefa a si mesmo e veja se aparecem lá.
- Execute uma tarefa pelo timer como admin e confirme que o tempo conta nos
  dashboards.
- Logue como consultor e confirme que ele consegue se autoatribuir tarefa,
  mas NÃO empresa.
- Confirme que um colaborador comum NÃO vê as tarefas que o admin atribuiu
  a si mesmo (isolamento preservado — este é o teste mais importante).

---

## PASSO 15 — Tarefas padrão (catálogo reutilizável) (Feito)

Mecânica: um catálogo de tarefas "padrão" que pode ser atribuído a empresas
sem recadastrar manualmente em cada uma.

```
Implemente um sistema de "tarefas padrão" — um catálogo de tarefas
reutilizáveis que agiliza a atribuição a empresas.

CATÁLOGO (subtela dedicada):
- Na tela de Tarefas, crie uma sub-área/aba "Tarefas Padrão" para
  criar/editar/excluir tarefas padrão.
- Cada tarefa padrão tem os mesmos campos de uma tarefa normal (título,
  descrição, instruções, tipo único OU diário com dias da semana e
  horário-limite). O que muda é que ela é um MOLDE reutilizável, não ligada
  a uma empresa específica ainda.
- Modele isso no banco de forma limpa (ex: uma flag is_standard ou uma
  tabela própria de templates padrão). Escolha a abordagem mais coerente
  com o schema atual de task_templates.

ATRIBUIÇÃO NA EMPRESA:
- No cadastro/edição de empresa, adicione uma seção "Tarefas padrão desta
  empresa" onde o admin/consultor seleciona quais tarefas padrão a empresa
  usa (algumas específicas ou todas) e, para cada uma, define o colaborador
  responsável (que pode ser trocado depois).
- Ao atribuir, o sistema gera as tarefas para aquela empresa (respeitando o
  tipo: única gera a instância; diária entra na recorrência existente via
  generate_daily_tasks).

VÍNCULO VIVO (com congelamento do histórico):
- As tarefas geradas a partir de uma tarefa padrão ficam VINCULADAS a ela.
- Editar a tarefa padrão (título, descrição, instruções, prazo) atualiza
  automaticamente as instâncias/derivadas que ainda NÃO foram finalizadas,
  em todas as empresas que a usam.
- Instâncias já FINALIZADAS ficam CONGELADAS: a edição da padrão não altera
  o texto delas (são histórico do que foi realmente feito). Garanta isso.
- Se uma empresa deixar de usar uma tarefa padrão, as instâncias futuras/em
  aberto param de ser geradas/atualizadas; as finalizadas permanecem no
  histórico.

Respeite o RLS existente (admin e consultor no escopo deles). Mantenha a
identidade visual. Teste: criar uma padrão, atribuir a 2 empresas com
responsáveis diferentes, editar a padrão e confirmar que as em aberto
mudaram e as finalizadas não.
```

Se tiver QUALQUER dúvida de modelagem antes de codar (como ligar as
instâncias à padrão, como tratar a recorrência), PERGUNTE antes de assumir.

---

## PASSO 16 — Correção de tempo pelo admin (com auditoria) (Feito)

Mecânica: admin pode corrigir o tempo de tarefas (casos de esquecer de
pausar/finalizar o timer), com registro de quem alterou.

```
Permita que administradores corrijam o tempo de execução das tarefas dos
usuários (para casos em que alguém esqueceu de pausar/finalizar o timer).

ONDE:
- No dashboard, na tabela "Resumo por responsável/colaborador", ao acessar
  um responsável, mostrar as tarefas dele. Em cada tarefa, permitir ao admin
  ajustar o tempo total (total_seconds) — editar o valor, ou ajustar os
  intervalos (time_entries) se fizer sentido.
- Apenas ADMIN pode fazer esse ajuste. Confirme no RLS, não só na interface.

AUDITORIA (obrigatório):
- Toda alteração manual de tempo deve ser REGISTRADA: quem alterou, quando,
  o valor anterior e o novo. Crie uma tabela de log para isso (ex:
  time_adjustments) ou registre no activity_log de forma clara.
- Mostre, na própria tarefa, uma indicação de que o tempo foi ajustado
  manualmente (ex: um selo "tempo ajustado" com o histórico ao passar o
  mouse), para transparência.

Após o ajuste, os dashboards e resumos devem refletir o novo tempo. Teste
um ajuste e confirme que o registro de auditoria foi criado e que os totais
se atualizaram.
```

---

## PASSO 17 — Detalhamento do gráfico de tempo por empresa (Feito)

Mecânica: clicar numa barra do gráfico abre o detalhe das tarefas que
compõem aquele tempo.

```
No gráfico de barras "tempo por empresa" do dashboard, torne as barras
clicáveis. Ao clicar na barra de uma empresa, abra um detalhamento (painel
lateral ou modal) mostrando quais tarefas somaram aquele tempo total:
- Lista das tarefas daquela empresa com o tempo gasto em cada uma,
  ordenadas da que mais consumiu tempo para a que menos consumiu.
- Para cada tarefa: título, responsável, status e o tempo.
- O total do detalhamento deve bater exatamente com a altura da barra.
- Respeite o filtro de período ativo no dashboard (se está vendo "30 dias",
  o detalhe é dos 30 dias).

Mantenha a identidade visual. Teste clicando numa barra e conferindo que a
soma dos tempos das tarefas é igual ao total da barra.
```

---

## PASSO 18 — Preparar para escala (fazer por último) (Feito)

Mecânica: garantir que o sistema se comporte bem visualmente com muitas
empresas (40+) e usuários (20+). Deixado por último conforme prioridade
definida.

```
Quero preparar o sistema para escala (40+ empresas, 20+ usuários). Faça uma
auditoria de todas as telas e gráficos pensando em volume real:
- Listas (empresas, tarefas, usuários): adicione paginação e/ou rolagem
  eficiente; nunca carregue centenas de registros de uma vez.
- Dropdowns de seleção (ex: escolher empresa/colaborador): adicione busca
  interna, para não virar uma lista gigante de rolar.
- Gráfico "tempo por empresa" e similares: com 40+ empresas fica ilegível.
  Mostre um Top N (ex: top 10) com opção de ver o resto, ou agrupe a cauda.
- Resumo por colaborador e demais tabelas: pagine ou limite com "ver mais".
Me diga o que encontrou como risco de escala e aplique as correções.
```

---

## PASSO 19 — Tela completa de detalhe da empresa (admin e consultor) (Feito)

Mecânica: uma "central da empresa" rica, que dá visão completa de cada
cliente. Evolui a tela básica que já existe no painel do consultor e cria a
equivalente no admin. Serve para consultar E agir.

Escopo de acesso (o RLS já garante, mas confirmar):
- Admin: acessa a tela de TODAS as empresas.
- Consultor: acessa apenas as empresas sob responsabilidade dele.

```
Crie uma tela completa de detalhe da empresa ("central da empresa"),
disponível nos painéis do admin e do consultor. Hoje o consultor tem uma
versão básica dessa tela — evolua-a e crie a equivalente para o admin,
reaproveitando componentes.

ACESSO:
- Admin acessa qualquer empresa. Consultor acessa só as empresas dele.
  Confirme que o RLS reforça isso (não apenas a interface).

CONTEÚDO DA TELA (organizado em blocos, do resumo ao detalhe):

1. Cabeçalho da empresa:
   - Nome, consultor(es) responsável(is), grupo de WhatsApp vinculado,
     data de cadastro.

2. Indicadores (cards com números):
   - Total de tarefas e contagem por status: a fazer, em andamento
     (iniciadas), finalizadas, atrasadas, canceladas — cada uma com sua
     cor/tag.
   - Tempo total gasto na empresa, e tempo gasto no mês atual (separados).

3. Progresso:
   - Barra de progressão (% de tarefas concluídas) na cor da marca.

4. Tarefas atrasadas em destaque:
   - Uma seção no topo que evidencia as tarefas atrasadas (prazo vencido e
     não finalizadas), porque são as que exigem ação.

5. Lista de tarefas (detalhamento):
   - Todas as tarefas da empresa, com filtros por status e ordenação
     (mais antiga, mais recente, próximas do prazo). Reaproveite os filtros
     e a busca já existentes no sistema.
   - Cada tarefa mostra: título, responsável, status (badge), prazo e tempo
     gasto. Clicável para abrir o detalhe da tarefa.
   - Detalhe das tarefas entregues/finalizadas: incluir o resumo escrito na
     finalização e o tempo total.

6. Resumo por colaborador (dentro da empresa):
   - Quais colaboradores trabalharam nesta empresa e quanto tempo cada um
     dedicou; % de conclusão de cada um dentro da empresa.

7. Histórico de atividades:
   - As entradas do activity_log daquela empresa (os resumos escritos ao
     finalizar tarefas), em ordem cronológica — o "diário" do cliente.

8. Tarefas padrão da empresa:
   - Quais tarefas padrão esta empresa usa (do sistema de tarefas padrão já
     existente).

AÇÕES (a tela também permite agir, não só consultar):
- Botão "Nova tarefa" já com a empresa pré-selecionada (reaproveite o fluxo
  do passo que criou isso).
- Botão "Editar empresa" para ajustar dados/vínculos ali mesmo.
- Ações respeitam permissão: consultor só age nas empresas dele; admin em
  todas.

CUIDADOS:
- Pense em ESCALA (uma empresa antiga pode ter milhares de instâncias de
  tarefa por causa da recorrência diária): a lista de tarefas e o histórico
  devem usar a paginação no servidor já implementada, não carregar tudo.
- Todos os números (contagens, tempo) devem bater com o dashboard.
- Mantenha a identidade visual da marca, tema claro/escuro e responsividade
  (precisa funcionar bem no celular).

Ao terminar, me mostre a tela para uma empresa com bastante dado e confirme,
como admin e como consultor, que o acesso está correto (consultor não acessa
empresa que não é dele).
```

### Checklist de validação
- Como admin, abrir qualquer empresa e ver todos os blocos preenchidos.
- Como consultor, confirmar que só acessa as empresas dele (tentar acessar
  uma que não é dele deve ser bloqueado).
- Conferir que os números (tarefas por status, tempo) batem com o dashboard.
- Criar uma tarefa pela tela da empresa e confirmar que nasce vinculada a ela.
- Abrir uma empresa com muitas tarefas e confirmar que carrega rápido
  (paginação funcionando).

---

## PASSO 20 — Sistema de etiquetas de empresa (com herança nas tarefas) (Feito)

Mecânica: um sistema de etiquetas coloridas atribuíveis a empresas. As
etiquetas de uma empresa aparecem em todas as tarefas dela, de forma
retroativa e automática (a tarefa herda da empresa em tempo real, não por
cópia). A primeira etiqueta é "Ema".

```
Implemente um sistema de ETIQUETAS (tags) coloridas para empresas.

GERENCIAMENTO DE ETIQUETAS:
- Uma área (na tela de Empresas ou nas configurações) para criar, editar e
  remover etiquetas. Cada etiqueta tem: nome, cor de fundo e cor do texto.
- Crie a primeira etiqueta já no sistema: nome "Ema", fundo #4A2882, texto
  #FFFFFF.
- Modele no banco uma tabela própria de etiquetas (ex: labels) e uma relação
  muitos-para-muitos entre empresas e etiquetas (ex: company_labels), já que
  uma empresa pode ter VÁRIAS etiquetas e uma etiqueta pode estar em várias
  empresas.

ATRIBUIÇÃO NA EMPRESA:
- No formulário de CRIAÇÃO e de EDIÇÃO de empresa, permita selecionar uma ou
  mais etiquetas (multi-seleção). O admin/consultor marca quais etiquetas a
  empresa tem.
- As etiquetas selecionadas aparecem no cabeçalho/detalhe da empresa,
  renderizadas com suas cores.

HERANÇA NAS TAREFAS (retroativa e automática — ponto crítico):
- As etiquetas NÃO são copiadas para cada tarefa. Em vez disso, a tarefa
  HERDA as etiquetas da sua empresa em tempo real: ao exibir uma tarefa,
  o sistema busca as etiquetas da empresa dela e as mostra.
- Isso garante que funcione RETROATIVAMENTE: marcar uma etiqueta numa empresa
  já existente faz a etiqueta aparecer em TODAS as tarefas dela (antigas,
  atuais e futuras) imediatamente, sem precisar atualizar tarefa por tarefa.
  Desmarcar remove de todas automaticamente.
- Mostre as etiquetas nas tarefas onde fizer sentido: no detalhe da tarefa,
  na listagem de tarefas, e onde mais a tarefa aparecer (ex: painel do
  colaborador). Renderizadas com as cores da etiqueta.

CUIDADOS:
- Pense em ESCALA: a herança em tempo real deve ser eficiente (não fazer uma
  consulta separada por tarefa numa lista grande — busque as etiquetas das
  empresas envolvidas de forma agrupada).
- Respeite o RLS existente (admin/consultor no escopo deles; colaborador vê
  as etiquetas das tarefas dele).
- Mantenha a identidade visual da marca, tema claro/escuro e responsividade.

Teste: criar a etiqueta "Ema", aplicá-la a uma empresa que JÁ TEM tarefas, e
confirmar que a etiqueta aparece em todas as tarefas dela (inclusive as
antigas). Depois desmarcar e confirmar que some de todas.
```

### Checklist de validação
- Criar a etiqueta "Ema" (#4A2882 / #FFFFFF) e vê-la com as cores certas.
- Criar uma segunda etiqueta qualquer para confirmar que o sistema é
  extensível (não fixo só na Ema).
- Aplicar 2 etiquetas a uma mesma empresa e ver as duas.
- Marcar a etiqueta numa empresa antiga e confirmar que aparece nas tarefas
  já existentes dela (o teste retroativo — o mais importante).
- Desmarcar e confirmar que some de todas as tarefas.
- Conferir que uma lista grande de tarefas com etiquetas continua carregando
  rápido (escala).


---

# FRENTE: TELA DE EMPRESA RICA + ACESSO DO CLIENTE (Passos 21 a 25)

Objetivo comum: enriquecer a tela da empresa e, ao final, expô-la de forma
SEGURA e CURADA para o cliente acompanhar o projeto dele. Faça na ordem — o
acesso do cliente (25) é o mais sensível e vem por último, apoiado no que os
outros construírem. (O sistema de notificações foi adiado.)

---

## PASSO 21 — Colaborador cadastra tarefa para si mesmo (ignorar por enquanto)

```
Permita que COLABORADORES cadastrem tarefas exclusivamente para si mesmos.

- No painel do colaborador, adicione a opção de criar tarefa. O responsável
  é sempre ELE MESMO (não pode atribuir a outros).
- Ele pode escolher QUALQUER empresa do sistema como destino da tarefa.
- Os demais campos são os mesmos do cadastro de tarefa normal (título,
  descrição, instruções, tipo único/diário, prazo).
- A tarefa criada por ele se comporta como qualquer outra dele (aparece nas
  telas dele, cronometrável pelo timer, etc.).
- Registre corretamente quem criou (created_by = o colaborador).
- Respeite o RLS: ele só cria tarefas para si mesmo; não ganha acesso a
  tarefas de outros colaboradores.

Teste: um colaborador cria uma tarefa para si numa empresa qualquer e ela
aparece nas tarefas dele, cronometrável.
```

---

## PASSO 22 — Novo tipo de tarefa: Listagem de marcas (Feito)

```
Crie um novo tipo de tarefa: "Listagem de marcas", com um formulário
dedicado que aparece ao selecionar esse tipo no cadastro de tarefa.

CAMPOS DESTE TIPO:
- Campos comuns: Título, Descrição, Empresa, Colaborador, Data e Horário.
  (Este tipo NÃO tem a escolha único/diário — é sempre pontual.)
- Marcas: o usuário digita quais marcas quer (permitir adicionar várias).
- Marketplaces: para cada listagem, escolher em quais dos 3 marketplaces a
  pesquisa será feita — Mercado Livre, Shopee, Amazon (pode marcar um ou
  mais).
- Cálculo de margem: um sim/não. Se SIM, aparece um campo para informar a
  ALÍQUOTA de imposto paga pelo cliente (um percentual).
  IMPORTANTE: o sistema apenas ARMAZENA esses dados (marcas, marketplaces,
  se precisa margem, alíquota). NÃO faz nenhum cálculo de margem — quem
  calcula é o colaborador por fora. O sistema é só o registro.

- Modele no banco de forma limpa (ex: um tipo/flag no template + tabela(s)
  para as marcas/marketplaces da listagem).
- Respeite o RLS existente.

Teste: criar uma tarefa de listagem com 3 marcas, marketplaces variados, e
margem sim com alíquota; confirmar que tudo é salvo e exibido corretamente.
```

---

## PASSO 23 — Aba "Minhas Listagens" na tela da empresa (Feito)

```
Na tela de detalhe da empresa, adicione uma aba "Minhas Listagens" que mostra
as tarefas de listagem (passo 22) feitas para AQUELA empresa.

- Liste as marcas das listagens de forma organizada. Cada marca aparece
  com o LINK nela (clicável) e o marketplace em que a pesquisa foi feita.
- Permita ORDENAR, FILTRAR e PESQUISAR (ex: por marca, por marketplace,
  por data).
- Só mostra as listagens da empresa em questão.
- Reaproveite os componentes de busca/filtro já existentes no sistema.
- Respeite o escopo: admin vê de qualquer empresa; consultor só das dele.
- Pense em escala (pode haver muitas listagens) — use a paginação já
  implementada.

Teste: abrir a aba numa empresa com várias listagens e conferir ordenação,
filtro e busca funcionando, com os links das marcas clicáveis.
```

---

## PASSO 24 — Anotações Rich Text na tela da empresa (Feito)

```
Adicione uma seção de ANOTAÇÕES na tela de detalhe da empresa, com editor
rich text avançado. Serve para consultores, colaboradores e administradores
registrarem anotações, resumos de reunião, planos de ação, etc.

EDITOR:
- Editor rich text de nível "Word": negrito, itálico, sublinhado, títulos,
  listas, links, e INSERÇÃO DE IMAGENS no meio do texto (upload via Supabase
  Storage; crie o bucket e as políticas adequadas).
- Use uma biblioteca de editor rich text consolidada (ex: TipTap ou similar)
  — me diga qual escolheu.

GERENCIAMENTO DAS ANOTAÇÕES:
- Uma seção/aba na tela da empresa com todas as anotações registradas, de
  forma organizada (mais recentes primeiro, com autor e data).
- Criar, editar e excluir anotações.
- Ao EDITAR, salve registro de QUEM alterou e QUANDO (histórico/auditoria).
  Mostre "editado por X em [data]".
- VISIBILIDADE: cada anotação tem um marcador "visível ao cliente" vs.
  "interna". Por padrão, INTERNA (segurança). As visíveis ao cliente serão
  as únicas mostradas no acesso do cliente (passo 25).

- Respeite o RLS (admin/consultor no escopo; colaborador conforme acesso à
  empresa).
- Mantenha identidade visual, tema claro/escuro, responsividade.

Teste: criar uma anotação com formatação e imagem; editá-la e ver o registro
de quem/quando; marcar uma como visível ao cliente e outra como interna.
```

---

## PASSO 25 — Acesso do cliente (visão pública segura e CURADA) ⚠️ CUIDADO MÁXIMO (Feito)


Mecânica: um link protegido por senha que dá ao cliente 
acesso SOMENTE à
própria empresa, sem conta, sem navegação. A tela é CURADA para mostrar valor
entregue e comunicação — NÃO expõe tarefas, tempo, atrasos ou operação
interna. É o passo mais sensível — segurança e curadoria acima de tudo.

Decisão de conteúdo (importante): o cliente NÃO vê o operacional interno
(nada de contagem de tarefas, tempo gasto, tarefas atrasadas, lista de
tarefas, resumo por colaborador, progresso/percentual). Isso é proposital —
evita expor a operação e criar ansiedade com atrasos/pendências. A tela
mostra ENTREGA (listagens) e COMUNICAÇÃO curada (atualizações).

```
Crie um acesso EXTERNO para o cliente acompanhar o projeto da empresa dele.
Este é o passo mais sensível do sistema — priorize SEGURANÇA e CURADORIA.

ACESSO:
- Para cada empresa, gere um LINK único com token imprevisível (aleatório,
  longo — NÃO baseado em id sequencial adivinhável).
- Protegido por SENHA definida por empresa (admin/consultor define e pode
  redefinir). Cliente abre o link, digita a senha, vê a tela. Sem criar
  conta, sem login no sistema real.
- Admin/consultor pode gerar/revogar o link e trocar a senha quando quiser.

TELA DO CLIENTE (curada, separada e enxuta):
- Crie uma tela SEPARADA e blindada (NÃO reutilize a tela interna escondendo
  campos). Por construção, ela só acessa dados daquela empresa.
- CONTEÚDO que o cliente VÊ:
  1. Cabeçalho acolhedor: nome da empresa/cliente, logo da Monvatti,
     saudação/profissional.
  2. Listagens (destaque principal): as marcas cadastradas nos marketplaces
     (do sistema de listagens), organizadas, com links e o marketplace de
     cada uma. É a entrega concreta e visível.
  3. Atualizações do projeto: as anotações marcadas como "visível ao cliente"
     (do sistema de anotações), em ordem cronológica — resumos de reunião,
     planos de ação, novidades. NUNCA as anotações internas.
- CONTEÚDO que o cliente NÃO vê (jamais): contagem/lista de tarefas, tempo
  gasto, tarefas atrasadas ou pendentes, quem executou o quê, resumo por
  colaborador, custos, anotações internas, dados de outras empresas,
  indicadores de progresso/percentual, e qualquer navegação para outras
  telas. Sem menu lateral.

SEGURANÇA (revisar com rigor):
- A blindagem tem que estar no BACKEND/RLS, não só na interface: as consultas
  do acesso do cliente só retornam dados da empresa do token. Esconder na
  tela não basta.
- Trocar o token/URL não pode dar acesso a outra empresa.
- Rate limit nas tentativas de senha (anti-força-bruta).
- Token e senha nunca em URL/logs.

Antes de finalizar, me explique COMO garantiu que um cliente não consegue,
de forma alguma, ver dados de outra empresa nem o conteúdo interno (qual a
camada de proteção real). Depois me deixe testar: acessar com a senha certa
(vê só listagens/atualizações da empresa dele), e tentar burlar (trocar
token, senha errada, tentar acessar telas internas ou dados operacionais) —
tudo bloqueado.
```

### Ordem e validação da frente
- Faça 21 → 22 → 23 → 24 → 25.
- O passo 25 é o mais sensível: teste exaustivamente (a) o ISOLAMENTO (um
  cliente jamais vê outra empresa) e (b) a CURADORIA (nenhum dado operacional
  interno aparece) ANTES de enviar qualquer link a clientes reais.
- No 24, confirme que "interna" é o padrão, para nada vazar por engano no 25.


---

# FRENTE: PORTAL DO CLIENTE MADURO + OPERAÇÃO (Passos 26 a 32)

Objetivo comum: transformar o Portal do Cliente de uma vitrine crua numa
superfície de relacionamento — visual à altura, conteúdo curado, e por fim
comunicação de mão dupla. Junto vieram melhorias operacionais internas
(indicador de timer, performance).

⚠️ Regra da frente: o portal é a tela mais sensível do sistema. Todo passo que
o toca precisa reconfirmar ISOLAMENTO (um cliente jamais vê outra empresa) e
CURADORIA (nenhum dado operacional interno aparece).

---

## PASSO 26 — Reforma visual e de conteúdo do Portal do Cliente (Feito)

Contexto: o portal do passo 25 estava cru e com terminologia errada. Este passo
é SÓ visual/terminologia — não toca segurança nem muda o conjunto de dados que
o cliente vê.

Decisões de produto tomadas antes de codar:
- "Publicação/publicada" era vocabulário nosso, não do cliente. O certo é
  "listagem/listada".
- O par binário "Publicada / Não publicada" soava como "feito × não feito", o
  que é FALSO: não enviamos uma listagem quando a marca não tem relevância ou
  tem pouca saída. Vira uma decisão de curadoria, não uma pendência.
- Os contadores "X/Y publicadas" e "N marketplaces" saíram: o de marketplaces
  é trivial (nunca passa de 3) e a fração reintroduz a lógica de completude que
  queremos evitar.
- Sem logos oficiais dos marketplaces (decisão consciente de risco de marca) —
  só cor + ícone genérico, centralizados num mapa único para trocar fácil depois.

```
Vamos reformular o PORTAL DO CLIENTE (a tela externa e blindada do Passo 25),
somente na parte VISUAL e de CONTEÚDO/TERMINOLOGIA. Regras inegociáveis deste
passo:
- NÃO altere segurança, RLS, token, senha nem a CURADORIA. O conjunto de dados
  que o cliente vê continua EXATAMENTE o mesmo (listagens + anotações marcadas
  "visível ao cliente"). Não adicione nenhuma nova fonte de dados aqui.
- Mantenha o portal SELF-CONTAINED e blindado: não importe componentes das
  telas internas que possam carregar dados internos. Se precisar do visual de
  algum controle interno (ex: abas, busca/filtro), replique o visual, sem puxar
  a lógica interna junto.
- Mantenha o toggle de tema claro/escuro e a responsividade.

MUDANÇAS:

1. TERMINOLOGIA: troque "publicação/publicada" por "listagem/listada" em TODO o
   portal. "Ver publicação" vira "Ver listagem".

2. REFRAME DO STATUS (ponto importante de curadoria): hoje mostra o par binário
   "Publicada / Não publicada", que soa como "feito × não feito". Troque por:
   - Quando há link: rótulo "Listada" (verde discreto) + o link.
   - Quando não há link: rótulo "Não listada" em tom NEUTRO (nada de amarelo/
     alerta), seguido do MOTIVO como uma nota editorial (ex: "marca sem saída
     relevante"). Não é falha nem pendência — é uma decisão de curadoria.

3. CONTADORES: remova os cards de contagem do topo "X/Y publicadas" e
   "N marketplaces". Substitua por dois números que agregam valor: "Marcas"
   (total de marcas) e "Listagens ativas" (total de resultados COM link).
   Remova também o subtítulo "X de Y publicadas" de cada marca.

4. RUÍDO DO BOTÃO: o botão "Ver listagem" cheio se repete dezenas de vezes e
   polui. Rebaixe-o para um LINK discreto com seta (ou torne a linha inteira
   clicável), reservando o azul risd cheio para no máximo uma ação principal
   por bloco.

5. DUAS ABAS: separe o conteúdo do portal em duas abas — "Listagens" e
   "Atualizações do projeto" (as anotações visíveis ao cliente).

6. BUSCA E FILTROS na aba Listagens: barra de busca por marca + filtros por
   marketplace e por status (listada / não listada). Reaproveite o VISUAL dos
   controles de lista já usados internamente (ListControls), mas filtrando
   apenas sobre os dados já escopados do cliente. Pense em paginação.

7. LIGHTBOX NAS IMAGENS (aba Atualizações): ao clicar numa imagem, abra uma
   visualização ampliada (modal via React PORTAL para o z-index ficar por cima
   de tudo). NÃO enfraqueça a sanitização: o DOMPurify no ponto único de
   leitura continua igual; o lightbox age só na camada de render.

8. CONTRASTE DO TEMA CLARO: o modo escuro está ótimo; o claro tem pouco
   contraste e não dá para ver onde começam/terminam as áreas. Ajuste os
   tokens: cards brancos sobre fundo levemente cinza, bordas platinum
   VISÍVEIS, texto com contraste adequado.

9. IDENTIDADE DOS MARKETPLACES: cor da marca no "pill" + ícone GENÉRICO de
   loja/etiqueta (NÃO use logos oficiais de terceiros). Centralize as cores num
   mapa único:
   - Mercado Livre: fundo #FFE600, texto #2D3277
   - Shopee: fundo #EE4D2D, texto #FFFFFF
   - Amazon: fundo #232F3E, texto #FFFFFF, acento #FF9900

Ao terminar, me mostre o portal nos dois temas e confirme que NADA de operação
interna (tarefas, tempo, atrasos) foi exposto e que o conjunto de dados do
cliente continua o mesmo de antes. Depois faça commit + push.
```

---

## PASSO 27 — Aba "Andamento" no Portal do Cliente (Feito)

Mecânica: dar ao cliente a sensação de movimento ("estamos trabalhando nisto" +
"isto foi entregue") SEM abrir a operação interna. É a primeira NOVA fonte de
dados no portal desde o passo 25 — por isso é passo próprio, não polimento.

Decisões de produto tomadas antes de codar:
- Fora as tarefas PADRÃO e DIÁRIAS: são internas e repetitivas, criariam um
  mural de repetição inútil para o cliente.
- Fora as de LISTAGEM: já vivem na aba Listagens, duplicariam.
- Só `iniciada` e `finalizada` — nada da fila "a fazer", atrasadas ou canceladas.
- Só título + data de conclusão. Zero tempo, prazo, atraso ou responsável.
- OPT-OUT automático: os títulos das tarefas já são escritos pensando que serão
  lidos por clientes, então o feed aparece sozinho, com um botão "ocultar do
  cliente" por exceção. (Descartamos o opt-in por atrito desnecessário.)

```
Vamos adicionar uma aba "Andamento" ao PORTAL DO CLIENTE (a tela externa e
blindada do Passo 25). É a superfície mais sensível do sistema — priorize
ISOLAMENTO e CURADORIA acima de tudo. Leia docs/ESPECIFICACAO.md (Passo 25)
antes de começar.

REGRAS INEGOCIÁVEIS:
- A blindagem fica no BACKEND/RLS, não só na interface. A consulta do
  Andamento só pode retornar tarefas da EMPRESA DO TOKEN. Trocar token/URL não
  pode vazar outra empresa.
- Mantenha o portal SELF-CONTAINED: NÃO reutilize componentes das telas
  internas de tarefa (eles carregam campos internos). Crie um render próprio e
  enxuto para o cliente, selecionando SOMENTE as colunas curadas abaixo.
- O cliente NUNCA vê: tempo gasto, prazo, atraso, quem executou, o resumo de
  finalização (completion_note), a fila "a fazer", canceladas, nem qualquer
  contagem operacional.

MIGRATION (pequena e segura):
- Adicione a coluna task_instances.client_hidden boolean NOT NULL default false.
- RLS: apenas ADMIN e CONSULTOR da empresa da tarefa podem dar UPDATE nessa
  coluna (reaproveite is_admin() / my_consultant_companies()). Colaborador NÃO
  altera. Ninguém do portal do cliente altera.

QUE TAREFAS ENTRAM NO FEED (filtro exato):
- kind = 'unica' (exclui diárias)
- standard_task_id IS NULL (exclui as vindas do catálogo de tarefas padrão)
- template_type = 'padrao' (exclui as de listagem)
- status IN ('iniciada','finalizada')
- client_hidden = false
- e escopadas à empresa do token.

O QUE O CLIENTE VÊ DE CADA ITEM (só isto):
- Título da tarefa.
- Para finalizada: a DATA de conclusão (finished_at, fuso de Brasília). Sem
  hora, sem tempo gasto.
- Para iniciada: um marcador neutro "Em andamento". Sem data, sem prazo.
- NADA de completion_note, responsável, tempo, prazo ou atraso.

LAYOUT DA ABA:
- Nova aba "Andamento" ao lado de "Listagens" e "Atualizações do projeto".
- A aba SÓ aparece se houver ao menos 1 item visível.
- Timeline curada: "Em andamento" no topo, depois os "Entregues" em ordem
  cronológica reversa.
- ESCALA: use a paginação no servidor já existente ("ver mais").
- Tema claro/escuro e responsividade, no padrão visual do portal reformulado.

CONTROLE "OCULTAR DO CLIENTE" (lado interno, opt-out por exceção):
- Na tela de detalhe da tarefa (interna), para as tarefas ELEGÍVEIS ao feed,
  um toggle "Ocultar do cliente / Mostrar ao cliente" que grava client_hidden.
- Só admin/consultor da empresa veem e usam. Colaborador não.
- Não mostre o controle em tarefas que nunca entrariam no feed (diária, padrão,
  listagem) — evita ruído.

VALIDAÇÃO FINAL (obrigatória):
1. Me EXPLIQUE qual é a camada real de isolamento e como os campos
   operacionais ficam de fora por construção (não por esconder na tela).
2. Depois me deixe testar: conferir que NÃO aparece nenhuma diária/padrão/
   listagem, nenhuma a_fazer/atrasada/cancelada, nenhum tempo/prazo/
   responsável; ocultar uma tarefa pelo lado interno e confirmar que some do
   portal; tentar burlar (trocar token, senha errada) e continuar bloqueado.

Ao final, commit + push.
```

---

## PASSO 28 — Indicador global de timer ativo (Feito)

Problema que originou: usuários esqueciam tarefas com o timer rodando ao sair
para o intervalo ou no fim do expediente. Até então o sistema só tinha o
REMÉDIO (correção de tempo com auditoria, passo 16) — faltava a PREVENÇÃO.

Decisões de produto:
- Vale para os TRÊS cargos (admin e consultor também executam via "Meu
  Trabalho" desde o passo 14).
- O indicador não só leva à tarefa: tem "Pausar" embutido, senão a pessoa ainda
  precisa navegar para resolver. "Finalizar" fica na tela da tarefa (exige o
  resumo).
- 2+ timers simultâneos contam tempo EM DOBRO — o indicador sinaliza isso com
  destaque, porque quase sempre é engano.
- O título da aba do navegador também mostra o timer, para denunciar mesmo com
  a aba em segundo plano.

```
Quero adicionar um INDICADOR GLOBAL DE TIMER ATIVO, visível em todas as telas
autenticadas, para prevenir que usuários esqueçam tarefas com o timer rodando.

ONDE E PARA QUEM:
- Num shell/layout compartilhado por TODOS os painéis autenticados (admin,
  consultor, colaborador e "Meu Trabalho"). Todos os cargos executam tarefas.
- Deve persistir ao navegar entre telas.

QUANDO APARECE:
- Somente quando o USUÁRIO LOGADO tem um ou mais time_entries ABERTOS
  (ended_at IS NULL). Se não houver nenhum, não aparece.
- ESCOPO ESTRITO: apenas os timers do próprio usuário (não confie só no RLS —
  um admin poderia enxergar timers de terceiros).

TEMPO AO VIVO (sem martelar o banco):
- Busque os time_entries abertos e os started_at UMA vez ao montar; calcule no
  CLIENTE, com tick de 1s. Não faça query por segundo.
- Reatualize ao trocar de rota e com um poll leve (30-60s), para capturar
  timers iniciados/pausados em outra aba.

COMPORTAMENTO:
- 1 timer ativo: "pill" flutuante compacto com ponto pulsante (risd), título da
  tarefa, tempo correndo; clicar no corpo LEVA à tarefa; botão "Pausar" pausa
  ali mesmo (reaproveite a lógica de pause existente, sem duplicar regra).
- 2+ timers: mostra "N tarefas ativas" e expande a lista (título + tempo +
  "Pausar" por linha). Como rodar 2 timers juntos conta tempo em DOBRO,
  sinalize com destaque visual de atenção (discreto, não alarmista).

VISUAL (não intrusivo):
- Base da tela: desktop centralizado embaixo; mobile acima da navegação
  inferior, respeitando safe-areas. Nunca cobrindo ações importantes.
- Pode COLAPSAR para um chip mínimo, mas NÃO permita esconder totalmente
  enquanto há timer ativo — o objetivo é lembrar.
- Paleta da marca, tema claro/escuro, responsivo, sem emojis em botão.

REFORÇO NO TÍTULO DA ABA:
- Enquanto houver timer ativo, atualize o document.title ("▶ 01:23 · <tarefa>"
  ou "▶ N tarefas ativas"). Restaure ao não haver nenhum.

Teste: iniciar e ver o indicador contar em todas as telas; navegar e confirmar
que persiste; pausar pelo indicador; abrir um segundo timer e conferir o modo
"2+ ativas"; conferir mobile e os dois temas.

Ao final, commit + push.
```

### PASSO 28.1 — Correção: tempo do indicador divergindo do timer real (Feito)

Sintomas observados em produção: pill marcando 02:11 enquanto o timer principal
marcava 02:26 (atraso progressivo), e pill zerando para 00:00 ao navegar
enquanto o timer real estava em 06:10.

Causa suspeitada: o pill ACUMULARIA ticks a partir do momento em que montou, em
vez de DERIVAR o tempo do `started_at` do banco.

**Causa REAL (achada na investigação, diferente da suspeita):** o pill já
derivava de `started_at` — o que faltava era o `total_seconds`. Ele exibia
apenas o INTERVALO ABERTO (`agora − started_at`), enquanto a tela da tarefa
exibe o TOTAL (`total_seconds + intervalo aberto`). Por isso o pill marcava
00:00 logo após retomar uma tarefa com 6h10 já registradas, e por isso a
diferença parecia um atraso progressivo quando na verdade era o offset fixo do
tempo anterior. Um indicador que SUBESTIMA o tempo é pior que nenhum —
tranquiliza justamente quem deveria estar sendo lembrado.

APLICADO: helper compartilhado `src/lib/timer.ts` (`taskElapsedSeconds`,
`formatClock`, `formatElapsedCompact`, `parseStartedAt`) como fonte de verdade
única, usado pelo `Timer` da tela da tarefa e pelo `ActiveTimerIndicator`. O
pill passou a buscar `task_instances.total_seconds` junto do `time_entry`
aberto. O `parseStartedAt` marca a string como UTC caso venha sem offset (sem
isso, o fuso de Brasília deslocaria o tempo em 3h). Somado a isso, o pill
ressincroniza também no evento `online` (reconexão), além do `visibilitychange`
e do poll que já existiam.

```
BUG no indicador global de timer ativo (o pill flutuante): o tempo mostrado não
bate com o timer da tela da tarefa. Dois sintomas: atraso progressivo (~15s) e
volta para 00:00 ao navegar.

CAUSA PROVÁVEL: o pill ACUMULA ticks a partir da montagem, em vez de DERIVAR do
started_at vindo do banco. Confirme antes de corrigir.

CORREÇÃO — regra única:
- O tempo exibido NUNCA é acumulado. A cada tick, RECALCULE do zero:
  tempo = total_seconds (do banco) + (Date.now() - started_at do time_entry
  aberto). O setInterval serve apenas para disparar o re-render.
- Assim, remontar, trocar de rota ou perder ticks não afeta o número — ele se
  autocorrige a cada segundo.
- Garanta que started_at é interpretado como UTC/timestamptz (não parseie como
  hora local).

CONSISTÊNCIA COM O TIMER PRINCIPAL:
- O pill deve mostrar EXATAMENTE o mesmo número da tela da tarefa: o tempo
  TOTAL da tarefa (total_seconds + intervalo aberto), não só a sessão atual.
- Se os dois têm lógicas separadas, EXTRAIA para um único helper compartilhado
  (ex: lib/timer.ts) e use nos dois. Uma fonte de verdade só.

ROBUSTEZ:
- Ao voltar o foco para a aba (visibilitychange) e ao reconectar, ressincronize
  buscando os time_entries abertos, para capturar pausas de outra aba.
- Se foi pausado/finalizado em outro lugar, o pill deve sumir, não continuar
  contando um timer que não existe mais.

TESTE: comparar pill × timer principal por alguns minutos (devem bater ao
segundo); navegar e confirmar que não zera; deixar a aba em segundo plano 2-3
minutos e confirmar a autocorreção; pausar pelo pill.

Ao final, commit + push.
```

---

## PASSO 29 — Otimização de performance: navegação lenta (Feito)

Sintoma relatado: lentidão ao transitar entre telas, com a Vercel um pouco mais
lenta que o build de produção local (`next start`).

Diagnóstico (o achado importante): **o gargalo NÃO era query nem falta de
índice**. O banco é pequeno (398 task_instances) e o Postgres responde
instantaneamente. O custo era: (a) número de idas ao Supabase × latência de
cada ida, e (b) — o maior de todos — `isomorphic-dompurify` (jsdom) importado
no topo de `src/lib/notes.ts`, custando ~1,5s de carregamento a cada COLD START
em 4 rotas, incluindo o portal do cliente. Local o processo fica vivo e paga
uma vez; na Vercel paga a cada cold start. Isso explicava exatamente o
"intermitente" e o "Vercel mais lenta que local".

APLICADO:
- ✅ jsdom fora do caminho de render (carregador preguiçoso memoizado em
  `getNoteSanitizer`). Medido: 739ms → 105ms de carregamento do módulo da rota
  (−634ms por cold start). Versão do isomorphic-dompurify mantida em **2.26.0**
  — 2.27+ derruba a produção com ERR_REQUIRE_ESM.
- ✅ Região das funções da Vercel alinhada para **gru1 (São Paulo)**, junto do
  Supabase em sa-east-1. Corta ~60% da latência de cada ida ao banco. Feito
  pelo painel; NÃO há `vercel.json` (decisão consciente: evitar duas fontes de
  verdade).
- ✅ `guardRole` memoizado com `cache()` do React — deduplica a validação
  dentro do mesmo request, sem enfraquecer autorização (cada página continua
  fazendo a própria checagem).
- ✅ Waterfalls desfeitos: central da empresa (loadCompanyCentral +
  loadCompanyListings + loadCompanyNotes em Promise.all, 3 ondas → 1);
  `/admin/tarefas` e `/colaborador` com labels em paralelo.

RECUSADO / ADIADO (decisões conscientes, não esquecimento):
- ❌ **Middleware repassando `user.id` via header** para matar a validação
  duplicada de auth: RECUSADO. Economizaria ~110ms, mas transformaria um header
  de request em fonte de verdade de identidade, num sistema com tela pública de
  cliente. Risco não compensa.
- ❌ **Join direto do criador da tarefa** (em vez da RPC `display_profiles`):
  RECUSADO. A policy `profiles_select` não deixa um consultor ler perfil de
  OUTRO consultor — o join devolveria null e o "criada por [nome]" sumiria
  SILENCIOSAMENTE de 64 tarefas na central do consultor, para ganhar 41ms. O
  caminho seguro seria uma RPC SECURITY DEFINER com o nome embutido; é mudança
  de modelagem, merece passo próprio.
- ⏸️ **Layout por área (`layout.tsx`) para a sidebar parar de piscar**: ADIADO
  por decisão de produto. O ganho é de aparência, não de velocidade, e o custo
  é refatoração estrutural em todas as páginas. Se um dia for feito, a opção
  escolhida foi a **2 — título/subtítulo/voltar descem para o conteúdo da
  página** (mantém tudo server-rendered, sem flicker de título e sem duplicar a
  árvore de rotas como exigiria parallel routes).
- ⏸️ **Índices novos**: NÃO criar agora. Com 398 linhas o seq scan é mais
  rápido; `idx_task_instances_status` inclusive é quase inútil (baixa
  cardinalidade). Revisitar quando o volume justificar.

Instrumentação: `PERF_LOG=1` liga tabelas `[perf]` por tela (desligada por
padrão, custo zero em produção; funciona também nos Runtime Logs da Vercel).

---

## PASSO 30 — Governança do acesso do cliente + "Ver como cliente" (Feito)

**Resultado da PARTE 0 (diagnóstico), antes de qualquer mudança:**
- A senha JÁ estava com hash forte (`crypt(..., gen_salt('bf'))` — bcrypt). O
  item que o prompt temia como mais urgente (texto puro) **não existia**.
- Nenhuma tela devolvia a senha depois de criada.
- **O furo real era outro:** a senha era ESCOLHIDA E DIGITADA pelo admin ou
  consultor. Ou seja, quem criava sabia a senha para sempre — e "revelar uma
  única vez" não significa nada quando a pessoa é quem inventou a senha.
- Gestão liberada para admin **ou consultor** da empresa (funções e policy).
- Volume a migrar: 2 acessos, ambos ativos, ambos criados por admin.

**Decisões tomadas na retomada (além das já registradas abaixo):**
- Consultor mantém um **status somente-leitura** (existe / está ativo) e o
  "Ver como cliente". Ele precisa saber se o cliente já tem portal para
  conduzir a relação; a credencial é que nunca passa perto dele.
- As 2 senhas existentes **continuam valendo** — o hash já era forte e
  invalidá-las derrubaria clientes sem ganho real. Elas ficam marcadas como
  do modelo antigo (`password_generated=false`), e a tela sugere a troca.
- "Ver como cliente" em **rota própria em tela cheia**, não modal.

⚠️ Este passo é PRÉ-REQUISITO do passo 31 (mensagens). A garantia de que um
funcionário não forja mensagem de cliente depende desta base: se a senha do
portal for legível por gente de dentro, qualquer regra de autoria é aparência.

Decisões de produto tomadas antes de codar:
- Só ADMIN vê/gera/revoga/redefine link e senha. Consultor e colaborador perdem
  esse acesso por completo — não por proibição, mas porque a credencial nunca
  passa perto deles.
- A senha é hasheada e revelada UMA ÚNICA VEZ, na geração. Nem o admin recupera
  depois. Assim, se passar pelo cliente exige REDEFINIR a senha — o que derruba
  o acesso do cliente e deixa rastro em auditoria (deixa de ser golpe
  silencioso).
- Entrega do acesso ao cliente: **manual, pelo admin, por fora do sistema**
  (opção A). O sistema NÃO envia e-mail hoje (a mensageria existente é Digisac/
  WhatsApp, e credencial em grupo de WhatsApp não é adequado). Integrar
  provedor de e-mail fica para o futuro, se necessário.
- Consultor/colaborador NÃO precisam do portal: a conversa e os dados vivem no
  banco, e eles acessam pela central da empresa com a própria conta. O portal é
  só a janela de quem não tem conta.
- Limite honesto e consciente: o ADMIN vê a senha no instante em que a gera.
  Admins seguem sendo a fronteira de confiança. Eliminar isso exigiria abandonar
  senha fixa e usar link mágico por e-mail.

```
Vamos reformular a GOVERNANÇA DO ACESSO DO CLIENTE (o link + senha do Passo 25)
e adicionar um "Ver como cliente" para a equipe. Isso é pré-requisito de um
recurso de mensagens que vem depois. Leia docs/ESPECIFICACAO.md (Passo 25)
antes de começar.

PARTE 0 — DIAGNÓSTICO (faça primeiro e me REPORTE antes de mudar):
- Como a senha do portal está armazenada hoje? Texto puro, hash fraco ou hash
  forte? E ela é exibida em alguma tela depois de criada?
- Quem hoje consegue ver/gerar/revogar link e senha (admin, consultor)?
Se for texto puro, isso é o item mais urgente.

PARTE 1 — SÓ ADMIN GERENCIA O ACESSO:
- Ver, gerar, revogar e redefinir link/senha passa a ser exclusivo de ADMIN.
- Reforce no BANCO (RLS), não só escondendo botão: nenhuma query de consultor/
  colaborador pode retornar o token nem o hash da senha.

PARTE 2 — SENHA HASHEADA E REVELADA UMA ÚNICA VEZ:
- Guardar com HASH FORTE (bcrypt ou pgcrypto), nunca recuperável. Migre o que
  existe hoje.
- Ao gerar/redefinir, a senha em claro é exibida UMA ÚNICA VEZ ao admin, com
  botão de copiar e aviso claro. Depois disso, nenhuma tela e nenhuma query
  devolve a senha — nem para admin.
- Se o cliente perder, o caminho é REDEFINIR, nunca consultar.
- A verificação continua no servidor, com o rate limit já existente.

PARTE 3 — AUDITORIA:
- Registre toda geração, redefinição e revogação: quem, quando, qual empresa,
  qual ação. Reaproveite o padrão de auditoria já usado no projeto.
- Mostre o histórico ao admin na tela de gestão do acesso.

PARTE 4 — "VER COMO CLIENTE" (pré-visualização autenticada):
- Admin e consultor (este só nas empresas dele) abrem uma PRÉ-VISUALIZAÇÃO
  somente-leitura da tela do cliente, pela PRÓPRIA CONTA — sem token e sem
  senha.
- SEGURANÇA: não pode usar nem revelar o token/senha, e não cria sessão de
  portal. É rota interna que reaproveita os COMPONENTES de apresentação do
  portal, alimentados por consulta escopada e autorizada pelo cargo.
- Somente LEITURA: nenhuma ação de escrita nesse modo.
- Deixe inequívoco que é pré-visualização (faixa discreta no topo,
  "Pré-visualização — é isto que o cliente vê", com botão de sair).

UX/UI — padrão alto (requisito, não detalhe):
- Tela de gestão do acesso clara e tranquilizadora: estado (ativo/revogado),
  data de criação, quem gerou, link com copiar, e ações separadas por peso —
  gerar/copiar discretas, REVOGAR e REDEFINIR com confirmação explícita.
- O momento de revelar a senha merece cuidado: bloco bem desenhado, senha
  legível, copiar em um clique, aviso de "só desta vez" claro sem ser alarmista.
- Identidade da marca, tema claro/escuro, responsivo, foco de teclado visível.

VALIDAÇÃO (me deixe testar):
- Consultor e colaborador não obtêm token/senha por tela NEM por query direta.
- Gerar senha: aparece uma vez, some depois, e o acesso funciona.
- Redefinir: o acesso antigo para de funcionar e fica na auditoria.
- "Ver como cliente": consultor abre só as empresas dele; tela idêntica à do
  cliente, somente leitura, sem expor credencial.

Ao final, me EXPLIQUE qual é a garantia real de que um funcionário não consegue
se passar pelo cliente — e qual é o limite honesto dessa garantia. Depois
commit + push. As MENSAGENS vêm no próximo passo; não faça agora.
```

### O que foi aplicado (migration 0032)

- **Gestão exclusiva de admin**, reforçada no banco em DOIS lugares: a policy
  `cpa_select` passou a exigir `is_admin()` e as funções de escrita idem.
- **Senha sorteada pelo banco** (`client_portal_gen_password`, 16 caracteres de
  um alfabeto de 32 sem ambiguidade — sem i/l/o/1, porque um humano transcreve
  isso; ~80 bits, em grupos de 4 para ser ditável por telefone). Devolvida em
  claro **uma única vez**, no retorno de `client_portal_set`.
- **Auditoria** em `client_portal_audit` (criado / senha_redefinida /
  link_girado / revogado), sem policy de UPDATE nem DELETE — ninguém edita nem
  apaga o próprio rastro. `client_portal_admin_view` traz estado + histórico
  numa ida só (disciplina do passo 29).
- **"Ver como cliente"** em `/admin/empresas/[id]/ver-como-cliente` e
  `/consultor/[companyId]/ver-como-cliente`: sem AppShell, faixa de
  pré-visualização, somente leitura, sem token, sem senha e sem criar sessão
  de portal.
- **Curadoria fatorada** (a decisão de arquitetura que mais importa): o
  conteúdo do portal virou `client_portal_payload` /
  `client_portal_progress_payload`, chamadas pelos DOIS caminhos (sessão do
  cliente e preview). E a casca visual virou `PortalView`, usada pelas duas
  telas. Assim a pré-visualização **não tem como divergir** do que o cliente
  vê — nem no dado nem na forma.

### Validação executada no banco (simulando cada cargo)

| Tentativa (como consultor) | Resultado |
|---|---|
| `SELECT` direto em `client_portal_access` | 0 linhas |
| `SELECT` direto na auditoria / nas sessões | 0 linhas |
| Gerar senha / girar link / revogar | bloqueado |
| Ler token pela visão de admin | bloqueado |
| Preview de empresa que **não** é dele | bloqueado |
| Preview e status da empresa **dele** | permitido |

Como admin (em transação revertida): senha sorteada abre o portal; senha
errada e token forjado respondem `invalid` igualmente; a senha em claro não
fica em lugar nenhum (só o hash bcrypt); a auditoria registrou a ação.

**Garantia real de autoria — e o limite honesto.** Um consultor ou colaborador
não consegue se passar pelo cliente: a senha nunca esteve ao alcance dele
(nem por tela nem por query), e o preview é uma rota interna que não cria
sessão de portal. O **admin**, porém, vê a senha no instante em que a gera —
ele é, e segue sendo, a fronteira de confiança. O que o passo 30 acrescenta é
que usar a senha do cliente deixa de ser silencioso: como ela não é
recuperável, quem perdeu precisa REDEFINIR, o que derruba o acesso do cliente
e grava uma linha na auditoria. Eliminar esse resíduo exigiria abandonar senha
fixa e adotar link mágico por e-mail — o sistema não envia e-mail hoje.

---

## PASSO 31 — Mensagens cliente ↔ equipe (planejado, depende do 30)

⚠️ É a primeira vez que o portal RECEBE ESCRITA — até aqui era só leitura, o
que simplificava muito a blindagem. Só comece depois do passo 30 validado.

Decisões de produto:
- O cliente escreve SEM criar conta, pela sessão do portal que já existe.
- A equipe responde pela central da empresa, com a conta autenticada — nunca
  pelo portal. Uma conversa, duas janelas.
- Autoria é carimbada no SERVIDOR pela sessão, nunca vinda do navegador.
- Mensagens IMUTÁVEIS: ninguém edita nem apaga, nem admin.
- Texto puro (sem HTML) — mantém a rota do portal leve, sem jsdom.

```
Vamos adicionar MENSAGENS entre o cliente e a equipe. É a primeira vez que o
PORTAL DO CLIENTE recebe ESCRITA. Trate com o mesmo rigor do Passo 25. Leia
docs/ESPECIFICACAO.md (Passos 25 e 30) antes de começar. O passo 30
(governança do acesso: só admin, senha hasheada e revelada uma vez) precisa
estar aplicado — a integridade da autoria depende dele.

MODELO DE DADOS (migration):
- Tabela company_messages: company_id, body (TEXTO PURO, sem HTML),
  author_type ('cliente' | 'interno'), author_id (uuid, NULL quando cliente),
  created_at, e metadados de proveniência para mensagens de cliente (hash do
  IP, user agent, id da sessão do portal).
- MENSAGENS SÃO IMUTÁVEIS: não crie policy de UPDATE nem de DELETE para
  ninguém — nem admin.
- Limite de tamanho do body (ex: 2000 caracteres), validado no servidor.

INTEGRIDADE DE AUTORIA (requisito central):
- author_type e author_id NUNCA vêm do navegador. São carimbados no SERVIDOR:
  · Sessão do portal -> author_type='cliente', author_id NULL.
  · Usuário logado  -> author_type='interno', author_id = auth.uid().
- RLS: nenhum usuário autenticado pode inserir linha com author_type='cliente'.
  Nenhuma tela interna oferece caminho para escrever como cliente.
- Me EXPLIQUE ao final a garantia real de autoria e o LIMITE honesto dela.

ESCRITA DO CLIENTE (no portal):
- Campo de mensagem, sem criar conta — usa a sessão do portal existente.
- TEXTO PURO apenas. Escape na exibição. NÃO passe por DOMPurify/jsdom
  (mantemos essa rota leve, como otimizado no passo 29).
- Sem anexos nesta etapa.
- RATE LIMIT no envio, reaproveitando o padrão do rate limit da senha.
- ISOLAMENTO: a consulta só retorna mensagens da empresa do token, garantido no
  BACKEND/RLS.

RESPOSTA INTERNA:
- Na central da empresa (admin e consultor) e na tela da empresa do
  colaborador, aba/seção "Mensagens" com a conversa em ordem cronológica e o
  campo de resposta.
- Visualmente ÓBVIO quem falou: cliente vs. equipe (com o nome de quem
  respondeu, do lado interno).
- O cliente vê as respostas no portal, mas NUNCA nada operacional — a curadoria
  do Passo 25 continua valendo.
- Escopo: consultor só nas empresas dele; admin em todas.

Identidade visual, tema claro/escuro, responsividade nos dois lados. Escala:
paginação/"ver mais" na conversa.

VALIDAÇÃO: cliente envia e equipe responde; tentar burlar (trocar token, senha
errada, enviar para outra empresa, forjar author_type pelo payload) — tudo
bloqueado; ninguém edita nem apaga mensagem (nem admin); cliente segue sem ver
nada operacional.

Ao final, commit + push. A caixa de entrada vem no próximo passo.
```

---

## PASSO 32 — Caixa de entrada de mensagens + badge de não lidas (planejado)

Requisito que originou: consultores e colaboradores NÃO podem ser obrigados a
abrir o portal (nem a central) de cada cliente para descobrir se há mensagem.
Tem que ser prático e imediato.

Decisão pendente antes de codar: colaboradores também recebem notificação? O
vínculo deles com a empresa é DERIVADO (têm tarefa lá), então tende a ser
barulhento. Sugestão: notificar **consultores da empresa + admins**; o
colaborador vê a conversa ao abrir a empresa, sem badge próprio.

```
Adicione uma CAIXA DE ENTRADA única de mensagens, para que ninguém precise
abrir empresa por empresa para saber se um cliente escreveu.

- Item na sidebar (visível de qualquer tela) com BADGE de não lidas.
- Tela de caixa de entrada listando as conversas com mensagem não lida
  primeiro: nome da empresa, trecho da última mensagem, data. Clicar leva
  direto à conversa daquela empresa.
- Escopo: admin vê todas; consultor só as empresas dele. Confirme no RLS.
- Marcação de lido por USUÁRIO (uma tabela de leitura por usuário/empresa), não
  global — se o admin lê, o consultor não pode perder a notificação.
- Pense em custo: o badge não pode disparar consulta pesada a cada navegação.
- Identidade visual, tema claro/escuro, responsivo.

Teste: cliente envia mensagem e o badge aparece para o consultor certo; ler
zera o badge só de quem leu; consultor não vê conversa de empresa que não é
dele.
```

---

# ITENS ARQUIVADOS E DECISÕES EM ABERTO

Registro do que foi CONSCIENTEMENTE deixado de lado, para não parecer
esquecimento numa retomada futura:

- **Consultor/admin atribuindo tarefa a outro CONSULTOR** — prompt foi
  escrito e depois ARQUIVADO por decisão do Mauricio ("vou dar pra trás").
  Hoje os seletores de responsável listam colaborador + admin. Se retomar,
  o cuidado central é: o consultor que RECEBE a tarefa deve poder executá-la
  sem ganhar acesso ao resto da empresa de outro consultor.
- **Agregado do dashboard via RPC** — PENDÊNCIA CONHECIDA e não é só
  performance: `/admin` busca todas as task_instances do período sem `.limit()`
  e agrega em JavaScript. Com o volume crescendo (recorrência diária × 118
  empresas), o teto padrão de linhas do PostgREST pode fazer os números do
  dashboard ficarem **silenciosamente errados** — sem erro, sem aviso. O
  caminho é agregar no banco, como já se faz em `company_overview`.
- **Impedir dois timers simultâneos** — em aberto. Hoje o passo 28 apenas
  TORNA VISÍVEL que há mais de um rodando (o que conta tempo em dobro). Falta
  decidir se o sistema deve pausar o anterior automaticamente ao iniciar outro.
- **Layout por área / sidebar que pisca** — adiado (ver passo 29).
- **Sistema de notificações completo** (in-app + WhatsApp + e-mail, 4 camadas)
  — adiado desde antes; o passo 32 resolve só a fatia de mensagens.
- **Módulo estilo Monday** (quadros/colunas flexíveis, faturamento por cliente)
  — existe plano detalhado em PLANO_FASE2_QUADROS.md, sem decisão.
- **Logos oficiais dos marketplaces** — decidido NÃO usar (passo 26). Se um dia
  mudar, as cores estão centralizadas num mapa único.
- **Envio automático do acesso por e-mail** — o sistema não manda e-mail hoje.
  Entrega segue manual pelo admin (passo 30).


## Dicas gerais ao usar o Claude Code

- **Teste cada passo no navegador** antes de avançar. Se algo quebrar, 
  descreva o erro pro Claude Code — ele corrige.
- **Nunca** deixe tokens no código. Tudo via variáveis de ambiente / 
  secrets das Edge Functions.
- Se uma tela ficar diferente da identidade visual, peça: "ajuste para 
  seguir a paleta da marca em tailwind.config.ts".
- Faça commits no Git a cada passo concluído E envie ao GitHub: peça ao 
  Claude Code "faça um commit e push do que construímos". O push é o que 
  envia de fato para o GitHub — sem ele, o trabalho fica salvo só no seu PC.
- Se o limite de uso estourar no meio de um passo, não se preocupe: o que 
  já foi salvo está no projeto. Ao voltar, abra o Claude Code e diga "estou 
  retomando, leia docs/ESPECIFICACAO.md e docs/ROTEIRO_PROMPTS.md; já 
  fizemos até o passo X; verifique se algo ficou pela metade e continue".
- Para correções de bug, descreva o comportamento errado E o esperado. 
  Quanto mais concreto (o que você fez, o que aconteceu, o que deveria 
  acontecer), melhor o Claude Code resolve.
- Lembre de **trocar o token da Digisac** antes de ir para produção.
```