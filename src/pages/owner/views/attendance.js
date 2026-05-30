import { supabase } from '../../../lib/supabase.js';
import { nowKst, kst, fmtDate, minutesToHm, diffMinutes } from '../../../lib/time.js';
import { toast } from '../../../lib/toast.js';
import * as XLSX from 'xlsx';
import { getLabels } from '../../../lib/labels.js';

export async function renderAttendance({ root, profile }) {
  root._profile = profile;
  const labels = getLabels(profile.tenants?.industry_type);
  const monthStart = nowKst().startOf('month').format('YYYY-MM-DD');
  const monthEnd = nowKst().endOf('month').format('YYYY-MM-DD');

  root.innerHTML = `
    <div class="page-head">
      <h1>근태 관리</h1>
      <div class="page-sub">월별 출퇴근 기록과 엑셀 내보내기</div>
    </div>
    <div class="filter-bar">
      <input type="month" id="att-month" value="${nowKst().format('YYYY-MM')}">
      <select id="att-employee"><option value="">전체 ${labels.worker}</option></select>
      <select id="att-store"><option value="">전체 ${labels.site}</option></select>
      <button class="btn primary" id="btn-refresh">조회</button>
      <button class="btn" id="btn-export">엑셀 다운로드</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="att-table">
          <thead><tr><th>날짜</th><th>이름</th><th>${labels.site}</th><th>시프트</th><th>출근</th><th>퇴근</th><th>근무</th><th>메모</th></tr></thead>
          <tbody id="att-rows"><tr><td colspan="8" class="empty">조회를 눌러주세요</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  await loadFilters(root, profile);
  await loadRows(root, profile, monthStart, monthEnd);

  root.querySelector('#btn-refresh').addEventListener('click', () => {
    const m = root.querySelector('#att-month').value;
    const start = `${m}-01`;
    const end = nowKst().year(+m.split('-')[0]).month(+m.split('-')[1] - 1).endOf('month').format('YYYY-MM-DD');
    loadRows(root, profile, start, end);
  });
  root.querySelector('#btn-export').addEventListener('click', () => exportExcel(root, labels));

  // ── 실시간 구독: 직원 출퇴근 시 자동 갱신 ──────────────
  const channel = supabase.channel('owner-att-realtime')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'attendances',
      filter: `tenant_id=eq.${profile.tenant_id}`,
    }, () => {
      const m = root.querySelector('#att-month')?.value || nowKst().format('YYYY-MM');
      const start = `${m}-01`;
      const end = nowKst().year(+m.split('-')[0]).month(+m.split('-')[1] - 1).endOf('month').format('YYYY-MM-DD');
      loadRows(root, profile, start, end);
    })
    .subscribe();
  root._teardown = () => supabase.removeChannel(channel);
}

async function loadFilters(root, profile) {
  const [{ data: emps }, { data: stores }] = await Promise.all([
    supabase.from('profiles').select('id, name').eq('tenant_id', profile.tenant_id).eq('role', 'employee').order('name'),
    supabase.from('stores').select('id, name').eq('tenant_id', profile.tenant_id).order('name'),
  ]);
  const eSel = root.querySelector('#att-employee');
  for (const e of emps || []) eSel.innerHTML += `<option value="${e.id}">${e.name}</option>`;
  const sSel = root.querySelector('#att-store');
  for (const s of stores || []) sSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
}

async function loadRows(root, profile, start, end) {
  const empFilter = root.querySelector('#att-employee').value;
  const storeFilter = root.querySelector('#att-store').value;
  let q = supabase
    .from('attendances')
    .select('id, check_in_at, check_out_at, workday, note, employee:profiles!attendances_employee_id_fkey(name), store:stores(name), shift:shift_types(name, color)')
    .eq('tenant_id', profile.tenant_id)
    .gte('workday', start)
    .lte('workday', end)
    .order('workday', { ascending: false })
    .order('check_in_at', { ascending: false });
  if (empFilter) q = q.eq('employee_id', empFilter);
  if (storeFilter) q = q.eq('store_id', storeFilter);
  const { data, error } = await q;
  const tbody = root.querySelector('#att-rows');
  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="empty">에러: ${error.message}</td></tr>`; return; }
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">기록이 없습니다</td></tr>'; return; }
  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${r.workday}</td>
      <td><strong>${r.employee?.name || '?'}</strong></td>
      <td>${r.store?.name || '-'}</td>
      <td>${r.shift ? `<span class="pill" style="background:${r.shift.color}20;color:${r.shift.color}">${r.shift.name}</span>` : '-'}</td>
      <td>${kst(r.check_in_at).format('HH:mm')}</td>
      <td>${r.check_out_at ? kst(r.check_out_at).format('HH:mm') : '<span class="pill green">근무중</span>'}</td>
      <td>${r.check_out_at ? minutesToHm(diffMinutes(r.check_in_at, r.check_out_at)) : '—'}</td>
      <td>${r.note || ''}</td>
    </tr>
  `).join('');
  root._attRows = data;
}

function exportExcel(root, labels = { site: '현장' }) {
  const rows = root._attRows;
  if (!rows?.length) { toast('내보낼 데이터가 없습니다', 'warn'); return; }

  const month    = root.querySelector('#att-month').value;
  const [yy, mm] = month.split('-');
  const periodLabel = `${yy}년 ${Number(mm)}월`;
  const bizName  = root._profile?.tenants?.name || '';

  // 날짜 오름차순 정렬
  const sorted = [...rows].sort((a, b) =>
    a.workday < b.workday ? -1 : a.workday > b.workday ? 1 :
    (a.check_in_at || '').localeCompare(b.check_in_at || ''));

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: 출퇴근기록 (리스트) ──────────────────────────
  const aoa1 = [];
  if (bizName) aoa1.push([`${bizName} ${periodLabel} 출퇴근기록`, '', '', '', '', '', '', '', '']);
  aoa1.push(['근무일', '이름', labels.site, '시프트', '출근', '퇴근', '근무시간', '근무(h)', '메모']);

  for (const r of sorted) {
    const mins = r.check_out_at ? diffMinutes(r.check_in_at, r.check_out_at) : null;
    aoa1.push([
      r.workday,
      r.employee?.name || '',
      r.store?.name || '',
      r.shift?.name || '',
      kst(r.check_in_at).format('HH:mm'),
      r.check_out_at ? kst(r.check_out_at).format('HH:mm') : '근무중',
      mins != null ? minutesToHm(mins) : '',
      mins != null ? Math.round(mins / 6) / 10 : '',
      r.note || '',
    ]);
  }
  const totalMins1 = sorted.reduce((s, r) =>
    s + (r.check_out_at ? diffMinutes(r.check_in_at, r.check_out_at) : 0), 0);
  aoa1.push(['합계', `${sorted.length}건`, '', '', '', '', minutesToHm(totalMins1), Math.round(totalMins1 / 6) / 10, '']);

  const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
  if (bizName) ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
  ws1['!cols'] = [
    { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 10 },
    { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, '출퇴근기록');

  // ── Sheet 2: 출역일보 (날짜 × 직원 크로스탭) ────────────────
  const dates = [...new Set(sorted.map(r => r.workday))]; // 이미 오름차순

  // 직원 순서 유지 (첫 등장 순)
  const empNames = [];
  const seenEmps = new Set();
  for (const r of sorted) {
    const n = r.employee?.name || '?';
    if (!seenEmps.has(n)) { seenEmps.add(n); empNames.push(n); }
  }

  const aoa2 = [];
  const titleRow = [`${bizName ? bizName + ' ' : ''}출역일보 (${periodLabel})`];
  aoa2.push(titleRow);
  aoa2.push([`발행일: ${new Date().toLocaleDateString('ko-KR')}`]);
  aoa2.push([]);
  // 헤더: 날짜 | 현장 | 출역인원 | 직원A | 직원B | ... | 합계(h)
  aoa2.push(['날짜', labels.site, '출역인원', ...empNames, '합계(h)']);

  const colTotalMins = new Array(empNames.length).fill(0);
  let grandMins = 0;

  for (const date of dates) {
    const dayRows = sorted.filter(r => r.workday === date);

    // 해당일 대표 현장 (가장 많은 기록의 현장)
    const storeCnt = {};
    for (const r of dayRows) {
      const s = r.store?.name || '';
      storeCnt[s] = (storeCnt[s] || 0) + 1;
    }
    const mainStore = Object.entries(storeCnt).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    const uniqueEmpCnt = new Set(dayRows.map(r => r.employee?.name || '?')).size;
    const dayTotalMins = dayRows.reduce((s, r) =>
      s + (r.check_out_at ? diffMinutes(r.check_in_at, r.check_out_at) : 0), 0);
    grandMins += dayTotalMins;

    const cells = [date, mainStore, uniqueEmpCnt];
    empNames.forEach((name, i) => {
      const empRows = dayRows.filter(r => r.employee?.name === name);
      if (!empRows.length) { cells.push(''); return; }
      const empMins = empRows.reduce((s, r) =>
        s + (r.check_out_at ? diffMinutes(r.check_in_at, r.check_out_at) : 0), 0);
      colTotalMins[i] += empMins;
      const parts = empRows.map(r => {
        const inT  = kst(r.check_in_at).format('HH:mm');
        const outT = r.check_out_at ? kst(r.check_out_at).format('HH:mm') : '근무중';
        const m    = r.check_out_at ? diffMinutes(r.check_in_at, r.check_out_at) : 0;
        return `${inT}~${outT}(${minutesToHm(m)})`;
      });
      cells.push(parts.join(' / '));
    });
    cells.push(Math.round(dayTotalMins / 6) / 10);
    aoa2.push(cells);
  }

  // 합계 행
  aoa2.push([
    '합계', `${dates.length}일`, '',
    ...colTotalMins.map(m => minutesToHm(m)),
    Math.round(grandMins / 6) / 10,
  ]);

  const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
  ws2['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: empNames.length + 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: empNames.length + 3 } },
  ];
  ws2['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 8 },
    ...empNames.map(() => ({ wch: 24 })),
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, '출역일보');

  XLSX.writeFile(wb, `SCANDGO_출역일보_${month}.xlsx`);
  toast('엑셀 다운로드 완료', 'success');
}
