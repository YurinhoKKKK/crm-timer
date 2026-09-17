# Contrato — Intake do CRM comercial

Este documento é o **contrato da ponta que RECEBE** clientes fechados do CRM
comercial e cria a empresa em **On Boarding**. É o que o outro lado (o CRM que
ENVIA) precisa para ser construído.

- **Formato:** JSON em requisição e resposta (`Content-Type: application/json`).
- **Método:** sempre `POST`.
- **Autenticação:** segredo compartilhado no cabeçalho (abaixo).
- **Fuso/datas:** datas são **texto** `AAAA-MM-DD` (sem hora, sem fuso).

---

## 1. Configuração no servidor (uma vez)

Duas variáveis de ambiente (na Vercel: Project → Settings → Environment
Variables; local: `.env.local`). **Nunca** commitar valores.

| Variável | Para que serve |
|---|---|
| `CRM_INTAKE_SECRET` | Segredo compartilhado. O CRM envia o mesmo valor no cabeçalho `x-crm-secret`. Gere algo longo e aleatório (ex.: `openssl rand -hex 32`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key do Supabase (Project Settings → API). Usada só no servidor para chamar as RPCs. Sem prefixo `NEXT_PUBLIC_`. |

Se qualquer uma faltar, os endpoints respondem `500 server_misconfig`.

---

## 2. Cabeçalhos (nos dois endpoints)

| Cabeçalho | Obrigatório | Descrição |
|---|---|---|
| `Content-Type: application/json` | sim | Corpo é JSON. |
| `x-crm-secret` | sim | O segredo compartilhado. Comparado em tempo constante. |
| `x-crm-source` | não | Identificador livre do chamador (ex.: `crm-comercial`). Só auditoria, máx. 120 chars. |

Segredo ausente/errado → **`401 unauthorized`**.

---

## 3. Endpoint — Criar empresa

```
POST /api/crm/companies
```

Cria a empresa em **On Boarding**, sem consultor e sem colaborador, e preenche
as informações do cliente e os serviços contratados. **Atômico**: cria tudo ou
nada.

### Corpo (campos)

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `number` | inteiro (ou string numérica) | **sim** | Inteiro positivo, até 9 dígitos. É o número do cliente, gerado pelo CRM. Vira o prefixo do nome. Recusa se já estiver em uso. |
| `razao_social` | string | **sim** | 1–200 chars. |
| `contato` | string | não | Máx. 120 chars. Vai entre parênteses no fim do nome. |
| `project_model` | string | não | `bpo` \| `consultoria`. |
| `started_on` | string | não | `AAAA-MM-DD`. |
| `ends_on` | string | não | `AAAA-MM-DD`. Não pode ser antes de `started_on`. |
| `cadence` | string | não | `semanal` \| `quinzenal` \| `semanal_quinzenal` \| `quinzenal_semanal`. |
| `system_used` | string | não | Texto livre, até 5000 chars. |
| `main_pain` | string | não | Texto livre, até 5000 chars. |
| `about` | string | não | Texto livre, até 5000 chars. |
| `contracted_services` | array de string | não | Cada item ∈ `mercado_livre`, `shopee`, `amazon`, `trafego`, `gestao_site`, `desenvolvimento_site`. |

> ⚠️ **`contracted_services` usa o enum `contracted_service` — NÃO é o `sales_channel` do faturamento.** São **taxonomias diferentes, não confundir**:
> - `contracted_service` (**este campo** — o que foi VENDIDO no contrato): `mercado_livre`, `shopee`, `amazon`, `trafego`, `gestao_site`, `desenvolvimento_site`. **Não** tem `site_proprio`; tem tráfego e os dois tipos de site.
> - `sales_channel` (faturamento — canais de RECEITA, outra parte do sistema, **fora deste contrato**): `mercado_livre`, `shopee`, `amazon`, `site_proprio`.
>
> Os valores em comum (`mercado_livre`/`shopee`/`amazon`) têm a mesma grafia por coincidência, mas os conjuntos **não são iguais** e **não se sincronizam**. Envie aqui **apenas** valores do `contracted_service`; qualquer outro (inclusive `site_proprio`) é recusado com `422 validation`.

O **nome** da empresa é montado assim (padrão atual do sistema):

```
{number}. {razao_social} ({contato})     ← "(contato)" só se vier
```

Ex.: `381. ACME COMERCIO LTDA (João)`

### Exemplo de requisição

```bash
curl -X POST https://SEU-DOMINIO/api/crm/companies \
  -H "Content-Type: application/json" \
  -H "x-crm-secret: $CRM_INTAKE_SECRET" \
  -H "x-crm-source: crm-comercial" \
  -d '{
    "number": 381,
    "razao_social": "ACME COMERCIO LTDA",
    "contato": "João",
    "project_model": "bpo",
    "started_on": "2026-09-17",
    "ends_on": "2027-09-17",
    "cadence": "semanal_quinzenal",
    "system_used": "Bling",
    "main_pain": "Sem processo de anúncios",
    "about": "Loja de autopeças",
    "contracted_services": ["mercado_livre", "trafego", "gestao_site"]
  }'
```

### Sucesso — `201 Created`

```json
{
  "ok": true,
  "id": "d9c441da-628b-4e2d-8976-3a85fc0b8049",
  "name": "381. ACME COMERCIO LTDA (João)"
}
```

### Erros

Formato: `{ "ok": false, "error": "<código>", "message": "<texto>", "collision"?: {...} }`.

| HTTP | `error` | Quando | Extra |
|---|---|---|---|
| 401 | `unauthorized` | Segredo ausente/errado. | |
| 400 | `bad_json` | Corpo não é objeto JSON válido. | |
| 422 | `validation` | Campo faltando/ inválido (número, razão, enum, data, tamanho, serviço). | |
| 409 | `number_in_use` | O `number` já é usado por outra empresa. | `collision: { id, name }` |
| 409 | `duplicate` | Já existe empresa **muito parecida** por nome (bloqueio). | `collision: { id, name, group, similarity }` |
| 429 | `rate_limited` | Passou de **60 criações/min**. | |
| 500 | `internal` | Falha interna ao criar. | |
| 500 | `server_misconfig` | Env não configurada no servidor. | |
| 502 | `rpc_error` | Falha de comunicação com o banco. | |

Exemplo de recusa por duplicado:

```json
{
  "ok": false,
  "error": "duplicate",
  "message": "Já existe empresa muito parecida: \"362. MERCADO MULTIPEÇAS LTDA (RODRIGO)\".",
  "collision": {
    "id": "b9baa6a0-ffd6-46f5-a8be-2c0d25d3f3b3",
    "name": "362. MERCADO MULTIPEÇAS LTDA (RODRIGO)",
    "group": "Ativos",
    "similarity": 1.0
  }
}
```

---

## 4. Endpoint — Conferir duplicado

```
POST /api/crm/companies/check-duplicate
```

Consulta (não cria nada): dada uma razão social, devolve as empresas
**parecidas** já existentes. Comparação tolerante — ignora maiúsculas, acentos,
pontuação, sufixos jurídicos (LTDA/ME/EPP/EIRELI/SA) e o número do início do
nome. Serve para o CRM avisar o operador **antes** de fechar.

> Não há CNPJ nesta base: a comparação é por **nome** e **aproximada**.

### Corpo

| Campo | Tipo | Obrigatório |
|---|---|---|
| `razao_social` | string | sim |

### Exemplo

```bash
curl -X POST https://SEU-DOMINIO/api/crm/companies/check-duplicate \
  -H "Content-Type: application/json" \
  -H "x-crm-secret: $CRM_INTAKE_SECRET" \
  -H "x-crm-source: crm-comercial" \
  -d '{ "razao_social": "MERCADO MULTIPECAS" }'
```

### Sucesso — `200 OK`

```json
{
  "ok": true,
  "matches": [
    {
      "id": "b9baa6a0-ffd6-46f5-a8be-2c0d25d3f3b3",
      "name": "362. MERCADO MULTIPEÇAS LTDA (RODRIGO, OLÍMPIO BOGO)",
      "group": "Ativos",
      "similarity": 1.0
    }
  ]
}
```

`matches` vem ordenado da mais parecida para a menos (máx. 20). Lista vazia =
nenhuma parecida. `similarity` vai de 0 a 1.

### Erros

| HTTP | `error` | Quando |
|---|---|---|
| 401 | `unauthorized` | Segredo ausente/errado. |
| 400 | `bad_json` | Corpo inválido. |
| 422 | `validation` | `razao_social` ausente/não-texto. |
| 429 | `rate_limited` | Passou de **120 conferências/min**. |
| 500 | `server_misconfig` | Env não configurada. |
| 502 | `rpc_error` | Falha de comunicação com o banco. |

---

## 5. Regras de negócio (resumo)

- **Número** faz parte do texto do nome; este sistema **não** gera número (chega
  pronto). Empresa **sem número não é criada**. Número já em uso → recusa.
- Nasce em **On Boarding**, sem consultor/colaborador. A distribuição é feita
  depois por um admin, dentro do sistema.
- A criação **também bloqueia** duplicado forte por nome (não é só o
  check-duplicate). Limiar de bloqueio: similaridade ≥ 0,80 **ou** núcleo do nome
  idêntico. O check-duplicate lista a partir de ≥ 0,35. (0,80 foi calibrado contra
  as empresas reais: em 0,72 havia falso positivo entre nomes que só compartilham
  "materiais de construção".)
- Só cria — **não** atualiza, **não** apaga, **não** toca em tarefa, faturamento
  ou usuário.
- Cada chamada é **auditada** (tabela `crm_intake_log`: quando, origem, IP
  hasheado, resultado, payload) e a empresa criada ganha um **evento de
  histórico** "Empresa criada (CRM comercial)".

## 6. Limites

| Endpoint | Limite |
|---|---|
| Criar | 60 requisições/min |
| Conferir duplicado | 120 requisições/min |

Estourou → `429 rate_limited`. (Os limiares de rate e de similaridade estão na
migration `0084_crm_intake.sql` e podem ser ajustados lá.)
