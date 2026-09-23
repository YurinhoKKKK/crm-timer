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
| `cnpj` | string | **sim** | CNPJ do cliente. Aceita **com ou sem máscara** (`11.222.333/0001-81` ou `11222333000181`) — normalizamos para **só os 14 dígitos**. Validamos os **dígitos verificadores**: CNPJ inválido é **recusado** (`422`), nunca "corrigido". Se já existir em **outra empresa**, recusa com `409 cnpj_in_use`. |
| `contato` | string | não | Máx. 120 chars. Vai entre parênteses no fim do nome. |
| `project_model` | string | não | `bpo` \| `consultoria` \| `ema`. |
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
    "cnpj": "11.222.333/0001-81",
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
| 422 | `validation` | Campo faltando/ inválido (número, razão, **CNPJ ausente ou inválido**, enum, data, tamanho, serviço). | |
| 409 | `cnpj_in_use` | O `cnpj` já está cadastrado em outra empresa (**único critério de duplicidade**, bloqueio direto). | `collision: { id, name }` |
| 409 | `number_in_use` | O `number` já é usado por outra empresa. | `collision: { id, name }` |
| 409 | `duplicate` | Colisão do **índice único** do banco (nome/CNPJ já existente) — rede de segurança rara, não é mais por semelhança de nome. | |
| 429 | `rate_limited` | Passou de **60 criações/min**. | |
| 500 | `internal` | Falha interna ao criar. | |
| 500 | `server_misconfig` | Env não configurada no servidor. | |
| 502 | `rpc_error` | Falha de comunicação com o banco. | |

Exemplo de recusa por CNPJ já em uso:

```json
{
  "ok": false,
  "error": "cnpj_in_use",
  "message": "O CNPJ informado já está cadastrado na empresa \"362. MERCADO MULTIPEÇAS LTDA (RODRIGO)\".",
  "collision": {
    "id": "b9baa6a0-ffd6-46f5-a8be-2c0d25d3f3b3",
    "name": "362. MERCADO MULTIPEÇAS LTDA (RODRIGO)"
  }
}
```

---

## 4. Endpoint — Conferir duplicado

```
POST /api/crm/companies/check-duplicate
```

Consulta (não cria nada): dada uma razão social (e, opcionalmente, um CNPJ),
devolve as empresas já existentes que podem ser a mesma. Duas naturezas de
correspondência, **claramente sinalizadas**:

- **por CNPJ = certeza** (`cnpj_match`, `match_type: "cnpj"`). É o que importa:
  só aparece quando você manda um `cnpj` válido e ele já existe aqui. Independe
  do nome. É o mesmo critério que a criação usa para bloquear.
- **por nome = aproximada** (`matches[]`, `match_type: "name"`). Comparação
  tolerante — ignora maiúsculas, acentos, pontuação, sufixos jurídicos
  (LTDA/ME/EPP/EIRELI/SA) e o número do início do nome. É **apenas informativo**:
  a criação **não** bloqueia por nome, então o comercial pode ignorar este campo.

Serve para o CRM avisar o operador **antes** de fechar.

> **Limitação conhecida e consciente:** hoje só **2 das 159 empresas** têm CNPJ.
> Até o Mauricio preencher os CNPJs antigos, o reenvio de um cliente **antigo**
> (sem CNPJ cadastrado) **não** será detectado como duplicado — nem aqui nem na
> criação. CNPJ só casa contra empresas cadastradas com CNPJ (as novas, vindas
> daqui pra frente). O `matches[]` por nome segue disponível como pista, mas não
> bloqueia nada.

### Corpo

| Campo | Tipo | Obrigatório |
|---|---|---|
| `razao_social` | string | sim |
| `cnpj` | string | não — com ou sem máscara. Se ausente/ inválido, a resposta traz só as correspondências por nome. |

### Exemplo

```bash
curl -X POST https://SEU-DOMINIO/api/crm/companies/check-duplicate \
  -H "Content-Type: application/json" \
  -H "x-crm-secret: $CRM_INTAKE_SECRET" \
  -H "x-crm-source: crm-comercial" \
  -d '{ "razao_social": "MERCADO MULTIPECAS", "cnpj": "11.222.333/0001-81" }'
```

### Sucesso — `200 OK`

```json
{
  "ok": true,
  "cnpj_match": {
    "id": "b9baa6a0-ffd6-46f5-a8be-2c0d25d3f3b3",
    "name": "381. MERCADO MULTIPEÇAS LTDA (RODRIGO)",
    "group": "On Boarding",
    "match_type": "cnpj",
    "certain": true
  },
  "matches": [
    {
      "id": "b9baa6a0-ffd6-46f5-a8be-2c0d25d3f3b3",
      "name": "362. MERCADO MULTIPEÇAS LTDA (RODRIGO, OLÍMPIO BOGO)",
      "group": "Ativos",
      "similarity": 1.0,
      "match_type": "name",
      "certain": false
    }
  ]
}
```

- `cnpj_match` é o objeto da empresa com **o mesmo CNPJ** (correspondência
  **certa**) ou **`null`** se você não mandou CNPJ, ele é inválido, ou nenhuma
  empresa tem esse CNPJ.
- `matches` vem ordenado da mais parecida para a menos (máx. 20). Lista vazia =
  nenhuma parecida por nome. `similarity` vai de 0 a 1. Cada item é uma
  correspondência **aproximada** (`certain: false`).

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
- **CNPJ é obrigatório e é o ÚNICO critério de duplicidade.** Guardamos só os 14
  dígitos (único quando preenchido) e validamos os dígitos verificadores. **CNPJ
  igual = duplicado, bloqueio direto** (`409 cnpj_in_use`), sem depender do nome.
- **A semelhança de nome NÃO bloqueia mais** (decisão do Mauricio). A criação
  verifica duplicidade só por CNPJ (+ número). O check-duplicate ainda **lista**
  parecidas por nome, mas como informação — o comercial não usa. As funções de
  normalização de nome continuam no banco (podem servir depois).
- **Limitação conhecida e consciente:** só **2 das 159 empresas** têm CNPJ hoje.
  Até os CNPJs antigos serem preenchidos, o reenvio de um cliente **antigo** (sem
  CNPJ cadastrado) não será detectado como duplicado.
- Nasce em **On Boarding**, sem consultor/colaborador. A distribuição é feita
  depois por um admin, dentro do sistema.
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

Estourou → `429 rate_limited`. (Os limiares de rate estão na migration
`0084_crm_intake.sql`. O bloqueio por semelhança de nome foi **removido** na
migration `0087_crm_intake_dedup_cnpj_only.sql` — dedup só por CNPJ.)
