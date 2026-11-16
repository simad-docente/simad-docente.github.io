-- 007: una cuenta por equipo. El primer usuario que entra en un equipo queda como su dueño;
-- otras cuentas en ese equipo reciben un aviso para cambiar a la cuenta registrada.

create table if not exists public.devices (
  id bigserial primary key,
  device_key text not null unique,
  fp text,
  fp_hw text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists devices_fp_idx on public.devices(fp);
create index if not exists devices_fphw_idx on public.devices(fp_hw);
create index if not exists devices_owner_idx on public.devices(owner_id);

create table if not exists public.device_allow (
  device_id bigint not null references public.devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_id, user_id)
);

create table if not exists public.device_conflicts (
  id bigserial primary key,
  device_id bigint not null references public.devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('bloqueado','posible')),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists device_conflicts_user_idx on public.device_conflicts(user_id);

alter table public.devices enable row level security;
alter table public.device_allow enable row level security;
alter table public.device_conflicts enable row level security;
create policy devices_admin_select on public.devices for select to authenticated using (public.is_admin());
create policy device_allow_admin_select on public.device_allow for select to authenticated using (public.is_admin());
create policy device_conflicts_admin_select on public.device_conflicts for select to authenticated using (public.is_admin());

-- Revisa si la cuenta actual puede usarse en este equipo
create or replace function public.check_device(p_key text, p_fp text, p_fphw text, p_label text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); d public.devices; v_found boolean := false; v_email text; v_other bigint;
begin
  if v_uid is null then raise exception 'NO_AUTH'; end if;
  if coalesce(length(p_key), 0) < 16 then raise exception 'BAD_DEVICE'; end if;

  select * into d from public.devices where device_key = p_key;
  v_found := found;
  if not v_found and p_fp is not null then
    select * into d from public.devices where fp = p_fp order by (owner_id = v_uid) desc, created_at limit 1;
    v_found := found;
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
    return jsonb_build_object('ok', true, 'new', true);
  end if;

  if d.owner_id = v_uid or public.is_admin()
     or exists (select 1 from public.device_allow a where a.device_id = d.id and a.user_id = v_uid) then
    update public.devices set last_seen = now(), fp = coalesce(fp, p_fp), fp_hw = coalesce(fp_hw, p_fphw)
     where id = d.id;
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

-- Lista de avisos para el administrador
create or replace function public.admin_devices() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.resolved, x.created_at desc) from (
    select c.id, c.kind, c.resolved, c.created_at, d.id as device_id, d.label as device_label,
           po.email as owner_email, po.full_name as owner_name,
           pu.id as user_id, pu.email as user_email, pu.full_name as user_name, pu.status as user_status,
           (select count(*) from public.device_conflicts c2 where c2.device_id = c.device_id and c2.user_id = c.user_id) as attempts,
           exists (select 1 from public.device_allow a where a.device_id = c.device_id and a.user_id = c.user_id) as allowed
      from public.device_conflicts c
      join public.devices d on d.id = c.device_id
      left join public.profiles po on po.id = d.owner_id
      left join public.profiles pu on pu.id = c.user_id
     where c.id in (select max(id) from public.device_conflicts group by device_id, user_id, kind)
     order by c.created_at desc limit 200) x), '[]'::jsonb);
end $$;

-- Acciones: permitir esa cuenta en ese equipo, ignorar el aviso o liberar el equipo
create or replace function public.admin_device_action(p_conflict bigint, p_action text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.device_conflicts;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into c from public.device_conflicts where id = p_conflict;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action = 'permitir' then
    insert into public.device_allow(device_id, user_id) values (c.device_id, c.user_id) on conflict do nothing;
    update public.device_conflicts set resolved = true where device_id = c.device_id and user_id = c.user_id;
  elsif p_action = 'ignorar' then
    update public.device_conflicts set resolved = true where device_id = c.device_id and user_id = c.user_id and kind = c.kind;
  elsif p_action = 'liberar' then
    delete from public.devices where id = c.device_id;
  else
    raise exception 'BAD_ACTION';
  end if;
  return true;
end $$;

-- admin_users con el número de avisos de equipo por usuario
create or replace function public.admin_users() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(row_to_json(u) order by u.status <> 'pending', u.created_at desc) from (
    select p.id, p.email, p.full_name, p.avatar_url, p.role, p.status, p.folio, p.created_at, p.last_seen, p.approved_at,
      d.device_label, d.last_seen as device_last_seen,
      (select count(*) from public.session_events e where e.user_id = p.id and e.created_at > now() - interval '30 days') as device_switches_30d,
      (select count(*) from public.device_conflicts c where c.user_id = p.id and not c.resolved) as device_alerts,
      (select count(*) from public.attempts a where a.user_id = p.id and a.status in ('submitted','annulled')) as attempts,
      (select max(score) from public.attempts a where a.user_id = p.id and a.mode = 'simulacro' and a.status = 'submitted') as best_sim,
      (select round(avg(score),1) from public.attempts a where a.user_id = p.id and a.status = 'submitted') as avg_score,
      (select coalesce(sum(minutes),0) from public.activity_log l where l.user_id = p.id) as minutes_total
    from public.profiles p left join public.device_sessions d on d.user_id = p.id) u), '[]'::jsonb);
end $$;

revoke all on function public.check_device(text,text,text,text) from public, anon;
revoke all on function public.admin_devices() from public, anon;
revoke all on function public.admin_device_action(bigint,text) from public, anon;
grant execute on function public.check_device(text,text,text,text) to authenticated;
grant execute on function public.admin_devices() to authenticated;
grant execute on function public.admin_device_action(bigint,text) to authenticated;

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
    'docs', (select count(*) from public.study_docs)
  );
end $$;
