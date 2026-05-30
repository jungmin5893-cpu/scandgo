import { supabase } from '../../../lib/supabase.js';
import { nowKst, fmtDate, kst, minutesToHm, diffMinutes } from '../../../lib/time.js';
import { subscribePush, isPushSubscribed } from '../../../lib/push.js';
import { getLabels } from '../../../lib/labels.js';

export async function renderOverview({ root, profile }) {
  const labels = getLabels(profile.tenants?.industry_type);

  root.innerHTML = `
    <div class="page-head">
      <h1>대시보드</h1>
      <div class="page-sub">오늘 ${nowKst().format('M월 D일 (dd)')} 출퇴근 현황</div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">출근</div><div class="kpi-val" id="kpi-in">-</div><div class="kpi-foot">현재 근무중</div></div>
      <div class="kpi-card"><div class="kpi-label">오늘 완료</div><div class="kpi-val" id="kpi-done">-</div><div class="kpi-foot">출퇴근 완료</div></div>
      <div class="kpi-card"><div class="kpi-label">미출근</div><div class="kpi-val red" id="kpi-absent">-</div><div class="kpi-foot">시프트 있으나 미체크인</div></div>
      <div class="kpi-card"><div class="kpi-label">활성 ${labels.worker}</div><div class="kpi-val" id="kpi-total">-</div><div class="kpi-foot">전체</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>이번 달 요약</h2><div class="card-sub">${nowKst().format('YYYY년 M월')}</div></div>
      <div class="kpi-grid" id="month-kpi" style="margin-top:0">
        <div class="kpi-card"><div class="kpi-label">총 근무일</div><div class="kpi-val" id="m-days">-</div><div class="kpi-foot">연인원 기준</div></div>
        <div class="kpi-card"><div class="kpi-label">총 근무시간</div><div class="kpi-val" id="m-hours">-</div><div class="kpi-foot">시간</div></div>
        <div class="kpi-card"><div class="kpi-label">초과근무</div><div class="kpi-val orange" id="m-overtime">-</div><div class="kpi-foot">8시간 초과 건수</div></div>
        <div class="kpi-card"><div class="kpi-label">평균 근무</div><div class="kpi-val" id="m-avg">-</div><div class="kpi-foot">1인당 시간/일</div></div>
      </div>
      <div style="padding:0 4px 4px">
        <div style="font-size:12px;font-weight:700;color:#64748b;margin:16px 0 10px">최근 7일 출근 인원</div>
        <div id="trend-chart" style="display:flex;align-items:flex-end;gap:6px;height:80px;"></div>
      </div>
    </div>

    <div class="card" id="card-52h">
      <div class="card-head"><h2>주 52시간 현황</h2><div class="card-sub" id="week-range-label">이번 주 근로시간 모니터링</div></div>
      <div class="table-wrap">
        <table class="att-table">
          <thead><tr><th>직원</th><th>이번 주 근무</th><th>연장근로</th><th>상태</th></tr></thead>
          <tbody id="h52-rows"><tr><td colspan="4" class="empty">불러오는 중…</td></tr></tbody>
        </table>
      </div>
      <div style="padding:10px 20px 4px;font-size:11px;color:#94a3b8">
        법정 40h + 연장 12h = 주 52h 한도 (근로기준법 §53) · 5인 이상 사업장 전체 적용
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>실시간 출퇴근</h2><div class="card-sub">최근 24시간 기록</div></div>
      <div class="table-wrap">
        <table class="att-table">
          <thead><tr><th>이름</th><th>${labels.site}</th><th>시프트</th><th>출근</th><th>퇴근</th><th>근무시간</th></tr></thead>
          <tbody id="recent-att"><tr><td colspan="6" class="empty">불러오는 중…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  await loadKpi(root, profile);
  await loadRecent(root, profile);
  await loadMonthStats(root, profile);
  await load52h(root, profile);
  await loadLaborGuard(root, profile);  // ← 노무경보 배너
  setupPushBanner(root, profile);

  const channel = supabase.channel('owner-att')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'attendances',
      filter: `tenant_id=eq.${profile.tenant_id}`,
    }, () => { loadKpi(root, profile); loadRecent(root, profile); })
    .subscribe();
  root._teardown = () => supabase.removeChannel(channel);
}

async function setupPushBanner(root, profile) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

  const already = await isPushSubscribed();
  if (already) return;

  // 이미 허용했으면 배너 없이 조용히 재구독
  if (Notification.permission === 'granted') {
    await subscribePush(profile.id, profile.tenant_id);
    return;
  }

  // 차단이거나 이미 배너 결정(허용/나중에)을 한 번이라도 했으면 스킵
  if (Notification.permission === 'denied') return;
  if (localStorage.getItem('push_banner_decided')) return;

  // 배너 삽입 (페이지 상단)
  const banner = document.createElement('div');
  banner.id = 'push-banner';
  banner.style.cssText = 'background:linear-gradient(90deg,#1e3a5f,#243650);color:#fff;padding:12px 20px;border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;font-size:14px;';
  banner.innerHTML = `
    <span>🔔 직원 출퇴근 시 알림을 받으시겠어요?</span>
    <div style="display:flex;gap:8px;flex-shrink:0">
      <button id="push-allow" style="padding:7px 16px;background:#00c9a7;color:#0f1b2d;border:none;border-radius:7px;font-weight:800;cursor:pointer;font-size:13px">허용</button>
      <button id="push-deny" style="padding:7px 12px;background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:13px">나중에</button>
    </div>`;
  root.prepend(banner);

  root.querySelector('#push-allow').addEventListener('click', async () => {
    localStorage.setItem('push_banner_decided', '1');
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await subscribePush(profile.id, profile.tenant_id);
      banner.innerHTML = '✅ 알림이 활성화됐습니다. 설정에서 변경할 수 있습니다.';
      setTimeout(() => banner.remove(), 2500);
    } else {
      banner.remove();
    }
  });
  root.querySelector('#push-deny').addEventListener('click', () => {
    localStorage.setItem('push_banner_decided', '1');
    banner.remove();
  });
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

async function loadMonthStats(root, profile) {
  const monthStart = nowKst().startOf('month').format('YYYY-MM-DD');
  const monthEnd   = nowKst().endOf('month').format('YYYY-MM-DD');
  const weekAgo    = nowKst().subtract(6, 'day').format('YYYY-MM-DD');
  const today      = fmtDate(new Date());

  const { data } = await supabase
    .from('attendances')
    .select('employee_id, workday, check_in_at, check_out_at')
    .eq('tenant_id', profile.tenant_id)
    .gte('workday', monthStart)
    .lte('workday', monthEnd);

  if (!data) return;

  let totalMinutes = 0, overtimeCount = 0;
  const attendedDays = new Set();

  for (const r of data) {
    attendedDays.add(r.workday + '_' + r.employee_id);
    if (r.check_out_at) {
      const min = diffMinutes(r.check_in_at, r.check_out_at);
      totalMinutes += min;
      if (min > 480) overtimeCount++; // 8시간 초과
    }
  }

  const totalDays = attendedDays.size;
  const totalHours = Math.floor(totalMinutes / 60);
  const avgHours = totalDays > 0 ? (totalMinutes / 60 / totalDays).toFixed(1) : 0;

  const mDays = root.querySelector('#m-days');
  const mHours = root.querySelector('#m-hours');
  const mOvertime = root.querySelector('#m-overtime');
  const mAvg = root.querySelector('#m-avg');
  if (!mDays) return;
  mDays.textContent = totalDays;
  mHours.textContent = totalHours;
  mOvertime.textContent = overtimeCount;
  mAvg.textContent = avgHours;

  // 최근 7일 트렌드 차트
  const dayMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = nowKst().subtract(i, 'day').format('YYYY-MM-DD');
    dayMap[d] = new Set();
  }
  for (const r of data) {
    if (r.workday >= weekAgo && r.workday <= today) {
      if (!dayMap[r.workday]) dayMap[r.workday] = new Set();
      dayMap[r.workday].add(r.employee_id);
    }
  }

  const days = Object.entries(dayMap);
  const maxCount = Math.max(1, ...days.map(([, s]) => s.size));
  const chart = root.querySelector('#trend-chart');
  if (!chart) return;

  chart.innerHTML = days.map(([date, empSet]) => {
    const count = empSet.size;
    const heightPct = Math.max(4, Math.round((count / maxCount) * 100));
    const isToday = date === today;
    const label = kst(date).format('M/D');
    const day = kst(date).format('dd');
    return `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="font-size:11px;font-weight:700;color:${isToday ? '#00c9a7' : '#334155'}">${count || ''}</div>
        <div style="width:100%;background:${isToday ? '#00c9a7' : '#e2e8f0'};border-radius:4px 4px 0 0;height:${heightPct}%;min-height:4px;transition:height .3s"></div>
        <div style="font-size:10px;color:${isToday ? '#00c9a7' : '#94a3b8'};font-weight:${isToday ? 700 : 400}">${label}</div>
        <div style="font-size:9px;color:#94a3b8">${day}</div>
      </div>`;
  }).join('');
}

async function load52h(root, profile) {
  // 이번 주 월~일 범위 (6AM 기준 workday 사용)
  const todayKst  = nowKst();
  // 월요일 기준 주 시작 (isoWeekday: 1=월)
  const weekStart = todayKst.clone().startOf('isoWeek').format('YYYY-MM-DD');
  const weekEnd   = todayKst.clone().endOf('isoWeek').format('YYYY-MM-DD');

  const label = root.querySelector('#week-range-label');
  if (label) label.textContent = `${weekStart} ~ ${weekEnd} 근로시간`;

  const [{ data: atts }, { data: emps }] = await Promise.all([
    supabase
      .from('attendances')
      .select('employee_id, check_in_at, check_out_at, workday')
      .eq('tenant_id', profile.tenant_id)
      .gte('workday', weekStart)
      .lte('workday', weekEnd),
    supabase
      .from('profiles')
      .select('id, name')
      .eq('tenant_id', profile.tenant_id)
      .in('role', ['employee', 'manager'])
      .eq('active', true)
      .order('name'),
  ]);

  const tbody = root.querySelector('#h52-rows');
  if (!tbody) return;
  if (!emps?.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">활성 직원이 없습니다</td></tr>'; return; }

  // 직원별 주간 분 합산
  const minuteMap = {};
  for (const r of (atts || [])) {
    if (!r.check_out_at) continue;
    const min = diffMinutes(r.check_in_at, r.check_out_at);
    minuteMap[r.employee_id] = (minuteMap[r.employee_id] || 0) + min;
  }

  tbody.innerHTML = emps.map(e => {
    const totalMin  = minuteMap[e.id] || 0;
    const totalHrs  = (totalMin / 60).toFixed(1);
    const legalMin  = 40 * 60;   // 법정 40시간
    const extMin    = Math.max(0, totalMin - legalMin);
    const extHrs    = (extMin / 60).toFixed(1);

    let badgeClass, badgeText;
    if (totalMin >= 52 * 60) {
      badgeClass = 'h52-over'; badgeText = '⚠️ 52h 초과';
    } else if (totalMin >= 48 * 60) {
      badgeClass = 'h52-warn'; badgeText = '주의 48h+';
    } else if (totalMin >= 40 * 60) {
      badgeClass = 'h52-warn'; badgeText = '연장근로 중';
    } else {
      badgeClass = 'h52-ok'; badgeText = '정상';
    }

    return `<tr>
      <td><strong>${e.name}</strong></td>
      <td>${totalHrs}h</td>
      <td style="color:${extMin > 0 ? '#d97706' : '#94a3b8'}">${extMin > 0 ? extHrs + 'h' : '-'}</td>
      <td><span class="h52-badge ${badgeClass}">${badgeText}</span></td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//  노무경보 배너 — 퇴직금 임박 · 주휴수당 · 주52시간 초과
// ═══════════════════════════════════════════════════════════
async function loadLaborGuard(root, profile) {
  const today = nowKst();
  const alerts = [];

  // ① 퇴직금 임박 — hire_date 기준 11개월 이상 된 직원 (1년 전 D-30 이내)
  const { data: empsHire } = await supabase
    .from('profiles')
    .select('name, hire_date')
    .eq('tenant_id', profile.tenant_id)
    .in('role', ['employee', 'manager'])
    .eq('active', true)
    .not('hire_date', 'is', null);

  const retiring = (empsHire || []).filter(e => {
    const hd = e.hire_date ? nowKst().diff(nowKst().clone().set({
      year:  parseInt(e.hire_date.substring(0,4)),
      month: parseInt(e.hire_date.substring(5,7)) - 1,
      date:  parseInt(e.hire_date.substring(8,10)),
    }), 'day') : 0;
    return hd >= 335 && hd < 395; // 11개월~13개월 사이 경보
  });

  if (retiring.length > 0) {
    const names = retiring.map(e => e.name).join(', ');
    alerts.push({
      level: 'error',
      icon: '⚠️',
      title: `퇴직금 발생 임박 (${retiring.length}명)`,
      body: `${names} — 곧 1년 계속근로 충족. 미지급 시 지연이자 20% + 형사처벌 위험.`,
      action: { label: '직원 관리', route: 'employees' },
    });
  }

  // ② 주 52시간 초과 직원 — load52h 와 동일 로직 재활용
  const weekStart = today.clone().startOf('isoWeek').format('YYYY-MM-DD');
  const weekEnd   = today.clone().endOf('isoWeek').format('YYYY-MM-DD');
  const { data: weekAtts } = await supabase
    .from('attendances')
    .select('employee_id, check_in_at, check_out_at, profiles!attendances_employee_id_fkey(name)')
    .eq('tenant_id', profile.tenant_id)
    .gte('workday', weekStart)
    .lte('workday', weekEnd);

  const empMinMap = {};
  const empNameMap = {};
  for (const r of (weekAtts || [])) {
    if (!r.check_out_at) continue;
    const min = diffMinutes(r.check_in_at, r.check_out_at);
    empMinMap[r.employee_id] = (empMinMap[r.employee_id] || 0) + min;
    if (r.profiles?.name) empNameMap[r.employee_id] = r.profiles.name;
  }

  const over52 = Object.entries(empMinMap).filter(([, m]) => m >= 52 * 60);
  if (over52.length > 0) {
    const names = over52.map(([id]) => empNameMap[id] || id).join(', ');
    alerts.push({
      level: 'error',
      icon: '🚨',
      title: `주 52시간 초과 (${over52.length}명)`,
      body: `${names} — 근로기준법 §53 위반. 2년 이하 징역 또는 2천만원 이하 벌금.`,
      action: { label: '근태 확인', route: 'attendance' },
    });
  }

  // ③ 주휴수당 발생 대상 — 이번 주 15h 이상 + 아직 주휴수당 미계산
  const holiEligible = Object.entries(empMinMap)
    .filter(([, m]) => m >= 15 * 60 && m < 52 * 60) // 15h 이상이고 52h 미만
    .length;
  if (holiEligible > 0) {
    alerts.push({
      level: 'warn',
      icon: '📋',
      title: `주휴수당 발생 대상 (${holiEligible}명)`,
      body: `이번 주 15시간 이상 근무한 직원에게 주휴수당이 발생합니다. 급여 정산 시 반드시 포함하세요.`,
      action: { label: '급여 정산', route: 'payroll' },
    });
  }

  if (!alerts.length) return;

  // 배너 컨테이너 삽입 (page-head 다음)
  const pageHead = root.querySelector('.page-head');
  const container = document.createElement('div');
  container.id = 'labor-guard-banners';
  container.style.cssText = 'margin-bottom:16px;display:flex;flex-direction:column;gap:8px';

  for (const a of alerts) {
    const colors = a.level === 'error'
      ? { bg: 'linear-gradient(90deg,#7f1d1d,#991b1b)', border: '#ef4444', text: '#fff', sub: 'rgba(255,255,255,.75)' }
      : { bg: 'linear-gradient(90deg,#78350f,#92400e)', border: '#f59e0b', text: '#fff', sub: 'rgba(255,255,255,.75)' };

    const div = document.createElement('div');
    div.style.cssText = `background:${colors.bg};border-left:4px solid ${colors.border};border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 8px rgba(0,0,0,.2)`;
    div.innerHTML = `
      <div style="font-size:22px;flex-shrink:0">${a.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:800;color:${colors.text};margin-bottom:3px">🛡️ 노무경보: ${a.title}</div>
        <div style="font-size:12px;color:${colors.sub};line-height:1.5">${a.body}</div>
      </div>
      ${a.action ? `<button class="lb-action-btn" data-route="${a.action.route}" style="padding:8px 14px;background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">${a.action.label} →</button>` : ''}
      <button class="lb-close" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:18px;cursor:pointer;padding:0 4px;flex-shrink:0">✕</button>
    `;
    container.appendChild(div);
  }

  pageHead.after(container);

  // 닫기 버튼 & 라우팅
  container.querySelectorAll('.lb-close').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('div[style]').remove());
  });
  container.querySelectorAll('.lb-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const route = btn.dataset.route;
      document.querySelector(`.nav-item[data-route="${route}"]`)?.click();
    });
  });
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
