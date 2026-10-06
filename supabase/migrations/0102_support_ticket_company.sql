-- Todo chamado de suporte passa a ter, obrigatoriamente, a EMPRESA a que se
-- refere. Até aqui support_tickets não tinha empresa; existe 1 chamado
-- (finalizado) no sistema.
--
-- Ordem segura: adiciona a coluna anulável, preenche o chamado existente POR ID
-- (exatamente 1 linha, senão aborta), confere que não sobrou nulo e só então
-- aplica NOT NULL. Tudo na mesma migration.
--
-- FK com ON DELETE RESTRICT: empresa com chamado vinculado NÃO pode ser
-- excluída (regra do projeto de não perder histórico). A tela do admin traduz o
-- 23503 numa mensagem específica.

-- 1) Coluna anulável + FK RESTRICT.
alter table public.support_tickets
  add column company_id uuid references public.companies(id) on delete restrict;

-- 2) Preenche o ÚNICO chamado existente POR ID (nunca por nome). Precisa afetar
--    exatamente 1 linha; se não, aborta toda a migration.
do $$
declare n int;
begin
  update public.support_tickets
     set company_id = '2571b77f-3422-42cc-b444-663d3c04c9e0'  -- 287. NG PIU VITA LTDA - PIU VITA (Fabio)
   where id = 'b2197a24-2e6c-4ec8-b001-b5b2b1c2ac9c';         -- "Anúncios que não aparecem..."
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Backfill do chamado b2197a24 afetou % linha(s); esperado 1. Abortando.', n;
  end if;
end $$;

-- 3) Confere que não sobrou nenhum chamado sem empresa.
do $$
declare n int;
begin
  select count(*) into n from public.support_tickets where company_id is null;
  if n <> 0 then
    raise exception 'Ainda há % chamado(s) sem empresa. Abortando.', n;
  end if;
end $$;

-- 4) Agora sim, obrigatória.
alter table public.support_tickets alter column company_id set not null;

-- 5) Índice para os joins/listagens por empresa.
create index if not exists support_tickets_company_id_idx
  on public.support_tickets (company_id);

-- 6) Quem abre só pode vincular empresa que ALCANÇA: o with check passa a exigir
--    company_id entre as empresas visíveis pela RLS de companies de quem insere.
--    (Aproveitando, troca auth.uid()/auth_role() por (select ...), regra do projeto.)
drop policy if exists st_insert on public.support_tickets;
create policy st_insert on public.support_tickets
  for insert
  with check (
    created_by = (select auth.uid())
    and (select auth_role()) = any (array['admin', 'consultor', 'colaborador']::user_role[])
    and company_id in (select id from public.companies)
  );

-- 7) Troca de empresa num chamado existente: só para empresa que o editor
--    alcança. NÃO vai na st_update (bloquearia quem só muda o STATUS de um
--    chamado de empresa que não alcança). Gatilho BEFORE UPDATE OF company_id,
--    SECURITY INVOKER — o exists roda sob a RLS de companies de quem edita.
create or replace function public.support_tickets_company_reachable()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $fn$
begin
  if new.company_id is distinct from old.company_id then
    if not exists (select 1 from public.companies where id = new.company_id) then
      raise exception
        'Você não pode vincular o chamado a uma empresa fora do seu acesso.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_support_tickets_company_reachable on public.support_tickets;
create trigger trg_support_tickets_company_reachable
  before update of company_id on public.support_tickets
  for each row execute function public.support_tickets_company_reachable();
