create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.settings (key text primary key, value text);

-- PERFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'pending' check (status in ('pending','approved','blocked')),
  folio text unique,
  exam_date date,
  daily_goal_min int not null default 60 check (daily_goal_min between 5 and 600),
  study_days int[] not null default '{1,2,3,4,5}',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  last_seen timestamptz
);

create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);

-- SESIÓN ÚNICA POR DISPOSITIVO
create table public.device_sessions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  session_id uuid not null,
  device_label text,
  user_agent text,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table public.session_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  device_label text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index on public.session_events(user_id, created_at desc);

-- FUNCIONES DE APOYO
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

-- Verifica que quien llama sea el dispositivo activo y esté aprobado
create or replace function public.assert_session(p_session uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  if auth.uid() is null then raise exception 'NO_AUTH' using errcode = '28000'; end if;
  select status into v_status from public.profiles where id = auth.uid();
  if v_status is distinct from 'approved' then raise exception 'NOT_APPROVED' using errcode = '42501'; end if;
  if not exists(select 1 from public.device_sessions where user_id = auth.uid() and session_id = p_session) then
    raise exception 'SESSION_REPLACED' using errcode = '42501';
  end if;
end $$;

-- Alta automática de perfil al registrarse con Google
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(coalesce(new.email,''));
        v_ok boolean;
begin
  v_ok := exists(select 1 from public.allowed_emails where email = v_email);
  insert into public.profiles(id, email, full_name, avatar_url, status, folio, approved_at)
  values (new.id, v_email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'avatar_url',
          case when v_ok then 'approved' else 'pending' end,
          'ADM-' || upper(substr(replace(new.id::text,'-',''),1,4)) || '-' || upper(substr(replace(new.id::text,'-',''),5,6)),
          case when v_ok then now() end)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Si el administrador agrega un correo que ya está registrado y pendiente, se aprueba
create or replace function public.on_allowed_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles set status = 'approved', approved_at = now()
   where email = new.email and status = 'pending';
  return new;
end $$;
create trigger trg_allowed_email after insert on public.allowed_emails
for each row execute function public.on_allowed_email();

-- Reclamar / validar sesión del dispositivo
create or replace function public.claim_session(p_session uuid, p_device text, p_ua text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev uuid; v_p public.profiles;
begin
  if auth.uid() is null then raise exception 'NO_AUTH'; end if;
  select * into v_p from public.profiles where id = auth.uid();
  if not found then raise exception 'NO_PROFILE'; end if;
  update public.profiles set last_seen = now() where id = auth.uid();
  select session_id into v_prev from public.device_sessions where user_id = auth.uid();
  insert into public.device_sessions(user_id, session_id, device_label, user_agent, started_at, last_seen)
  values (auth.uid(), p_session, left(p_device,120), left(p_ua,400), now(), now())
  on conflict (user_id) do update set session_id = excluded.session_id, device_label = excluded.device_label,
     user_agent = excluded.user_agent, started_at = now(), last_seen = now();
  if v_prev is distinct from p_session then
    insert into public.session_events(user_id, session_id, device_label, user_agent)
    values (auth.uid(), p_session, left(p_device,120), left(p_ua,400));
  end if;
  return json_build_object('status', v_p.status, 'role', v_p.role, 'replaced_other', v_prev is not null and v_prev <> p_session);
end $$;

create or replace function public.session_alive(p_session uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ok boolean;
begin
  if auth.uid() is null then return false; end if;
  update public.device_sessions set last_seen = now()
   where user_id = auth.uid() and session_id = p_session;
  v_ok := found;
  if v_ok then update public.profiles set last_seen = now() where id = auth.uid(); end if;
  return v_ok;
end $$;

-- Reclamar rol de administrador con código de un solo uso
create or replace function public.claim_admin(p_code text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_hash text;
begin
  if auth.uid() is null then return false; end if;
  select value into v_hash from private.settings where key = 'admin_code_hash';
  if v_hash is null or extensions.crypt(p_code, v_hash) <> v_hash then return false; end if;
  update public.profiles set role = 'admin', status = 'approved', approved_at = coalesce(approved_at, now()) where id = auth.uid();
  delete from private.settings where key = 'admin_code_hash';
  return true;
end $$;

-- RLS
alter table public.profiles enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.device_sessions enable row level security;
alter table public.session_events enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (full_name, exam_date, daily_goal_min, study_days) on public.profiles to authenticated;

create policy allowed_admin on public.allowed_emails for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy devsess_select on public.device_sessions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy sessev_select on public.session_events for select to authenticated
  using (public.is_admin());

revoke all on function public.claim_session(uuid,text,text) from public, anon;
revoke all on function public.session_alive(uuid) from public, anon;
revoke all on function public.claim_admin(text) from public, anon;
revoke all on function public.assert_session(uuid) from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.on_allowed_email() from public, anon, authenticated;
grant execute on function public.claim_session(uuid,text,text) to authenticated;
grant execute on function public.session_alive(uuid) to authenticated;
grant execute on function public.claim_admin(text) to authenticated;
grant execute on function public.assert_session(uuid) to authenticated;

alter publication supabase_realtime add table public.device_sessions;
