-- ============================================================
-- 보안 강화 마이그레이션
-- 1. Haversine GPS 거리 계산 함수
-- 2. check_in_or_out — GPS 서버 측 검증 추가
-- 3. sign_labor_contract — 전자계약서 서명 전용 RPC
-- 4. 출퇴근 기록 감사 테이블 + 트리거
-- 5. tenant_is_active 헬퍼 함수
-- ============================================================

-- ── 1. Haversine 거리 계산 (PostGIS 없이 순수 SQL) ─────────────
CREATE OR REPLACE FUNCTION haversine_m(
  lat1 numeric, lng1 numeric,
  lat2 numeric, lng2 numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT round((
    6371000.0 * 2.0 * asin(sqrt(
      power(sin(radians((lat2 - lat1) / 2.0)), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians((lng2 - lng1) / 2.0)), 2)
    ))
  )::numeric, 0)
$$;

COMMENT ON FUNCTION haversine_m IS '두 GPS 좌표 사이의 거리(m) 계산 — Haversine 공식';


-- ── 2. check_in_or_out — GPS 서버 측 검증 추가 ─────────────────
CREATE OR REPLACE FUNCTION check_in_or_out(
  p_store     uuid,
  p_qr_secret text,
  p_lat       numeric DEFAULT NULL,
  p_lng       numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_emp     uuid := auth.uid();
  v_tenant  uuid;
  v_workday date;
  v_shift   uuid;
  v_row     attendances;
  v_profile profiles;
  v_store   stores;
  v_dist    numeric;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  -- 직원 프로필 확인
  SELECT * INTO v_profile FROM profiles WHERE id = v_emp;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF NOT v_profile.active    THEN RAISE EXCEPTION 'EMPLOYEE_INACTIVE'; END IF;

  -- 매장 + QR 시크릿 검증
  SELECT * INTO v_store
    FROM stores
   WHERE id = p_store AND qr_secret = p_qr_secret;
  IF v_store.id IS NULL            THEN RAISE EXCEPTION 'INVALID_QR'; END IF;
  IF v_store.tenant_id <> v_profile.tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  v_tenant := v_store.tenant_id;

  -- ★ GPS 서버 측 검증 (매장에 좌표가 설정된 경우만)
  IF v_store.gps_lat IS NOT NULL AND v_store.gps_lng IS NOT NULL THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      -- 좌표가 없는데 GPS 필수 매장이면 차단
      IF v_store.gps_required THEN
        RAISE EXCEPTION 'GPS_REQUIRED';
      END IF;
    ELSE
      v_dist := haversine_m(p_lat, p_lng, v_store.gps_lat, v_store.gps_lng);
      IF v_dist > v_store.gps_radius_m THEN
        RAISE EXCEPTION 'GPS_OUT_OF_RANGE';
      END IF;
    END IF;
  END IF;

  -- 시프트 결정
  SELECT shift_type_id, workday INTO v_shift, v_workday
    FROM resolve_shift(v_emp, now());
  IF v_workday IS NULL THEN
    v_workday := (now() AT TIME ZONE 'Asia/Seoul')::date;
  END IF;

  -- 미퇴근 row 확인
  SELECT * INTO v_row
    FROM attendances
   WHERE employee_id = v_emp
     AND workday = v_workday
     AND check_out_at IS NULL
   ORDER BY check_in_at DESC LIMIT 1;

  IF v_row.id IS NULL THEN
    -- 새 출근
    INSERT INTO attendances(
      tenant_id, store_id, employee_id, shift_type_id,
      check_in_at, workday, gps_lat, gps_lng, source
    ) VALUES (
      v_tenant, p_store, v_emp, v_shift,
      now(), v_workday, p_lat, p_lng, 'qr'
    ) RETURNING * INTO v_row;

    RETURN jsonb_build_object(
      'action',        'check_in',
      'at',            v_row.check_in_at,
      'workday',       v_row.workday,
      'shift_type_id', v_row.shift_type_id
    );
  ELSE
    -- 퇴근 처리
    UPDATE attendances
       SET check_out_at = now()
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
      'action',            'check_out',
      'at',                v_row.check_out_at,
      'in_at',             v_row.check_in_at,
      'workday',           v_row.workday,
      'duration_minutes',
      EXTRACT(epoch FROM (v_row.check_out_at - v_row.check_in_at)) / 60
    );
  END IF;
