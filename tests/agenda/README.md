# Testes de lógica pura — Agenda/Reuniões

Testes automatizados da auditoria da frente de agenda (nov/2026). Sem framework:
usam o runner nativo do Node (`node:test`). Nada aqui toca rede, Google ou banco.

```
node --test tests/agenda/*.test.mjs
```

| Arquivo | O que cobre |
|---|---|
| `datetime-grade.test.mjs` | Datas da grade em BRT fixo (-03): virada de dia/mês/ano, dez/2026→jan/2027, semana no domingo, mês de 5/6 semanas, evento cruzando a meia-noite, `addMonths` com clamp; layout de sobreposição (3+ eventos, clusters, 15 min). |
| `import-classificacao.test.mjs` | `toImportRow` (o que entra no espelho importado: cancelado/all-day/recusado/particular/sem título) e `toForwardOp` (ops do auto-sync Google→CRM: A1 cancel explícito, A6 sem_horario/horario_invalido, A11 recorrente + dedupe por mestre, extração do Meet). |
| `convidados-diff.test.mjs` | Diff de convidados do `updateMeeting` (B16): quem fica não é tocado (preserva resposta, não re-notifica), remove só quem saiu, insere só quem entrou; falha de leitura não apaga às cegas; validações do servidor; criação sem Google conectado. |
| `harness.mjs` | Infra: transpila os arquivos "use server" REAIS (com o `typescript` do repo), substitui imports de infraestrutura por stubs e expõe funções internas para teste — sem alterar o fonte. Inclui um mock mínimo do cliente Supabase que grava as operações para inspeção. |

As funções `toImportRow`/`toForwardOp` não são exportadas (arquivo "use server" só
exporta actions async) — o harness as expõe via transpilação. Se um dia forem
extraídas para um módulo puro, troque para import direto e aposente o harness.
