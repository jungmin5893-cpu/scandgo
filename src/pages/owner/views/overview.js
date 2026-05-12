import { supabase } from '../../../lib/supabase.js';
import { nowKst, fmtDate, kst, minutesToHm, diffMinutes } from '../../../lib/time.js';

export async function renderOverview({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>대시보드</h1>
      <div class="page-sub">오늘 ${nowKst().format('M월 D일 (dd)')} 출퇴근 현황</div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">출근</div><div class="kpi-val" id="kpi-in">-</div><div class="kpi-foot">현재 근무중</div></div>
      <div class="kpi-card"><div class="kpi-label">오늘 완료</div><div class="kpi-val" id="kpi-done">-</div><div class="kpi-foot">출퇴근 완료</div></div>
      <div class="kpi-card"><div class="kpi-label">미출근</div><div class="kpi-val red" id="kpi-absent">-</div><div class="kpi-foot">시프트 있으나 미체크인</div></div>
      <div class="kpi-card"><div class="kpi-label">활성 직원</div><div class="kpi-val" id="kpi-total">-</div><div class="kpi-foot">전체</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>실시간 출퇴근</h2><div class="card-sub">최근 24시간 기록</div></div>
      <div class="table-wrap">
        <table class="att-table">
          <thead><tr><th>이름</th><th>매장</th><th>시프트</th><th>출근</th><th>퇴근</th><th>근무시간</th></tr></thead>
          <tbody id="recent-att"><tr><td colspan="6" class="empty">불러오는 중…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  await loadKpi(root, profile);
  await loadRecent(root, profile);

  const channel = supabase.channel('owner-att')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'attendances',
      filter: `tenant_id=eq.${profile.tenant_id}`,
    }, () => { loadKpi(root, profile); loadRecent(root, profile); })
    .subscribe();
  root._teardown = () => supabase.removeChannel(channel);
}

async function loadKpi(root, profile) {
  const today = fmtDate(new Date());
  const [inCount, doneCount, totalCount] = await Promise.all([
    countRows('attendances', { tenant_id: profile.tenant_id, check_out_at_null: true }),
    countRows('attendances', { tenant_id: profile.tenant_id, workday: today, check_out_at_not_null: true }),
    countRows('profiles', { tenant_id: profile.tenant_id, role: 'employee' }),
  ]);
  const kpiIn = root.querySelector('#kpi-in');
  const kpiDone = root.querySelector('#kpi-done');
  const kpiTotal = root.querySelector('#kpi-total');
  const kpiAbsent = root.querySelector('#kpi-absent');
  if (!kpiIn) return; // 뷰가 이미 교체된 경우
  kpiIn.textContent = inCount ?? 0;
  kpiDone.textContent = doneCount ?? 0;
  kpiTotal.textContent = totalCount ?? 0;

  const todayWeekday = nowKst().day();
  const { count: assigned } = await supabase
    .from('employee_shifts')
    .select('employee_id', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id)
    .eq('weekday', todayWeekday)
    .not('shift_type_id', 'is', null);
  const { data: checkedInToday } = await supabase
    .from('attendances')
    .select('employee_id')
    .eq('tenant_id', profile.tenant_id)
    .eq('workday', today);
  const checkedIn = new Set((checkedInToday || []).map(r => r.employee_id)).size;
  if (kpiAbsent) kpiAbsent.textContent = Math.max(0, (assigned || 0) - checkedIn);
}

async function countRows(table, filters) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'check_out_at_null') q = q.is('check_out_at', null);
    else if (k === 'check_out_at_not_null') q = q.not('check_out_at', 'is', null);
    else q = q.eq(k, v);
  }
  const { count } = await q;
  return count;
}

async function loadRecent(root, profile) {
  const since = nowKst().subtract(1, 'day').toISOString();
  const { data, error } = await supabase
    .from('attendances')
    .select('id, check_in_at, check_out_at, workday, employee:profiles!attendances_employee_id_fkey(name), store:stores(name), shift:shift_types(name, color)')
    .eq('tenant_id', profile.tenant_id)
    .gte('check_in_at', since)
    .order('check_in_at', { ascending: false })
    .limit(40);
  const tbody = root.querySelector('#recent-att');
  if (!tbody) return;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty">에러: ${error.message}</td></tr>`; return; }
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">최근 기록이 없습니다</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => {
    const inT = kst(r.check_in_at).format('HH:mm');
    const outT = r.check_out_at ? kst(r.check_out_at).format('HH:mm') : '<span class="pill green">근무중</span>';
    const dur = r.check_out_at ? minutesToHm(diffMinutes(r.check_in_at, r.check_out_at)) : '—';
    const shiftBadge = r.shift ? `<span class="pill" style="background:${r.shift.color}20;color:${r.shift.color}">${r.shift.name}</span>` : '—';
    return `<tr>
      <td><strong>${r.employee?.name || '?'}</strong></td>
      <td>${r.store?.name || '-'}</td>
      <td>${shiftBadge}</td>
      <td>${inT}</td>
      <td>${outT}</td>
      <td>${dur}</td>
    </tr>`;
  }).join('');
}
