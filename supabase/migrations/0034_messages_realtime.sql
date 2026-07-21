-- =====================================================================
-- PASSO 31.1 — Mensagens em tempo real
--
-- Dois canais, um por lado da conversa:
--
--   LADO INTERNO (equipe autenticada): Supabase Realtime direto na tabela.
--   A entrega respeita o RLS — o servidor de Realtime avalia a policy de
--   SELECT com o JWT de CADA assinante antes de entregar o evento, então um
--   consultor não recebe INSERT de empresa que não é dele, mesmo que tente
--   assinar sem filtro. (O filtro por company_id no canal é eficiência, não
--   segurança; a segurança é a policy.)
--
--   LADO DO CLIENTE (portal): NÃO assina o banco. O cliente não tem conta
--   Supabase e não vai ganhar uma credencial por causa disso — a tela mais
--   blindada do sistema não abre policy para anon. Em vez disso, uma rota
--   SSE NOSSA valida a sessão do portal e repassa só as mensagens daquela
--   empresa; a função abaixo é o que essa rota consulta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Realtime na tabela (publication)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table company_messages;

-- ---------------------------------------------------------------------
-- 2. Mensagens NOVAS desde um instante (para a rota SSE do portal)
-- ---------------------------------------------------------------------
-- Mesma blindagem de todas as funções do portal: deriva a empresa DA SESSÃO
-- (token + segredo), nunca de company_id vindo de fora. Sessão inválida =>
-- null (a rota encerra o stream e o navegador cai na tela de senha).
-- p_after usa o próprio created_at (timestamptz, precisão de microssegundo)
-- da última mensagem que o cliente já tem.
create or replace function client_portal_messages_since(
  p_token   text,
  p_session text,
  p_after   timestamptz
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_company uuid := client_portal_session_company(p_token, p_session);
  v_items   jsonb;
begin
  if v_company is null then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', x.id,
             'body', x.body,
             'author_type', x.author_type,
             'author', x.author_name,
             'at', x.created_at
           ) order by x.created_at
         ), '[]'::jsonb)
    into v_items
    from (
      select m.id, m.body, m.author_type, m.created_at,
             case when m.author_type = 'interno'
                  then split_part(coalesce(p.full_name, 'Equipe'), ' ', 1)
                  else null end as author_name
        from company_messages m
        left join profiles p on p.id = m.author_id
       where m.company_id = v_company
         and m.created_at > coalesce(p_after, now())
       order by m.created_at
       limit 50
    ) x;

  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function client_portal_messages_since(text, text, timestamptz)
  to anon, authenticated;
