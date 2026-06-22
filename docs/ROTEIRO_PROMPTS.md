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

## PASSO 6 — Painel do consultor

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

## PASSO 7 — Dashboards do admin

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

## PASSO 8 — Recorrência (pg_cron) e finalização

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

## Dicas gerais ao usar o Claude Code

- **Teste cada passo no navegador** antes de avançar. Se algo quebrar, 
  descreva o erro pro Claude Code — ele corrige.
- **Nunca** deixe tokens no código. Tudo via variáveis de ambiente / 
  secrets das Edge Functions.
- Se uma tela ficar diferente da identidade visual, peça: "ajuste para 
  seguir a paleta da marca em tailwind.config.ts".
- Faça commits no Git a cada passo concluído (peça ao Claude Code: 
  "faça um commit com o que construímos").
- Lembre de **trocar o token da Digisac** antes de ir para produção.
```
