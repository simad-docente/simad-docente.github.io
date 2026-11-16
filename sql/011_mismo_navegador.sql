-- 011 · La cuenta queda vinculada al mismo navegador del dispositivo: otro navegador se bloquea,
-- el modo incógnito del mismo navegador sí entra. La huella del navegador se actualiza en cada visita.

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
      -- Solo se acepta el mismo navegador del mismo equipo (también en modo incógnito); otro navegador se bloquea
      if found and not (p_fp is not null and b.fp = p_fp) then
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
    update public.devices set last_seen = now(), fp = coalesce(p_fp, fp), fp_hw = coalesce(p_fphw, fp_hw)
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