END $$;

REVOKE ALL ON FUNCTION check_in_or_out(uuid, text, numeric, numeric) FROM public;
GRANT  EXECUTE ON FUNCTION check_in_or_out(uuid, text, numeric, numeric) TO authenticated;


-- ── 3. 전자계약서 직원 서명 전용 RPC ───────────────────────────
-- 직원이 서명할 때 서명 관련 컬럼만 업데이트 (임금 등 다른 필드 수정 불가)
CREATE OR REPLACE FUNCTION sign_labor_contract(
  p_contract_id   uuid,
  p_employee_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_contract labor_contracts;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_contract
    FROM labor_contracts
   WHERE id = p_contract_id;

  IF v_contract.id IS NULL                   THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF v_contract.employee_id <> v_uid         THEN RAISE EXCEPTION 'PERMISSION_DENIED';  END IF;
  IF v_contract.status <> 'sent'             THEN RAISE EXCEPTION 'ALREADY_SIGNED';     END IF;
  IF v_contract.employee_signed_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_SIGNED';   END IF;

  -- 허용된 컬럼만 업데이트 (임금·사장서명 등 다른 필드는 건드리지 않음)
  UPDATE labor_contracts
     SET employee_name      = p_employee_name,
         employee_signed_at = now(),
         status             = 'completed',
         updated_at         = now()
   WHERE id = p_contract_id;

  RETURN jsonb_build_object('ok', true, 'signed_at', now());
END $$;

GRANT EXECUTE ON FUNCTION sign_labor_contract(uuid, text) TO authenticated;


-- ── 4. 출퇴근 기록 감사 테이블 + 트리거 ───────────────────────
-- 근로기준법 §42: 출퇴근 기록 3년 보존 의무 대응
-- 사장이 수정/삭제해도 원본 기록이 남음
CREATE TABLE IF NOT EXISTS attendances_audit (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text        NOT NULL,          -- 'UPDATE' | 'DELETE'
  changed_at  timestamptz NOT NULL DEFAULT now(),
  old_data    jsonb       NOT NULL           -- 변경 전 원본 row 전체
);

CREATE OR REPLACE FUNCTION trg_fn_attendances_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO attendances_audit(action, old_data)
  VALUES (TG_OP, to_jsonb(OLD));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_att_audit ON attendances;
CREATE TRIGGER trg_att_audit
  BEFORE UPDATE OR DELETE ON attendances
  FOR EACH ROW EXECUTE FUNCTION trg_fn_attendances_audit();

-- 감사 테이블: 슈퍼어드민만 조회 가능, 일반 사용자 직접 수정 불가
ALTER TABLE attendances_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_super_admin_select" ON attendances_audit;
CREATE POLICY "audit_super_admin_select" ON attendances_audit
  FOR SELECT USING (is_super_admin());


-- ── 5. 구독 만료 체크 헬퍼 ─────────────────────────────────────
-- 앞으로 결제 연동 후 RLS에 추가할 준비 함수
-- (지금은 RLS에 적용 안 함 — 안정성 우선, 결제 연동 시 활성화)
CREATE OR REPLACE FUNCTION tenant_is_active() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenants
     WHERE id = current_tenant_id()
       AND (
         subscription_status IN ('active', 'trialing')
         OR trial_ends_at > now()
       )
  )
$$;

COMMENT ON FUNCTION tenant_is_active IS
  '현재 테넌트가 활성 구독 또는 트라이얼 중인지 확인 — 결제 연동 후 RLS에 적용 예정';
