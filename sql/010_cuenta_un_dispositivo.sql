-- 010 · Cada cuenta queda vinculada al primer dispositivo donde se abre (excepto administradores).
-- Desde otro dispositivo no se puede entrar; el administrador libera la cuenta si la persona cambió de equipo.

alter table public.profiles add column if not exists bound_device bigint references public.devices(id) on delete set null;
alter table public.profiles add column if not exists bound_at timestamptz;

create table if not exists public.bind_attempts (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text,
  fp_hw text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists bind_attempts_user_idx on public.bind_attempts(user_id, created_at desc);
alter table public.bind_attempts enable row level security;
revoke all on public.bind_attempts from anon, authenticated;

create or replace function public.check_device(p_key text, p_fp text, p_fphw text, p_label text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); d public.devices; v_found boolean := false; v_email text; v_other bigint;
        v_admin boolean := public.is_admin(); v_bound bigint; v_bound_at timestamptz; b public.devices;
begin
  if v_uid is null then raise exception 'NO_AUTH'; end if;
  if coalesce(length(p_key), 0) < 16 then raise exception 'BAD_DEVICE'; end if;

  select * into d from public.devices where device_key = p_key;
  v_found := found;
  if not v_found and p_fp is not null then
    select * into d from public.devices where fp = p_fp order by (owner_id = v_uid) desc, created_at limit 1;
    v_found := found;
  end if;

  -- Cuenta vinculada a un solo dispositivo: se revisa antes de registrar el equipo, para no apropiarse de uno ajeno
  if not v_admin then
    select bound_device, bound_at into v_bound, v_bound_at from public.profiles where id = v_uid;
    if v_bound is not null and (not v_found or d.id <> v_bound) then
      select * into b from public.devices where id = v_bound;
      if found and not ((p_fphw is not null and b.fp_hw = p_fphw) or (p_fp is not null and b.fp = p_fp)) then
        if not exists (select 1 from public.bind_attempts a where a.user_id = v_uid and not a.resolved
                        and a.fp_hw is not distinct from p_fphw and a.created_at > now() - interval '1 hour') then
          insert into public.bind_attempts(user_id, label, fp_hw) values (v_uid, left(p_label, 120), p_fphw);
        end if;
        return jsonb_build_object('ok', false, 'reason', 'account_bound', 'bound_label', b.label, 'bound_since', v_bound_at);
      end if;
      if not found then v_bound := null; end if;
    end if;
  end if;

  if not v_found then
    insert into public.devices(device_key, fp, fp_hw, owner_id, label)
    values (p_key, p_fp, p_fphw, v_uid, left(p_label, 120)) returning * into d;
    if p_fphw is not null then
      select x.id into v_other from public.devices x
       where x.fp_hw = p_fphw and x.owner_id <> v_uid and x.id <> d.id order by x.created_at limit 1;
      if v_other is not null and not exists (select 1 from public.device_conflicts c
           where c.device_id = v_other and c.user_id = v_uid and c.kind = 'posible') then
        insert into public.device_conflicts(device_id, user_id, kind) values (v_other, v_uid, 'posible');
      end if;
    end if;
    if not v_admin and v_bound is null then
      update public.profiles set bound_device = d.id, bound_at = now() where id = v_uid;
    end if;
    return jsonb_build_object('ok', true, 'new', true);
  end if;

  if d.owner_id = v_uid or v_admin
     or exists (select 1 from public.device_allow a where a.device_id = d.id and a.user_id = v_uid) then
    update public.devices set last_seen = now(), fp = coalesce(fp, p_fp), fp_hw = coalesce(fp_hw, p_fphw)
     where id = d.id;
    if not v_admin and v_bound is null then
      update public.profiles set bound_device = d.id, bound_at = now() where id = v_uid;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if not exists (select 1 from public.device_conflicts c where c.device_id = d.id and c.user_id = v_uid
                  and c.kind = 'bloqueado' and c.created_at > now() - interval '1 hour') then
    insert into public.device_conflicts(device_id, user_id, kind) values (d.id, v_uid, 'bloqueado');
  end if;
  select email into v_email from public.profiles where id = d.owner_id;
  return jsonb_build_object('ok', false,
    'owner_hint', case when v_email is null or position('@' in v_email) = 0 then null
                       else left(v_email, 2) || '•••' || substring(v_email from position('@' in v_email)) end);
end $$;

-- Administración
create or replace function public.admin_release_binding(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.profiles set bound_device = null, bound_at = null where id = p_user;
  update public.bind_attempts set resolved = true where user_id = p_user and not resolved;
  return true;
end $$;

create or replace function public.admin_bind_ignore(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.bind_attempts set resolved = true where user_id = p_user and not resolved;
  return true;
end $$;

create or replace function public.admin_bind_attempts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.open desc, x.last_at desc) from (
    select a.user_id, p.email, p.full_name, p.status as user_status,
           count(*) filter (where not a.resolved) as open, count(*) as total,
           max(a.created_at) as last_at,
           (select a2.label from public.bind_attempts a2 where a2.user_id = a.user_id order by a2.created_at desc limit 1) as last_label,
           d.label as bound_label, p.bound_at
      from public.bind_attempts a
      join public.profiles p on p.id = a.user_id
      left join public.devices d on d.id = p.bound_device
     group by a.user_id, p.email, p.full_name, p.status, d.label, p.bound_at
     order by max(a.created_at) desc limit 200) x), '[]'::jsonb);
