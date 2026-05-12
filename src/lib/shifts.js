import { supabase } from './supabase.js';

export async function listShiftTypes(tenantId) {
  const { data, error } = await supabase
    .from('shift_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('start_time');
  if (error) throw error;
  return data;
}

export async function upsertShiftType(row) {
  const { data, error } = await supabase
    .from('shift_types')
    .upsert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteShiftType(id) {
  const { error } = await supabase.from('shift_types').delete().eq('id', id);
  if (error) throw error;
}

// 직원의 요일별 시프트 할당 조회 (현재 유효한 것만)
export async function getEmployeeShiftAssignments(employeeId, asOf = new Date()) {
  const date = asOf.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('employee_shifts')
    .select('id, weekday, effective_from, effective_to, shift:shift_types(id, name, start_time, end_time, is_overnight, color, break_minutes)')
    .eq('employee_id', employeeId)
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gte.${date}`)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  // 같은 요일에 여러 행이면 가장 최근 effective_from만 사용
  const seen = new Set();
  const result = [];
  for (const row of data) {
    if (seen.has(row.weekday)) continue;
    seen.add(row.weekday);
    result.push(row);
  }
  return result;
}

// 매장의 모든 직원 + 요일별 시프트 그리드 (사장 대시보드용)
export async function getStoreShiftGrid(storeId, asOf = new Date()) {
  const date = asOf.toISOString().slice(0, 10);
  const { data: employees, error: e1 } = await supabase
    .from('profiles')
    .select('id, name, position')
    .eq('store_id', storeId)
    .eq('role', 'employee')
    .eq('active', true)
    .order('name');
  if (e1) throw e1;

  if (!employees.length) return { employees: [], grid: {} };

  const { data: shifts, error: e2 } = await supabase
    .from('employee_shifts')
    .select('id, employee_id, weekday, shift:shift_types(id, name, start_time, end_time, color, is_overnight)')
    .in('employee_id', employees.map(e => e.id))
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gte.${date}`);
  if (e2) throw e2;

  const grid = {};
  for (const emp of employees) grid[emp.id] = {};
  for (const row of shifts) {
    // 같은 직원·요일에 여러 행이면 최신 effective_from 우선 (이미 위에서 정렬되지 않았으니 그대로 덮어쓰기)
    grid[row.employee_id][row.weekday] = row;
  }
  return { employees, grid };
}

// 시프트 할당 변경: effective_from/to 트랜잭션
// 단순화 — 같은 (employee, weekday)의 기존 무기한 row의 effective_to를 어제로 닫고 새 row insert
export async function setShiftAssignment({ tenantId, employeeId, weekday, shiftTypeId }) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // 1. 기존 유효 행 닫기
  await supabase
    .from('employee_shifts')
    .update({ effective_to: yesterday })
    .eq('employee_id', employeeId)
    .eq('weekday', weekday)
    .is('effective_to', null);

  // 2. 새 행 insert
  const { data, error } = await supabase
    .from('employee_shifts')
    .insert({
      tenant_id: tenantId,
      employee_id: employeeId,
      weekday,
      shift_type_id: shiftTypeId || null,
      effective_from: today,
    })
    .select('id, weekday, shift:shift_types(id, name, start_time, end_time, color, is_overnight)')
    .single();
  if (error) throw error;
  return data;
}
