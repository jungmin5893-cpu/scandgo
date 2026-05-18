-- 연차·휴가 신청 테이블
CREATE TABLE IF NOT EXISTS leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_type    text NOT NULL DEFAULT '연차',   -- 연차 | 반차(오전) | 반차(오후) | 병가 | 기타
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  days          numeric(4,1) NOT NULL DEFAULT 1,
  reason        text,
  status        text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by   uuid REFERENCES profiles(id),
  reviewed_at   timestamptz,
  reject_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS leave_requests_tenant_idx    ON leave_requests(tenant_id);
CREATE INDEX IF NOT EXISTS leave_requests_employee_idx  ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx    ON leave_requests(status);

-- RLS 활성화
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- 직원: 자기 신청 조회/생성/삭제(pending만)
CREATE POLICY "leave_employee_select" ON leave_requests
  FOR SELECT USING (employee_id = auth.uid());

CREATE POLICY "leave_employee_insert" ON leave_requests
  FOR INSERT WITH CHECK (
    employee_id = auth.uid()
    AND tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "leave_employee_delete" ON leave_requests
  FOR DELETE USING (employee_id = auth.uid() AND status = 'pending');

-- 관리자: 같은 테넌트 전체 조회 + 승인/거절 UPDATE
CREATE POLICY "leave_owner_select" ON leave_requests
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner', 'manager')
  );

CREATE POLICY "leave_owner_update" ON leave_requests
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner', 'manager')
  );

-- 슈퍼어드민
CREATE POLICY "leave_super_admin" ON leave_requests
  FOR ALL USING (is_super_admin());
