-- 004: funciones de administrador, importación de contenido y reasignación de letras en argumentaciones

create or replace function public.admin_users() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(row_to_json(u) order by u.status <> 'pending', u.created_at desc) from (
    select p.id, p.email, p.full_name, p.avatar_url, p.role, p.status, p.folio, p.created_at, p.last_seen, p.approved_at,
      d.device_label, d.last_seen as device_last_seen,
      (select count(*) from public.session_events e where e.user_id = p.id and e.created_at > now() - interval '30 days') as device_switches_30d,
      (select count(*) from public.attempts a where a.user_id = p.id and a.status in ('submitted','annulled')) as attempts,
      (select max(score) from public.attempts a where a.user_id = p.id and a.mode = 'simulacro' and a.status = 'submitted') as best_sim,
      (select round(avg(score),1) from public.attempts a where a.user_id = p.id and a.status = 'submitted') as avg_score,
      (select coalesce(sum(minutes),0) from public.activity_log l where l.user_id = p.id) as minutes_total
    from public.profiles p left join public.device_sessions d on d.user_id = p.id) u), '[]'::jsonb);
end $$;

create or replace function public.admin_set_status(p_user uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_CHANGE_SELF'; end if;
  if p_status not in ('pending','approved','blocked') then raise exception 'BAD_STATUS'; end if;
  update public.profiles set status = p_status,
     approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else approved_at end
   where id = p_user;
  if p_status = 'blocked' then
    update public.device_sessions set session_id = gen_random_uuid() where user_id = p_user;
  end if;
  return found;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_CHANGE_SELF'; end if;
  if p_role not in ('user','admin') then raise exception 'BAD_ROLE'; end if;
  update public.profiles set role = p_role where id = p_user and status = 'approved';
  return found;
end $$;

-- Cierra la sesión del dispositivo activo de un usuario (le cambia el identificador)
create or replace function public.admin_reset_device(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.device_sessions set session_id = gen_random_uuid() where user_id = p_user;
  return found;
end $$;

create or replace function public.admin_update_bug(p_id bigint, p_status text, p_note text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('nuevo','revisando','resuelto','descartado') then raise exception 'BAD_STATUS'; end if;
  update public.bug_reports set status = p_status, admin_note = coalesce(p_note, admin_note), updated_at = now() where id = p_id;
  return found;
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
    'bank', coalesce((select jsonb_object_agg(subarea, n) from (select subarea, count(*) n from public.questions where active group by subarea) x), '{}'::jsonb),
    'bank_total', (select count(*) from public.questions where active),
    'docs', (select count(*) from public.study_docs)
  );
end $$;

-- Importa (o actualiza) el banco de reactivos y las fichas de estudio desde un archivo JSON
create or replace function public.admin_import_content(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_q int := 0; v_d int := 0;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  insert into public.study_docs(id, num, title, short, subareas, pages, summary, key_points, in_cases, traps, remember, reference, updated_at)
  select d->>'id', (d->>'num')::smallint, d->>'title', d->>'short',
         coalesce((select array_agg(x) from jsonb_array_elements_text(d->'subareas') x), '{}'),
         d->>'pages', d->>'summary', coalesce(d->'key_points','[]'), coalesce(d->'in_cases','[]'),
         coalesce(d->'traps','[]'), coalesce(d->'remember','[]'), d->>'reference', now()
  from jsonb_array_elements(coalesce(p->'docs','[]'::jsonb)) d
  on conflict (id) do update set num = excluded.num, title = excluded.title, short = excluded.short,
     subareas = excluded.subareas, pages = excluded.pages, summary = excluded.summary, key_points = excluded.key_points,
     in_cases = excluded.in_cases, traps = excluded.traps, remember = excluded.remember, reference = excluded.reference, updated_at = now();
  get diagnostics v_d = row_count;
  insert into public.questions(id, area, subarea, format, stem, items, options, answer, rationale, reference, docs, difficulty, active)
  select q->>'id', (q->>'area')::smallint, q->>'subarea', q->>'format', q->>'stem',
         case when jsonb_typeof(q->'items') = 'object' then q->'items' else null end,
         q->'options', q->>'answer', q->>'rationale', q->>'reference',
         coalesce((select array_agg(x) from jsonb_array_elements_text(q->'docs') x), '{}'),
         coalesce((q->>'difficulty')::smallint, 2), coalesce((q->>'active')::boolean, true)
  from jsonb_array_elements(coalesce(p->'questions','[]'::jsonb)) q
  on conflict (id) do update set area = excluded.area, subarea = excluded.subarea, format = excluded.format, stem = excluded.stem,
     items = excluded.items, options = excluded.options, answer = excluded.answer, rationale = excluded.rationale,
     reference = excluded.reference, docs = excluded.docs, difficulty = excluded.difficulty, active = excluded.active;
  get diagnostics v_q = row_count;
  return jsonb_build_object('questions', v_q, 'docs', v_d, 'bank_total', (select count(*) from public.questions where active));
end $$;

-- Las argumentaciones usan {A},{B},{C} para referirse a las opciones originales; se reescriben con la letra mostrada
create or replace function public._remap(t text, ord text[]) returns text
language sql immutable set search_path = public, pg_temp as $$
  select replace(replace(replace(coalesce(t,''),
     '{A}', chr(64 + array_position(ord, 'A'))),
     '{B}', chr(64 + array_position(ord, 'B'))),
     '{C}', chr(64 + array_position(ord, 'C')));
$$;

create or replace function public.answer_practice(p_session uuid, p_attempt uuid, p_pos int, p_choice text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.attempts; ai public.attempt_items; q public.questions; v_ok boolean;
begin
  perform public.assert_session(p_session);
  a := public._own_open_attempt(p_attempt);
  if a.mode <> 'practica' then raise exception 'NOT_PRACTICE'; end if;
  if p_choice not in ('A','B','C') then raise exception 'BAD_CHOICE'; end if;
  select * into ai from public.attempt_items where attempt_id = p_attempt and pos = p_pos for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into q from public.questions where id = ai.question_id;
  if ai.chosen is null then
    v_ok := ai.opt_order[ascii(p_choice) - 64] = q.answer;
    update public.attempt_items set chosen = p_choice, answered_at = now(), is_correct = v_ok
     where attempt_id = p_attempt and pos = p_pos;
    ai.chosen := p_choice; ai.is_correct := v_ok;
  end if;
  return jsonb_build_object('pos', p_pos, 'chosen', ai.chosen, 'is_correct', ai.is_correct,
     'correct', public._shown_correct(q.answer, ai.opt_order),
     'rationale', public._remap(q.rationale, ai.opt_order), 'reference', q.reference, 'docs', q.docs);
end $$;

create or replace function public.get_attempt_review(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.attempts;
begin
  select * into a from public.attempts where id = p_attempt and (user_id = auth.uid() or public.is_admin());
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.status = 'in_progress' then raise exception 'ATTEMPT_OPEN'; end if;
  return jsonb_build_object(
    'attempt', to_jsonb(a) - 'user_id',
    'items', coalesce((select jsonb_agg(public._render(q, ai.opt_order) || jsonb_build_object(
        'pos', ai.pos, 'chosen', ai.chosen, 'marked', ai.marked, 'is_correct', ai.is_correct,
        'correct', public._shown_correct(q.answer, ai.opt_order),
        'rationale', public._remap(q.rationale, ai.opt_order),
        'reference', q.reference, 'docs', q.docs) order by ai.pos)
      from public.attempt_items ai join public.questions q on q.id = ai.question_id where ai.attempt_id = a.id), '[]'::jsonb));
end $$;

revoke all on function public._remap(text, text[]) from public, anon, authenticated;
revoke all on function public.admin_users() from public, anon;
revoke all on function public.admin_set_status(uuid,text) from public, anon;
revoke all on function public.admin_set_role(uuid,text) from public, anon;
revoke all on function public.admin_reset_device(uuid) from public, anon;
revoke all on function public.admin_update_bug(bigint,text,text) from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_import_content(jsonb) from public, anon;
grant execute on function public.admin_users() to authenticated;
grant execute on function public.admin_set_status(uuid,text) to authenticated;
grant execute on function public.admin_set_role(uuid,text) to authenticated;
grant execute on function public.admin_reset_device(uuid) to authenticated;
grant execute on function public.admin_update_bug(bigint,text,text) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_import_content(jsonb) to authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_approved() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved() to authenticated;

-- Calificación: en práctica solo cuentan los reactivos respondidos
create or replace function public._grade(p_att uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.attempts; v_correct int; v_total int; v_elapsed int; v_breakdown jsonb; v_answered int; v_status text;
begin
  select * into a from public.attempts where id = p_att for update;
  if a.status <> 'in_progress' then
    return jsonb_build_object('attempt_id', a.id, 'status', a.status, 'correct', a.correct, 'total', a.total, 'score', a.score, 'elapsed_sec', a.elapsed_sec, 'breakdown', a.breakdown, 'incidents', a.incidents, 'mode', a.mode);
  end if;
  if a.mode = 'practica' then
    delete from public.attempt_items where attempt_id = p_att and chosen is null;
  end if;
  update public.attempt_items ai set is_correct = (ai.chosen is not null and ai.opt_order[ascii(ai.chosen) - 64] = q.answer)
    from public.questions q where q.id = ai.question_id and ai.attempt_id = p_att;
  select count(*) filter (where is_correct), count(*), count(*) filter (where chosen is not null)
    into v_correct, v_total, v_answered from public.attempt_items where attempt_id = p_att;
  v_elapsed := greatest(0, extract(epoch from (now() - a.started_at))::int);
  if a.time_limit_sec is not null then v_elapsed := least(v_elapsed, a.time_limit_sec); end if;
  select jsonb_build_object(
     'subarea', (select jsonb_object_agg(s, jsonb_build_object('total', t, 'correct', c)) from (
          select q.subarea s, count(*) t, count(*) filter (where ai.is_correct) c
          from public.attempt_items ai join public.questions q on q.id = ai.question_id where ai.attempt_id = p_att group by q.subarea) x),
     'area', (select jsonb_object_agg(s, jsonb_build_object('total', t, 'correct', c)) from (
          select q.area::text s, count(*) t, count(*) filter (where ai.is_correct) c
          from public.attempt_items ai join public.questions q on q.id = ai.question_id where ai.attempt_id = p_att group by q.area) x),
     'format', (select jsonb_object_agg(s, jsonb_build_object('total', t, 'correct', c)) from (
          select q.format s, count(*) t, count(*) filter (where ai.is_correct) c
          from public.attempt_items ai join public.questions q on q.id = ai.question_id where ai.attempt_id = p_att group by q.format) x),
     'answered', v_answered,
     'marked', (select count(*) from public.attempt_items where attempt_id = p_att and marked))
  into v_breakdown;
  v_status := case when a.mode = 'practica' and v_total = 0 then 'abandoned' else p_status end;
  update public.attempts set status = v_status, finished_at = now(), elapsed_sec = v_elapsed,
     total = case when v_total > 0 then v_total else total end,
     correct = v_correct, score = case when v_total > 0 then round(100.0 * v_correct / v_total, 2) else 0 end,
     breakdown = v_breakdown
   where id = p_att returning * into a;
  insert into public.activity_log(user_id, kind, ref, minutes, questions, correct, score)
  values (a.user_id, a.mode, a.id::text, round(v_elapsed / 60.0, 1), v_answered, v_correct, a.score);
  return jsonb_build_object('attempt_id', a.id, 'status', a.status, 'correct', a.correct, 'total', a.total,
     'score', a.score, 'elapsed_sec', a.elapsed_sec, 'breakdown', a.breakdown, 'incidents', a.incidents, 'mode', a.mode);
end $$;
revoke all on function public._grade(uuid, text) from public, anon, authenticated;
