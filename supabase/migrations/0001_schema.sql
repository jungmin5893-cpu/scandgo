-- ============================================================
-- SCAN&GO 스키마
-- 멀티테넌트 B2B 출퇴근 관리 SaaS
-- 직원별·요일별 시프트 기반 근무일 컷오프
-- ============================================================

-- Extensions ----------------------------------------------------
create extension if not exists "pgcrypto";

-- Tenants -------------------------------------------------------
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_type text,                              -- 'office', 'retail', 'field', 'small'
  plan text not null default 'trial',              -- 'trial', 'basic', 'pro'
  subscription_status text not null default 'trialing', -- 'trialing','active','past_due','canceled'
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

-- Stores (매장/현장) ---------------------------------------------
create table stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  qr_secret text not null default replace(gen_random_uuid()::text, '-', ''),
  gps_lat numeric,
  gps_lng numeric,
  gps_radius_m int not null default 100,
  gps_required boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_stores_tenant on stores(tenant_id);

-- Profiles (auth.users 연결) ------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null check (role in ('owner','employee')),
  store_id uuid references stores(id),
  name text not null,
  phone text,
  email text,
  hourly_wage int default 10030,                   -- 2026년 최저시급 디폴트
  position text,
  hire_date date default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_profiles_tenant on profiles(tenant_id);
create index idx_profiles_store on profiles(store_id);
create index idx_profiles_phone on profiles(phone);

-- Shift Types (사장이 정의하는 근무 시프트 프리셋) ----------------
create table shift_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,                              -- "주간조", "야간조", "오후조"
  start_time time not null,
  end_time time not null,
  is_overnight boolean generated always as (end_time <= start_time) stored,
  color text not null default '#00c9a7',
  break_minutes int not null default 0,            -- 무급 휴게 분
  created_at timestamptz not null default now()
);
create index idx_shift_types_tenant on shift_types(tenant_id);

-- Employee Shifts (직원별 요일별 할당, 효력 기간 관리) -----------
create table employee_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0=일 ~ 6=토
  shift_type_id uuid references shift_types(id),   -- NULL이면 휴무
  effective_from date not null default current_date,
  effective_to date,                               -- NULL이면 무기한
  created_at timestamptz not null default now()
);
create index idx_emp_shifts_employee on employee_shifts(employee_id, weekday);
create index idx_emp_shifts_active on employee_shifts(employee_id, weekday)
  where effective_to is null;

-- Attendances (실제 출퇴근 기록) ---------------------------------
create table attendances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  shift_type_id uuid references shift_types(id),   -- 체크인 시점 스냅샷
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  workday date not null,                           -- 시프트 기반 컷오프 결과
  source text not null default 'qr',               -- 'qr','manual','auto'
  gps_lat numeric,
  gps_lng numeric,
  note text,
  created_at timestamptz not null default now()
);
create index idx_att_tenant_workday on attendances(tenant_id, workday desc);
create index idx_att_employee_workday on attendances(employee_id, workday desc);
create index idx_att_store_workday on attendances(store_id, workday desc);
-- 동시 체크인 race 차단: 한 직원당 같은 workday에 미퇴근 row 1개만 허용
create unique index attendance_open_unique
  on attendances(employee_id, workday) where check_out_at is null;

-- Employee Invites (사장이 직원 전화번호 사전 등록) --------------
create table employee_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  phone text not null,
  name text,
  code text not null,                              -- 6자리 가입 코드
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_invites_phone_code on employee_invites(phone, code);

-- Payrolls (월별 급여 집계) --------------------------------------
create table payrolls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  period date not null,                            -- YYYY-MM-01
  total_minutes int not null default 0,
  regular_minutes int not null default 0,
  overtime_minutes int not null default 0,
  night_minutes int not null default 0,
  base_pay int not null default 0,
  overtime_pay int not null default 0,
  night_pay int not null default 0,
  deductions int not null default 0,
  net_pay int not null default 0,
  pdf_url text,
  status text not null default 'draft',            -- 'draft','confirmed','paid'
  created_at timestamptz not null default now(),
  unique(employee_id, period)
);
create index idx_payrolls_tenant_period on payrolls(tenant_id, period desc);

-- Subscriptions (토스 빌링) --------------------------------------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  toss_billing_key text,
  toss_customer_key text,
  plan text not null,
  amount int not null,
  status text not null default 'pending',          -- 'pending','active','past_due','canceled'
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_subs_tenant on subscriptions(tenant_id);

-- Push Subscriptions (Web Push) ----------------------------------
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

-- Leave / Request (연차·병가·조퇴 신청) ---------------------------
create table requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  type text not null,                              -- 'annual','sick','early_leave','late','etc'
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending',          -- 'pending','approved','rejected'
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_requests_tenant_status on requests(tenant_id, status);

-- ============================================================
-- updated_at 자동화 등 일부 트리거는 0003_functions.sql에서 정의
-- ============================================================
