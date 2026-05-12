-- ============================================================
-- 핵심 비즈니스 로직 함수
-- ============================================================

-- 시프트 해상도: 어떤 직원의 특정 시각이 어느 시프트·근무일에 속하는가
-- 반환: (shift_type_id, workday)
create or replace function resolve_shift(p_emp uuid, p_ts timestamptz)
returns table(shift_type_id uuid, workday date)
language plpgsql stable as $$
declare
  v_local timestamp := (p_ts at time zone 'Asia/Seoul');
  v_today date := v_local::date;
  v_yday date  := v_today - 1;
  v_time time  := v_local::time;
begin
  -- 1) 어제 요일의 야간 시프트에 속하는지 (예: 어제 22시~오늘 07시)
  return query
  select st.id, v_yday
    from employee_shifts es
    join shift_types st on st.id = es.shift_type_id
   where es.employee_id = p_emp
     and es.weekday = extract(dow from v_yday)::smallint
     and st.is_overnight
     and v_local >= ((v_yday::timestamp) + st.start_time)
     and v_local <  ((v_today::timestamp) + st.end_time)
     and v_yday >= es.effective_from
     and (es.effective_to is null or v_yday <= es.effective_to)
   order by es.effective_from desc
   limit 1;
  if found then return; end if;

  -- 2) 오늘 요일의 시프트에 속하는지 (주간조이거나 오늘 야간조 시작 이후)
  return query
  select st.id, v_today
    from employee_shifts es
    join shift_types st on st.id = es.shift_type_id
   where es.employee_id = p_emp
     and es.weekday = extract(dow from v_today)::smallint
     and (
       (not st.is_overnight and v_time >= st.start_time and v_time < st.end_time)
       or (st.is_overnight and v_time >= st.start_time)
     )
     and v_today >= es.effective_from
     and (es.effective_to is null or v_today <= es.effective_to)
   order by es.effective_from desc
   limit 1;
end $$;

comment on function resolve_shift is '직원/시각으로 현재 시프트·근무일 결정';

-- ============================================================
-- attendances.workday 자동 채움 트리거
-- ============================================================
create or replace function attendances_set_workday()
returns trigger language plpgsql as $$
declare
  v_shift uuid; v_workday date;
begin
  if NEW.workday is null or NEW.shift_type_id is null then
    select shift_type_id, workday
      into v_shift, v_workday
      from resolve_shift(NEW.employee_id, NEW.check_in_at);
    if v_workday is null then
      -- 시프트 미할당 폴백: KST 자정 기준
      v_workday := (NEW.check_in_at at time zone 'Asia/Seoul')::date;
    end if;
    if NEW.workday is null then NEW.workday := v_workday; end if;
    if NEW.shift_type_id is null then NEW.shift_type_id := v_shift; end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_att_set_workday on attendances;
create trigger trg_att_set_workday
  before insert on attendances
  for each row execute function attendances_set_workday();

-- ============================================================
-- QR 자동 출/퇴근 판정 RPC
-- ============================================================
create or replace function check_in_or_out(
  p_store uuid,
  p_qr_secret text,
  p_lat numeric default null,
  p_lng numeric default null
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_emp uuid := auth.uid();
  v_tenant uuid;
  v_workday date;
  v_shift uuid;
  v_row attendances;
  v_profile profiles;
begin
  if v_emp is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 직원 프로필
  select * into v_profile from profiles where id = v_emp;
  if v_profile.id is null then raise exception 'PROFILE_NOT_FOUND'; end if;
  if not v_profile.active then raise exception 'EMPLOYEE_INACTIVE'; end if;

  -- 매장 + QR 검증
  select tenant_id into v_tenant
    from stores
   where id = p_store and qr_secret = p_qr_secret;
  if v_tenant is null then raise exception 'INVALID_QR'; end if;
  if v_tenant <> v_profile.tenant_id then raise exception 'TENANT_MISMATCH'; end if;

  -- 시프트 결정
  select shift_type_id, workday into v_shift, v_workday
    from resolve_shift(v_emp, now());
  if v_workday is null then
    v_workday := (now() at time zone 'Asia/Seoul')::date;
  end if;

  -- 미퇴근 row 확인
  select * into v_row from attendances
   where employee_id = v_emp
     and workday = v_workday
     and check_out_at is null
   order by check_in_at desc
   limit 1;

  if v_row.id is null then
    -- 새 출근
    insert into attendances(
      tenant_id, store_id, employee_id, shift_type_id,
      check_in_at, workday, gps_lat, gps_lng, source
    ) values (
      v_tenant, p_store, v_emp, v_shift,
      now(), v_workday, p_lat, p_lng, 'qr'
    ) returning * into v_row;

    return jsonb_build_object(
      'action', 'check_in',
      'at', v_row.check_in_at,
      'workday', v_row.workday,
      'shift_type_id', v_row.shift_type_id
    );
  else
    -- 퇴근 처리
    update attendances
       set check_out_at = now()
     where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'action', 'check_out',
      'at', v_row.check_out_at,
      'in_at', v_row.check_in_at,
      'workday', v_row.workday,
      'duration_minutes',
      extract(epoch from (v_row.check_out_at - v_row.check_in_at)) / 60
    );
  end if;
