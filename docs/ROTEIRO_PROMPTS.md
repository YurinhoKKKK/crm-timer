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