import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import { getLabels } from '../../../lib/labels.js';
import { kst, minutesToHm, diffMinutes } from '../../../lib/time.js';

// ─────────────────────────────────────────────────────────────
// 현장 관리 메인 렌더
// ─────────────────────────────────────────────────────────────
export async function renderStores({ root, profile }) {
  const labels = getLabels(profile.tenants?.industry_type);
  const siteLbl = labels.site;
  const siteAddLbl = labels.siteAdd;
  const workerLbl = labels.worker;

  root.innerHTML = `
    <div class="page-head">
      <h1>${siteLbl} 관리</h1>
      <div class="page-sub">${siteLbl}별 QR 코드, 위치, ${workerLbl} 목록</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>${siteAddLbl}</h2></div>
      <form id="form-store" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:8px">
          <input type="text" id="st-name" placeholder="${siteLbl} 이름" required style="flex:1">
          <input type="number" id="st-radius" placeholder="반경(m)" value="100" style="width:100px">
        </div>
        <div style="display:flex;gap:8px">
          <input type="text" id="st-addr" placeholder="주소 검색 버튼을 눌러주세요"
            readonly style="flex:1;cursor:pointer;background:#f8fafc">
          <button type="button" id="btn-addr-search" class="btn">🔍 주소 검색</button>
        </div>
        <input type="hidden" id="st-lat">
        <input type="hidden" id="st-lng">
        <div id="st-map-preview" style="display:none;height:220px;border-radius:8px;overflow:hidden;border:1px solid #e9edf2"></div>
        <div>
          <button type="submit" class="btn primary">추가</button>
        </div>
      </form>
    </div>
    <div id="stores-list"></div>

    <!-- 출근일지 캘린더 모달 -->
    <div id="cal-modal" class="cal-modal-overlay" style="display:none">
      <div class="cal-modal">
        <div class="cal-modal-head">
          <div class="cal-emp-info">
            <div class="cal-emp-avatar" id="cal-avatar"></div>
            <div>
              <div class="cal-emp-name" id="cal-emp-name"></div>
              <div class="cal-emp-sub" id="cal-emp-sub"></div>
            </div>
          </div>
          <button class="cal-close" id="btn-cal-close">✕</button>
        </div>
        <div class="cal-nav">
          <button class="btn small ghost" id="btn-cal-prev">◀</button>
          <span class="cal-month-label" id="cal-month-label"></span>
          <button class="btn small ghost" id="btn-cal-next">▶</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
        <div class="cal-legend">
          <span class="cal-legend-item"><span class="cal-dot present"></span>정상 출근</span>
          <span class="cal-legend-item"><span class="cal-dot no-out"></span>미퇴근</span>
          <span class="cal-legend-item"><span class="cal-dot late"></span>지각(30분↑)</span>
        </div>
        <div class="cal-summary" id="cal-summary"></div>
      </div>
    </div>
  `;

  injectCalModalStyle();
  await loadStores(root, profile, siteLbl, workerLbl);

  root.querySelector('#btn-addr-search').addEventListener('click', () => openPostcode(root));
  root.querySelector('#st-addr').addEventListener('click', () => openPostcode(root));

  root.querySelector('#form-store').addEventListener('submit', async (e) => {
    e.preventDefault();
    const row = {
      tenant_id: profile.tenant_id,
      name: root.querySelector('#st-name').value.trim(),
      gps_lat: parseFloat(root.querySelector('#st-lat').value) || null,
      gps_lng: parseFloat(root.querySelector('#st-lng').value) || null,
      gps_radius_m: parseInt(root.querySelector('#st-radius').value) || 100,
    };
    const { error } = await supabase.from('stores').insert(row);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${siteLbl} 추가 완료`, 'success');
    e.target.reset();
    root.querySelector('#st-map-preview').style.display = 'none';
    await loadStores(root, profile, siteLbl, workerLbl);
  });

  // 캘린더 모달 닫기
  root.querySelector('#btn-cal-close').addEventListener('click', () => closeCalModal(root));
  root.querySelector('#cal-modal').addEventListener('click', (e) => {
    if (e.target === root.querySelector('#cal-modal')) closeCalModal(root);
  });
}

// ─────────────────────────────────────────────────────────────
// 현장 목록 로드
// ─────────────────────────────────────────────────────────────
async function loadStores(root, profile, siteLbl = '현장', workerLbl = '직원') {
  const { data } = await supabase.from('stores').select('*')
    .eq('tenant_id', profile.tenant_id).order('name');
  const list = root.querySelector('#stores-list');
  if (!data?.length) {
    list.innerHTML = `<div class="card"><div class="empty-state">아직 등록된 ${siteLbl}이 없습니다</div></div>`;
    return;
  }

  list.innerHTML = data.map(s => `
    <div class="card store-card" data-id="${s.id}">
      <!-- 헤더: 클릭 시 직원 목록 토글 -->
      <div class="store-head store-head-toggle" data-store-id="${s.id}">
        <h3 class="store-name-title">${s.name}</h3>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="store-emp-badge" id="badge-${s.id}" title="${workerLbl} 수"></span>
          <span class="store-toggle-icon" id="icon-${s.id}">▼</span>
        </div>
      </div>

      <!-- QR + 정보 섹션 -->
      <div class="store-body">
        <div class="qr-block">
          <div id="qr-${s.id}" class="qr-canvas"></div>
          <div class="qr-caption">QR 시크릿: <code>${s.qr_secret.slice(0, 8)}…</code></div>
          <button class="btn small" data-download="${s.id}">QR PNG 저장</button>
        </div>
        <div class="store-info">
          <div><b>위치:</b> ${s.gps_lat ? `${s.gps_lat.toFixed(5)}, ${s.gps_lng.toFixed(5)}` : '미설정'}</div>
          <div><b>반경:</b> ${s.gps_radius_m}m</div>
          <div class="qr-content"><b>QR 내용:</b><br><code>tagin://checkin?store=${s.id}&s=${s.qr_secret}</code></div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn small ghost" data-regen="${s.id}">QR 재발급</button>
            <button class="btn small danger" data-del="${s.id}">현장 삭제</button>
          </div>
        </div>
      </div>

      <!-- 직원 목록 섹션 (토글) -->
      <div class="store-emp-section" id="emp-section-${s.id}" style="display:none">
        <div class="store-emp-loading">불러오는 중…</div>
      </div>
    </div>
  `).join('');

  // QR 렌더
  for (const s of data) {
    renderQrInto(root, `qr-${s.id}`, `tagin://checkin?store=${s.id}&s=${s.qr_secret}`);
    loadEmpBadge(root, s.id, profile, workerLbl);
  }

  // 헤더 클릭 → 직원 목록 토글
  list.querySelectorAll('.store-head-toggle').forEach(head => {
    head.addEventListener('click', () => toggleEmpSection(root, head.dataset.storeId, profile, workerLbl));
  });

  // QR 재발급
  list.querySelectorAll('[data-regen]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('기존 QR이 무효화됩니다. 계속할까요?')) return;
    const newSecret = crypto.randomUUID().replace(/-/g, '');
    const { error } = await supabase.from('stores').update({ qr_secret: newSecret }).eq('id', b.dataset.regen);
    if (error) toast(error.message, 'error');
    else { toast('QR 재발급 완료', 'success'); await loadStores(root, profile, siteLbl, workerLbl); }
  }));

  // 현장 삭제
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`이 ${siteLbl}을 삭제하면 관련 출퇴근 기록도 함께 삭제됩니다. 계속할까요?`)) return;
    const { error } = await supabase.from('stores').delete().eq('id', b.dataset.del);
    if (error) toast(error.message, 'error');
    else { toast('삭제됨', 'success'); await loadStores(root, profile, siteLbl, workerLbl); }
  }));

  // QR 다운로드
  list.querySelectorAll('[data-download]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadQr(root, b.dataset.download);
  }));
}