end $$;

revoke all on function check_in_or_out(uuid, text, numeric, numeric) from public;
grant execute on function check_in_or_out(uuid, text, numeric, numeric) to authenticated;

-- ============================================================
-- 직원 가입: 사장이 미리 등록한 invite 코드 검증 후 본인 프로필 생성
-- (auth.users.id로 호출. 가입 직후 클라이언트에서 호출)
-- ============================================================
create or replace function claim_employee_invite(
  p_phone text,
  p_code text,
  p_name text
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_inv employee_invites;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_inv from employee_invites
   where phone = p_phone and code = p_code
     and used_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;
  if v_inv.id is null then raise exception 'INVALID_INVITE'; end if;

  insert into profiles(id, tenant_id, role, store_id, name, phone, active)
  values (v_uid, v_inv.tenant_id, 'employee', v_inv.store_id, p_name, p_phone, true)
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        store_id = excluded.store_id,
        name = excluded.name,
        phone = excluded.phone,
        active = true;

  update employee_invites set used_at = now() where id = v_inv.id;

  return jsonb_build_object(
    'tenant_id', v_inv.tenant_id,
    'store_id', v_inv.store_id,
    'name', p_name
  );
end $$;
grant execute on function claim_employee_invite(text, text, text) to authenticated;

-- 사장 가입 직후 tenant 및 owner profile 생성 (클라이언트가 1회 호출) -----
create or replace function bootstrap_owner(
  p_business_name text,
  p_business_type text,
  p_owner_name text
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
  v_email text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'ALREADY_BOOTSTRAPPED';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into tenants(name, business_type)
    values (p_business_name, p_business_type)
    returning id into v_tenant_id;

  insert into profiles(id, tenant_id, role, name, email)
    values (v_uid, v_tenant_id, 'owner', p_owner_name, v_email);

  -- 업종별 기본 시프트 프리셋 시드
  if p_business_type = 'office' then
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '주간조', '09:00', '18:00', '#00c9a7', 60);
  elsif p_business_type = 'retail' then
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '오전조', '08:00', '14:00', '#00c9a7', 0),
      (v_tenant_id, '오후조', '14:00', '22:00', '#7c3aed', 0);
  elsif p_business_type = 'field' then
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '주간조', '08:00', '17:00', '#00c9a7', 60),
      (v_tenant_id, '야간조', '22:00', '07:00', '#1565c0', 30);
  else
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '주간', '09:00', '18:00', '#00c9a7', 0);
  end if;

  return jsonb_build_object('tenant_id', v_tenant_id);
end $$;
grant execute on function bootstrap_owner(text, text, text) to authenticated;

-- ============================================================
-- 사용자 JWT claims에 tenant_id, role 주입 (Auth Hook)
-- Supabase Dashboard > Authentication > Hooks > "Custom Access Token" 에 등록
-- ============================================================
create or replace function set_jwt_claims(event jsonb)
returns jsonb
language plpgsql stable
as $$
declare
  v_uid uuid := (event ->> 'user_id')::uuid;
  v_tenant uuid; v_role text;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
begin
  select tenant_id, role into v_tenant, v_role
    from profiles where id = v_uid;
  if v_tenant is not null then
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant::text));
    v_claims := jsonb_set(v_claims, '{role}', to_jsonb(v_role));
  end if;
  return jsonb_build_object('claims', v_claims);
end $$;
grant execute on function set_jwt_claims(jsonb) to supabase_auth_admin;

-- ============================================================
-- 월간 근태 집계 뷰 (대시보드 KPI용)
-- ============================================================
create or replace view monthly_attendance_summary as
select
  a.tenant_id,
  a.employee_id,
  date_trunc('month', a.workday)::date as period,
  count(*) filter (where a.check_out_at is not null) as days_worked,
  sum(extract(epoch from (a.check_out_at - a.check_in_at))/60)::int filter (where a.check_out_at is not null) as total_minutes
from attendances a
group by a.tenant_id, a.employee_id, date_trunc('month', a.workday);
