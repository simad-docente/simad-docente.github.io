-- 009 · Cobro de acceso con Mercado Pago (Checkout Pro · API de Orders)
-- Las funciones mp_* solo las ejecuta el servidor (service_role) desde las Edge Functions.

create table if not exists public.payments (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  order_id text unique not null,
  amount numeric(10,2) not null,
  currency text not null default 'MXN',
  status text not null default 'created',
  status_detail text,
  payment_method text,
  live boolean,
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  raw jsonb
);
create index if not exists payments_user_idx on public.payments(user_id, created_at desc);
alter table public.payments enable row level security;
drop policy if exists payments_own on public.payments;
create policy payments_own on public.payments for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.payments from anon, authenticated;

insert into private.settings(key, value) values ('payments_enabled', 'false') on conflict (key) do nothing;
insert into private.settings(key, value) values ('price', '250.00') on conflict (key) do nothing;

create or replace function public._setting(p_key text, p_default text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value from private.settings where key = p_key), p_default);
$$;
revoke all on function public._setting(text, text) from public, anon, authenticated;

-- Configuración visible para cualquier usuario con sesión (pantalla de pago)
create or replace function public.payment_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'NO_AUTH'; end if;
  return jsonb_build_object(
    'enabled', public._setting('payments_enabled', 'false') = 'true',
    'price', public._setting('price', '250.00')::numeric,
    'currency', 'MXN');
end $$;
grant execute on function public.payment_config() to authenticated;

-- Alta automática: si el cobro está activo, la aprobación automática deja de aplicar
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(coalesce(new.email,''));
        v_ok boolean;
        v_hex text := upper(replace(new.id::text,'-',''));
        v_folio text;
        i int := 0;
begin
  v_ok := exists(select 1 from public.allowed_emails where email = v_email)
          or (public._setting('auto_approve', 'false') = 'true' and public._setting('payments_enabled', 'false') <> 'true');
  v_folio := 'ADM-' || substr(v_hex,1,4) || '-' || substr(v_hex,5,6);
  while exists(select 1 from public.profiles where folio = v_folio) and i < 20 loop
    i := i + 1;
    v_hex := upper(md5(new.id::text || i::text || clock_timestamp()::text));
    v_folio := 'ADM-' || substr(v_hex,1,4) || '-' || substr(v_hex,5,6);
  end loop;
  insert into public.profiles(id, email, full_name, avatar_url, status, folio, approved_at)
  values (new.id, v_email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'avatar_url',
          case when v_ok then 'approved' else 'pending' end,
          v_folio,
          case when v_ok then now() end)
  on conflict (id) do nothing;
  return new;
end $$;

-- Contexto para crear un cobro (lo usa la Edge Function)
create or replace function public.mp_context(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'status', p.status, 'role', p.role, 'email', p.email,
    'enabled', public._setting('payments_enabled', 'false') = 'true',
    'price', public._setting('price', '250.00')::numeric)
  from public.profiles p where p.id = p_user;
$$;