// ─────────────────────────────────────────────────────────────
// 직원 뱃지 (카운트)
// ─────────────────────────────────────────────────────────────
async function loadEmpBadge(root, storeId, profile, workerLbl) {
  const { count } = await supabase.from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId).eq('role', 'employee').eq('active', true);
  const badge = root.querySelector(`#badge-${storeId}`);
  if (badge) {
    badge.textContent = count ? `${workerLbl} ${count}명` : `${workerLbl} 0명`;
    badge.style.cssText = `
      font-size:12px;padding:2px 8px;border-radius:12px;font-weight:600;
      background:${count ? 'rgba(0,201,167,.15)' : 'rgba(138,148,166,.12)'};
      color:${count ? '#00c9a7' : '#8a94a6'};
    `;
  }
}

// ─────────────────────────────────────────────────────────────
// 현장 직원 목록 토글
// ─────────────────────────────────────────────────────────────
async function toggleEmpSection(root, storeId, profile, workerLbl) {
  const section = root.querySelector(`#emp-section-${storeId}`);
  const icon = root.querySelector(`#icon-${storeId}`);
  if (!section) return;

  const isOpen = section.style.display !== 'none';
  if (isOpen) {
    section.style.display = 'none';
    if (icon) icon.textContent = '▼';
    return;
  }

  section.style.display = 'block';
  if (icon) icon.textContent = '▲';

  // 이미 로드됐으면 스킵
  if (section.dataset.loaded === '1') return;

  const { data: emps, error } = await supabase
    .from('profiles')
    .select('id, name, phone, position, active, hourly_wage, wage_type')
    .eq('store_id', storeId)
    .eq('role', 'employee')
    .order('name');

  if (error) {
    section.innerHTML = `<div style="padding:12px;color:#f04438;font-size:13px">불러오기 실패: ${error.message}</div>`;
    return;
  }
  if (!emps?.length) {
    section.innerHTML = `<div style="padding:16px 0 8px;text-align:center;color:#8a94a6;font-size:13px">이 현장에 배정된 ${workerLbl}이 없습니다</div>`;
    section.dataset.loaded = '1';
    return;
  }

  // 이번 달 출근일 수 미리 조회
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${lastDay}`;

  const empIds = emps.map(e => e.id);
  const { data: attRows } = await supabase
    .from('attendances')
    .select('employee_id, workday')
    .in('employee_id', empIds)
    .gte('workday', monthStart)
    .lte('workday', monthEnd);

  const attMap = {};
  for (const row of attRows || []) {
    attMap[row.employee_id] = (attMap[row.employee_id] || 0) + 1;
  }

  section.innerHTML = `
    <div class="store-emp-header">
      <span style="font-size:13px;font-weight:600;color:#8a94a6">이번 달 출근 현황</span>
    </div>
    <div class="store-emp-grid">
      ${emps.map(emp => `
        <div class="emp-mini-card" data-emp-id="${emp.id}" data-emp-name="${emp.name}" data-store-id="${storeId}">
          <div class="emp-mini-avatar">${emp.name.slice(0, 1)}</div>
          <div class="emp-mini-info">
            <div class="emp-mini-name">${emp.name}</div>
            <div class="emp-mini-sub">${emp.position || workerLbl} · ${emp.active ? '<span style="color:#00c9a7">활성</span>' : '<span style="color:#8a94a6">비활성</span>'}</div>
          </div>
          <div class="emp-mini-att">
            <div class="emp-mini-days">${attMap[emp.id] || 0}일</div>
            <div class="emp-mini-days-sub">이번 달</div>
          </div>
          <div class="emp-mini-arrow">›</div>
        </div>
      `).join('')}
    </div>
  `;
  section.dataset.loaded = '1';

  // 직원 카드 클릭 → 캘린더 모달
  section.querySelectorAll('.emp-mini-card').forEach(card => {
    card.addEventListener('click', () => {
      const storeName = root.querySelector(`[data-id="${card.dataset.storeId}"] .store-name-title`)?.textContent || '';
      openCalModal(root, card.dataset.empId, card.dataset.empName, storeName, profile);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// 캘린더 모달 열기
// ─────────────────────────────────────────────────────────────
function openCalModal(root, empId, empName, storeName, profile) {
  const modal = root.querySelector('#cal-modal');
  root.querySelector('#cal-avatar').textContent = empName.slice(0, 1);
  root.querySelector('#cal-emp-name').textContent = empName;
  root.querySelector('#cal-emp-sub').textContent = storeName;

  modal._empId = empId;
  modal._profile = profile;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const now = new Date();
  modal._year = now.getFullYear();
  modal._month = now.getMonth(); // 0-indexed

  renderCalModal(root);

  root.querySelector('#btn-cal-prev').onclick = () => {
    if (modal._month === 0) { modal._year--; modal._month = 11; }
    else modal._month--;
    renderCalModal(root);
  };
  root.querySelector('#btn-cal-next').onclick = () => {
    if (modal._month === 11) { modal._year++; modal._month = 0; }
    else modal._month++;
    renderCalModal(root);
  };
}

function closeCalModal(root) {
  const modal = root.querySelector('#cal-modal');
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

// ─────────────────────────────────────────────────────────────
// 캘린더 렌더
// ─────────────────────────────────────────────────────────────
async function renderCalModal(root) {
  const modal = root.querySelector('#cal-modal');
  const { _empId: empId, _year: year, _month: month } = modal;

  const monthStr = `${year}년 ${month + 1}월`;
  root.querySelector('#cal-month-label').textContent = monthStr;

  const grid = root.querySelector('#cal-grid');
  grid.innerHTML = '<div style="grid-column:1/-1;padding:16px;text-align:center;color:#8a94a6;font-size:13px">불러오는 중…</div>';
  root.querySelector('#cal-summary').textContent = '';

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const monthStart = fmt(firstDay);
  const monthEnd = fmt(lastDay);

  // 해당 직원 이번 달 출근 기록 조회
  const { data: rows, error } = await supabase
    .from('attendances')
    .select('workday, check_in_at, check_out_at, shift_types(name, start_time)')
    .eq('employee_id', empId)
    .gte('workday', monthStart)
    .lte('workday', monthEnd)
    .order('workday');

  if (error) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:16px;color:#f04438;font-size:13px">오류: ${error.message}</div>`;
    return;
  }

  // workday → 출근 데이터 맵
  const attByDay = {};
  for (const r of rows || []) {
    attByDay[r.workday] = r;
  }

  // 통계
  const totalDays = rows?.length || 0;
  let totalMins = 0;
  let lateCount = 0;
  let noOutCount = 0;

  for (const r of rows || []) {
    if (r.check_in_at && r.check_out_at) {
      totalMins += diffMinutes(r.check_in_at, r.check_out_at);
    }
    if (!r.check_out_at) noOutCount++;
    // 지각: check_in이 shift start보다 30분 이상 늦음
    if (r.check_in_at && r.shift_types?.start_time) {
      const shiftStart = new Date(`${r.workday}T${r.shift_types.start_time}+09:00`);
      const actualIn = new Date(r.check_in_at);
      if (actualIn - shiftStart > 30 * 60 * 1000) lateCount++;
    }
  }

  // 달력 그리기
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const today = fmt(new Date());
  let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const startDow = firstDay.getDay(); // 0=일
  for (let i = 0; i < startDow; i++) html += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const att = attByDay[dateStr];
    const isToday = dateStr === today;
    const dow = new Date(year, month, d).getDay();
    const isWeekend = dow === 0 || dow === 6;

    let cls = 'cal-cell';
    let badge = '';
    let detail = '';

    if (att) {
      const inTime = att.check_in_at ? kst(att.check_in_at).format('HH:mm') : null;
      const outTime = att.check_out_at ? kst(att.check_out_at).format('HH:mm') : null;

      if (!att.check_out_at) {
        cls += ' no-out';
        badge = '<span class="cal-badge no-out-badge">미퇴근</span>';
      } else {
        // 지각 여부
        let isLate = false;
        if (att.shift_types?.start_time) {
          const shiftStart = new Date(`${dateStr}T${att.shift_types.start_time}+09:00`);
          isLate = (new Date(att.check_in_at) - shiftStart) > 30 * 60 * 1000;
        }
        cls += isLate ? ' late' : ' present';
        badge = isLate ? '<span class="cal-badge late-badge">지각</span>' : '';
      }
      detail = `<div class="cal-time">${inTime || '--'}${outTime ? `<br>${outTime}` : ''}</div>`;
    }

    if (isToday) cls += ' today';
    if (isWeekend) cls += ' weekend';

    html += `
      <div class="${cls}" title="${dateStr}">
        <div class="cal-day-num">${d}</div>
        ${badge}
        ${detail}
      </div>
    `;
  }

  grid.innerHTML = html;

  // 요약
  const summaryEl = root.querySelector('#cal-summary');
  summaryEl.innerHTML = `
    <div class="cal-stat"><span class="cal-stat-val">${totalDays}</span><span class="cal-stat-lbl">출근일</span></div>
    <div class="cal-stat"><span class="cal-stat-val">${minutesToHm(totalMins)}</span><span class="cal-stat-lbl">총 근무</span></div>
    <div class="cal-stat"><span class="cal-stat-val ${lateCount ? 'warn' : ''}">${lateCount}</span><span class="cal-stat-lbl">지각</span></div>
    <div class="cal-stat"><span class="cal-stat-val ${noOutCount ? 'warn' : ''}">${noOutCount}</span><span class="cal-stat-lbl">미퇴근</span></div>
  `;
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// 캘린더 모달 CSS 주입
// ─────────────────────────────────────────────────────────────
function injectCalModalStyle() {
  if (document.getElementById('cal-modal-style')) return;
  const s = document.createElement('style');
  s.id = 'cal-modal-style';
  s.textContent = `
    /* ── 현장 카드 헤더 토글 ── */
    .store-head-toggle {
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .store-head-toggle:hover { background: rgba(0,201,167,.04); border-radius: 8px; }
    .store-toggle-icon {
      font-size: 12px;
      color: #8a94a6;
      transition: transform .2s;
    }

    /* ── 직원 섹션 ── */
    .store-emp-section {
      border-top: 1px solid #e9edf2;
      margin-top: 12px;
      padding-top: 12px;
    }
    .store-emp-header { margin-bottom: 10px; }
    .store-emp-loading { padding: 12px 0; text-align: center; color: #8a94a6; font-size: 13px; }
    .store-emp-grid { display: flex; flex-direction: column; gap: 6px; }

    .emp-mini-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #f8fafc;
      cursor: pointer;
      transition: background .15s, transform .1s;
    }
    .emp-mini-card:hover { background: rgba(0,201,167,.08); transform: translateX(2px); }
    .emp-mini-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: linear-gradient(135deg,#00c9a7,#7c3aed);
      color: #fff; font-weight: 700; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .emp-mini-info { flex: 1; min-width: 0; }
    .emp-mini-name { font-weight: 600; font-size: 14px; }
    .emp-mini-sub { font-size: 12px; color: #8a94a6; margin-top: 2px; }
    .emp-mini-att { text-align: right; flex-shrink: 0; }
    .emp-mini-days { font-size: 16px; font-weight: 700; color: #00c9a7; }
    .emp-mini-days-sub { font-size: 11px; color: #8a94a6; }
    .emp-mini-arrow { color: #8a94a6; font-size: 18px; flex-shrink: 0; }

    /* ── 캘린더 모달 오버레이 ── */
    .cal-modal-overlay {
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(15,27,45,.7);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      backdrop-filter: blur(4px);
    }
    .cal-modal {
      background: var(--card-bg, #1a2740);
      border-radius: 16px;
      width: 100%; max-width: 520px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 24px 64px rgba(0,0,0,.5);
      padding: 0;
    }

    /* ── 모달 헤더 ── */
    .cal-modal-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 20px 16px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .cal-emp-info { display: flex; align-items: center; gap: 12px; }
    .cal-emp-avatar {
      width: 44px; height: 44px; border-radius: 50%;
      background: linear-gradient(135deg,#00c9a7,#7c3aed);
      color: #fff; font-weight: 700; font-size: 20px;
      display: flex; align-items: center; justify-content: center;
    }
    .cal-emp-name { font-size: 16px; font-weight: 700; }
    .cal-emp-sub { font-size: 12px; color: #8a94a6; margin-top: 2px; }
    .cal-close {
      background: none; border: none; cursor: pointer;
      font-size: 18px; color: #8a94a6; padding: 4px;
      line-height: 1;
    }
    .cal-close:hover { color: #fff; }

    /* ── 월 네비 ── */
    .cal-nav {
      display: flex; align-items: center; justify-content: center; gap: 16px;
      padding: 12px 20px;
    }
    .cal-month-label { font-size: 15px; font-weight: 700; min-width: 90px; text-align: center; }

    /* ── 달력 그리드 ── */
    .cal-grid {
      display: grid; grid-template-columns: repeat(7, 1fr);
      gap: 3px; padding: 4px 12px 8px;
    }
    .cal-dow {
      text-align: center; font-size: 11px; font-weight: 700;
      color: #8a94a6; padding: 4px 0 6px;
    }
    .cal-cell {
      aspect-ratio: 1;
      border-radius: 8px;
      padding: 4px 3px 2px;
      font-size: 11px;
      position: relative;
      display: flex; flex-direction: column; align-items: center;
      background: rgba(255,255,255,.03);
      transition: transform .1s;
      min-height: 46px;
    }
    .cal-cell.empty { background: transparent; }
    .cal-cell.today { box-shadow: inset 0 0 0 2px #00c9a7; }
    .cal-cell.weekend .cal-day-num { color: #f97316; }
    .cal-cell.present { background: rgba(0,201,167,.18); }
    .cal-cell.no-out  { background: rgba(249,115,22,.18); }
    .cal-cell.late    { background: rgba(245,158,11,.18); }

    .cal-day-num {
      font-size: 12px; font-weight: 600;
      color: var(--gray4, #e2e8f0);
    }
    .cal-time {
      font-size: 9px; color: #8a94a6; text-align: center;
      line-height: 1.3; margin-top: 2px;
    }
    .cal-badge {
      font-size: 8px; border-radius: 4px; padding: 1px 3px;
      font-weight: 700; margin-top: 2px;
    }
    .no-out-badge  { background: rgba(249,115,22,.3);  color: #fb923c; }
    .late-badge    { background: rgba(245,158,11,.3);  color: #fbbf24; }

    /* ── 범례 ── */
    .cal-legend {
      display: flex; gap: 16px; justify-content: center;
      padding: 6px 20px 10px; flex-wrap: wrap;
    }
    .cal-legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #8a94a6; }
    .cal-dot {
      width: 10px; height: 10px; border-radius: 3px;
    }
    .cal-dot.present { background: rgba(0,201,167,.6); }
    .cal-dot.no-out  { background: rgba(249,115,22,.6); }
    .cal-dot.late    { background: rgba(245,158,11,.6); }

    /* ── 요약 ── */
    .cal-summary {
      display: flex; justify-content: space-around;
      padding: 14px 20px 20px;
      border-top: 1px solid rgba(255,255,255,.08);
    }
    .cal-stat { text-align: center; }
    .cal-stat-val { display: block; font-size: 22px; font-weight: 800; color: #00c9a7; }
    .cal-stat-val.warn { color: #f59e0b; }
    .cal-stat-lbl { display: block; font-size: 11px; color: #8a94a6; margin-top: 2px; }
  `;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────
// QR 관련 (기존 유지)
// ─────────────────────────────────────────────────────────────
async function renderQrInto(root, id, text) {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  el.innerHTML = '<div style="color:#8a94a6;font-size:12px;">QR 생성 중…</div>';
  try {
    if (!window._QRCode) {
      const { default: QRCode } = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
      window._QRCode = QRCode;
    }
    const canvas = document.createElement('canvas');
    await window._QRCode.toCanvas(canvas, text, { width: 200, margin: 1, color: { dark: '#0f1b2d', light: '#ffffff' } });
    el.innerHTML = '';
    el.appendChild(canvas);
    el._canvas = canvas;
  } catch (err) {
    el.innerHTML = `<div style="color:#f04438;font-size:12px;">QR 로드 실패: ${err.message}</div>`;
  }
}

function downloadQr(root, storeId) {
  const el = root.querySelector(`#qr-${storeId}`);
  const canvas = el?._canvas;
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `TAGIN_QR_${storeId.slice(0, 8)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ─────────────────────────────────────────────────────────────
// 주소 검색 / 지도 (기존 유지)
// ─────────────────────────────────────────────────────────────
async function openPostcode(root) {
  if (!window.daum?.Postcode) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('주소 검색 스크립트 로드 실패'));
      document.head.appendChild(s);
    });
  }
  new window.daum.Postcode({
    oncomplete: async (data) => {
      const addr = data.roadAddress || data.jibunAddress || data.address;
      root.querySelector('#st-addr').value = addr;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr + ', 대한민국')}&limit=1`,
          { headers: { 'Accept-Language': 'ko' } }
        );
        const json = await res.json();
        if (json.length) {
          const lat = parseFloat(json[0].lat);
          const lng = parseFloat(json[0].lon);
          root.querySelector('#st-lat').value = lat;
          root.querySelector('#st-lng').value = lng;
          await showMapPreview(root, lat, lng, addr);
        } else {
          toast('좌표를 찾지 못했습니다. 주소는 저장되지만 GPS 기능은 제한됩니다.', 'warn', 4000);
        }
      } catch { toast('좌표 조회 중 오류가 발생했습니다.', 'warn'); }
    },
  }).open();
}

async function showMapPreview(root, lat, lng, label) {
  const mapDiv = root.querySelector('#st-map-preview');
  mapDiv.style.display = 'block';
  mapDiv.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8a94a6;font-size:13px">지도 로딩 중…</div>';
  if (!window.L) {
    await Promise.all([
      loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
      loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'),
    ]);
  }
  mapDiv.innerHTML = '';
  if (mapDiv._leaflet_id) window.L.DomUtil.get(mapDiv)._leaflet_id = null;
  const map = window.L.map(mapDiv).setView([lat, lng], 16);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
  }).addTo(map);
  window.L.marker([lat, lng]).addTo(map).bindPopup(label).openPopup();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) { resolve(); return; }
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = resolve;
    document.head.appendChild(l);
  });
}
