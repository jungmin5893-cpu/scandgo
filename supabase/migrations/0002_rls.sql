-- ============================================================
-- Row Level Security: 멀티테넌트 격리
-- ============================================================

-- JWT custom claim 헬퍼 ----------------------------------------
create or replace function current_tenant_id() returns uuid
language sql stable as $$
  select coalesce(
    nullif(((auth.jwt() -> 'app_metadata') ->> 'tenant_id'), ''),
    nullif((auth.jwt() ->> 'tenant_id'), '')
  )::uuid
$$;

create or replace function current_role_name() returns text
language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata') ->> 'role',
    auth.jwt() ->> 'role'
  )
$$;

-- profiles -----------------------------------------------------
alter table profiles enable row level security;
create policy "profiles_select_same_tenant" on profiles for select
  using (tenant_id = current_tenant_id());
create policy "profiles_owner_write" on profiles for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
create policy "profiles_self_update" on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and tenant_id = current_tenant_id());

-- tenants ------------------------------------------------------
alter table tenants enable row level security;
create policy "tenants_select_own" on tenants for select
  using (id = current_tenant_id());
create policy "tenants_owner_update" on tenants for update
  using (id = current_tenant_id() and current_role_name() = 'owner');

-- stores -------------------------------------------------------
alter table stores enable row level security;
create policy "stores_select" on stores for select
  using (tenant_id = current_tenant_id());
create policy "stores_owner_all" on stores for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

-- shift_types --------------------------------------------------
alter table shift_types enable row level security;
create policy "shift_types_select" on shift_types for select
  using (tenant_id = current_tenant_id());
create policy "shift_types_owner_all" on shift_types for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

-- employee_shifts ----------------------------------------------
alter table employee_shifts enable row level security;
create policy "emp_shifts_select" on employee_shifts for select
  using (tenant_id = current_tenant_id());
create policy "emp_shifts_owner_all" on employee_shifts for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

-- attendances --------------------------------------------------
alter table attendances enable row level security;
create policy "att_owner_all" on attendances for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
create policy "att_employee_own_select" on attendances for select
  using (tenant_id = current_tenant_id() and employee_id = auth.uid());

-- employee_invites ---------------------------------------------
alter table employee_invites enable row level security;
create policy "invites_owner_all" on employee_invites for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
-- 직원은 본인 가입 코드 검증 시 anon 키로 RPC를 통해 접근 (정책 불필요)

-- payrolls -----------------------------------------------------
alter table payrolls enable row level security;
create policy "payrolls_owner_all" on payrolls for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
create policy "payrolls_employee_own_select" on payrolls for select
  using (tenant_id = current_tenant_id() and employee_id = auth.uid());

-- subscriptions ------------------------------------------------
alter table subscriptions enable row level security;
create policy "subs_owner_all" on subscriptions for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

-- push_subscriptions -------------------------------------------
alter table push_subscriptions enable row level security;
create policy "push_self" on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and tenant_id = current_tenant_id());

-- requests -----------------------------------------------------
alter table requests enable row level security;
create policy "requests_owner_all" on requests for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
create policy "requests_employee_own" on requests for all
  using (tenant_id = current_tenant_id() and employee_id = auth.uid())
  with check (tenant_id = current_tenant_id() and employee_id = auth.uid());