create or replace function public.mp_order_created(p_user uuid, p_order text, p_amount numeric, p_live boolean, p_url text, p_raw jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.payments(user_id, order_id, amount, live, checkout_url, status, status_detail, raw)
  values (p_user, p_order, p_amount, p_live, p_url, coalesce(p_raw->>'status','created'), p_raw->>'status_detail', p_raw)
  on conflict (order_id) do nothing;
$$;

-- Registra el estado de una order consultada en Mercado Pago y concede o retira el acceso
create or replace function public.mp_record_order(p_order jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := p_order->>'id';
  v_pay public.payments;
  v_status text := coalesce(p_order->>'status', '');
  v_detail text := coalesce(p_order->>'status_detail', '');
  v_paid numeric := coalesce(nullif(p_order->>'total_paid_amount','')::numeric, 0);
  v_method text := coalesce(p_order#>>'{transactions,payments,0,payment_method,id}', p_order#>>'{transactions,payments,0,payment_method,type}');
  v_ok boolean;
  v_refund boolean;
  v_granted boolean := false;
  v_revoked boolean := false;
begin
  select * into v_pay from public.payments where order_id = v_id for update;
  if not found then return jsonb_build_object('known', false); end if;
  if coalesce(p_order->>'external_reference','') <> coalesce(v_pay.user_id::text,'-') then
    return jsonb_build_object('known', true, 'mismatch', true);
  end if;
  v_ok := v_status = 'processed' and v_detail in ('accredited','partially_refunded') and v_paid >= v_pay.amount - 0.01;
  v_refund := v_status in ('refunded','charged_back') or v_detail in ('refunded','charged_back');
  update public.payments set status = v_status, status_detail = v_detail,
         payment_method = coalesce(v_method, payment_method),
         paid_at = case when v_ok then coalesce(paid_at, now()) else paid_at end,
         updated_at = now(), raw = p_order
   where id = v_pay.id;
  if v_ok then
    update public.profiles set status = 'approved', approved_at = coalesce(approved_at, now())
     where id = v_pay.user_id and status = 'pending';
    v_granted := found;
  elsif v_refund then
    if not exists(select 1 from public.payments where user_id = v_pay.user_id and id <> v_pay.id and status = 'processed' and status_detail in ('accredited','partially_refunded')) then
      update public.profiles set status = 'pending'
       where id = v_pay.user_id and status = 'approved' and role <> 'admin';
      v_revoked := found;
    end if;
  end if;
  return jsonb_build_object('known', true, 'user', v_pay.user_id, 'status', v_status, 'detail', v_detail, 'paid', v_ok, 'granted', v_granted, 'revoked', v_revoked);
end $$;

create or replace function public.mp_open_orders(p_user uuid) returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select order_id from public.payments
   where user_id = p_user and status not in ('processed','refunded','canceled','failed','expired','charged_back')
     and created_at > now() - interval '10 days'
   order by created_at desc limit 5;
$$;

revoke all on function public.mp_context(uuid) from public, anon, authenticated;
revoke all on function public.mp_order_created(uuid, text, numeric, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.mp_record_order(jsonb) from public, anon, authenticated;
revoke all on function public.mp_open_orders(uuid) from public, anon, authenticated;
grant execute on function public.mp_context(uuid) to service_role;
grant execute on function public.mp_order_created(uuid, text, numeric, boolean, text, jsonb) to service_role;
grant execute on function public.mp_record_order(jsonb) to service_role;
grant execute on function public.mp_open_orders(uuid) to service_role;

-- Administración
create or replace function public.admin_get_settings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'auto_approve', public._setting('auto_approve', 'false') = 'true',
    'payments_enabled', public._setting('payments_enabled', 'false') = 'true',
    'price', public._setting('price', '250.00')::numeric);
end $$;

create or replace function public.admin_set_payments(p_on boolean, p_price numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_price is null or p_price < 10 or p_price > 10000 then raise exception 'BAD_PRICE'; end if;
  insert into private.settings(key, value) values ('payments_enabled', case when p_on then 'true' else 'false' end)
    on conflict (key) do update set value = excluded.value;
  insert into private.settings(key, value) values ('price', to_char(round(p_price, 2), 'FM999990.00'))
    on conflict (key) do update set value = excluded.value;
  return public.admin_get_settings();
end $$;
grant execute on function public.admin_set_payments(boolean, numeric) to authenticated;

create or replace function public.admin_payments() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select pay.id, pay.user_id, pay.order_id, pay.amount, pay.currency, pay.status, pay.status_detail, pay.payment_method,
           pay.live, pay.created_at, pay.updated_at, pay.paid_at, p.email, p.full_name, p.status as user_status
      from public.payments pay left join public.profiles p on p.id = pay.user_id
     order by pay.created_at desc limit 500) x), '[]'::jsonb);
end $$;
grant execute on function public.admin_payments() to authenticated;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'approved', (select count(*) from public.profiles where status = 'approved'),
    'pending', (select count(*) from public.profiles where status = 'pending'),
    'blocked', (select count(*) from public.profiles where status = 'blocked'),
    'active_7d', (select count(distinct user_id) from public.activity_log where created_at > now() - interval '7 days'),
    'attempts', (select count(*) from public.attempts where status in ('submitted','annulled')),
    'bugs_open', (select count(*) from public.bug_reports where status in ('nuevo','revisando')),
    'errors_24h', (select count(*) from public.client_errors where created_at > now() - interval '24 hours'),
    'device_alerts', (select count(distinct (device_id, user_id)) from public.device_conflicts where not resolved),
    'bank', coalesce((select jsonb_object_agg(subarea, n) from (select subarea, count(*) n from public.questions where active group by subarea) x), '{}'::jsonb),
    'bank_total', (select count(*) from public.questions where active),
    'docs', (select count(*) from public.study_docs),
    'payments_enabled', public._setting('payments_enabled', 'false') = 'true',
    'paid_count', (select count(*) from public.payments where live is not false and status = 'processed' and status_detail in ('accredited','partially_refunded')),
    'paid_total', (select coalesce(sum(amount),0) from public.payments where live is not false and status = 'processed' and status_detail in ('accredited','partially_refunded')),
    'paid_7d', (select count(*) from public.payments where live is not false and status = 'processed' and status_detail in ('accredited','partially_refunded') and paid_at > now() - interval '7 days')
  );
end $$;