end $$;

create or replace function public.admin_users() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(row_to_json(u) order by u.status <> 'pending', u.created_at desc) from (
    select p.id, p.email, p.full_name, p.avatar_url, p.role, p.status, p.folio, p.created_at, p.last_seen, p.approved_at,
      d.device_label, d.last_seen as device_last_seen,
      bd.label as bound_label, p.bound_at,
      (select count(*) from public.bind_attempts b where b.user_id = p.id and not b.resolved) as bind_alerts,
      (select count(*) from public.session_events e where e.user_id = p.id and e.created_at > now() - interval '30 days') as device_switches_30d,
      (select count(*) from public.device_conflicts c where c.user_id = p.id and not c.resolved) as device_alerts,
      (select count(*) from public.attempts a where a.user_id = p.id and a.status in ('submitted','annulled')) as attempts,
      (select max(score) from public.attempts a where a.user_id = p.id and a.mode = 'simulacro' and a.status = 'submitted') as best_sim,
      (select round(avg(score),1) from public.attempts a where a.user_id = p.id and a.status = 'submitted') as avg_score,
      (select coalesce(sum(minutes),0) from public.activity_log l where l.user_id = p.id) as minutes_total
    from public.profiles p
    left join public.device_sessions d on d.user_id = p.id
    left join public.devices bd on bd.id = p.bound_device) u), '[]'::jsonb);
end $$;

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
    'bind_alerts', (select count(distinct user_id) from public.bind_attempts where not resolved),
    'bank', coalesce((select jsonb_object_agg(subarea, n) from (select subarea, count(*) n from public.questions where active group by subarea) x), '{}'::jsonb),
    'bank_total', (select count(*) from public.questions where active),
    'docs', (select count(*) from public.study_docs),
    'payments_enabled', public._setting('payments_enabled', 'false') = 'true',
    'paid_count', (select count(*) from public.payments where live is not false and status = 'processed' and status_detail in ('accredited','partially_refunded')),
    'paid_total', (select coalesce(sum(amount),0) from public.payments where live is not false and status = 'processed' and status_detail in ('accredited','partially_refunded')),
    'paid_7d', (select count(*) from public.payments where live is not false and status = 'processed' and status_detail in ('accredited','partially_refunded') and paid_at > now() - interval '7 days')
  );
end $$;

revoke all on function public.admin_release_binding(uuid) from public, anon;
revoke all on function public.admin_bind_ignore(uuid) from public, anon;
revoke all on function public.admin_bind_attempts() from public, anon;
grant execute on function public.admin_release_binding(uuid) to authenticated;
grant execute on function public.admin_bind_ignore(uuid) to authenticated;
grant execute on function public.admin_bind_attempts() to authenticated;
