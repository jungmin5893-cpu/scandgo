-- ============================================================
-- 0009: bootstrap_owner — industry_type 저장 수정
--       가입 시 선택한 업종이 tenants.industry_type 에 정확히 저장되도록
--       + 신규 5종 업종별 시프트 프리셋 교체
-- ============================================================

-- 파라미터 변경(p_industry_type 추가)이므로 기존 오버로드 삭제 후 재생성
drop function if exists bootstrap_owner(text, text, text);

create or replace function bootstrap_owner(
  p_business_name  text,
  p_business_type  text,          -- 하위 호환 유지(기존 호출 코드 무변경)
  p_owner_name     text,
  p_industry_type  text default null  -- 신규: 명시적 업종 (없으면 p_business_type 사용)
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_uid       uuid := auth.uid();
  v_tenant_id uuid;
  v_email     text;
  v_industry  text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'ALREADY_BOOTSTRAPPED';
  end if;

  select email into v_email from auth.users where id = v_uid;

  -- industry_type 결정: 신규 파라미터 우선, 없으면 p_business_type 그대로
  v_industry := coalesce(nullif(trim(p_industry_type), ''), p_business_type);

  -- tenants 생성 — industry_type 명시 저장
  insert into tenants(name, business_type, industry_type)
    values (p_business_name, p_business_type, v_industry)
    returning id into v_tenant_id;

  insert into profiles(id, tenant_id, role, name, email)
    values (v_uid, v_tenant_id, 'owner', p_owner_name, v_email);

  -- ── 업종별 기본 시프트 프리셋 ─────────────────────────────
  if v_industry = '경비·보안' then
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '주간경비', '08:00', '20:00', '#00c9a7', 60),
      (v_tenant_id, '야간경비', '20:00', '08:00', '#1565c0', 60);

  elsif v_industry in ('건설도급사', 'field') then
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '주간조', '07:00', '16:00', '#00c9a7', 60),
      (v_tenant_id, '야간조', '22:00', '07:00', '#1565c0', 30);

  elsif v_industry = '인력사무소' then
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '주간조', '09:00', '18:00', '#00c9a7', 60),
      (v_tenant_id, '야간조', '22:00', '07:00', '#1565c0', 30);

  elsif v_industry = '청소·시설관리' then
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '주간청소', '06:00', '15:00', '#00c9a7', 60),
      (v_tenant_id, '야간청소', '22:00', '07:00', '#1565c0', 30);

  elsif v_industry = 'retail' then   -- 구형 값 하위 호환
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '오전조', '08:00', '14:00', '#00c9a7', 0),
      (v_tenant_id, '오후조', '14:00', '22:00', '#7c3aed', 0);

  else  -- '기타', 'office', 기타 모든 값
    insert into shift_types(tenant_id, name, start_time, end_time, color, break_minutes) values
      (v_tenant_id, '주간', '09:00', '18:00', '#00c9a7', 60);
  end if;

  return jsonb_build_object('tenant_id', v_tenant_id);
end $$;

-- 기존 3-파라미터 grant는 삭제됐으므로 4-파라미터 버전에 재부여
grant execute on function bootstrap_owner(text, text, text, text) to authenticated;
