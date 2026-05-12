import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import { listShiftTypes, upsertShiftType, deleteShiftType, setShiftAssignment } from '../../../lib/shifts.js';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export async function renderShifts({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>시프트 관리</h1>
      <div class="page-sub">근무 시프트를 정의하고 직원별·요일별로 할당합니다 (예: 주간조, 야간조)</div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>시프트 타입</h2>
        <div class="card-sub">시작/종료 시각이 다음날을 넘으면 자동으로 야간조로 인식되어 근무일 컷오프에 사용됩니다</div>
      </div>
      <div id="shift-types-list"></div>
      <form id="form-shift-type" class="form-row">
        <input type="text" id="sh-name" placeholder="이름 (예: 야간조)" required>
        <input type="time" id="sh-start" required>
        <input type="time" id="sh-end" required>
        <input type="number" id="sh-break" placeholder="휴게(분)" value="0" style="width:90px">
        <input type="color" id="sh-color" value="#00c9a7" style="width:50px">
        <button type="submit" class="btn primary">추가</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>직원별 주간 시프트</h2>
        <div class="card-sub">셀을 클릭해 요일별 시프트를 변경. 변경은 오늘부터 유효, 과거 기록은 보존됩니다.</div>
      </div>
      <div class="table-wrap">
        <table class="att-table grid-table" id="shift-grid">
          <thead><tr><th>직원</th>${DOW.map(d => `<th>${d}</th>`).join('')}</tr></thead>
          <tbody id="grid-body"></tbody>
        </table>
      </div>
    </div>
  `;

  // 뷰 스코프 상태 (root에 보관)
  root._shiftState = { shiftTypes: [], employees: [], grid: {} };

  await loadAll(root, profile);

  root.querySelector('#form-shift-type').addEventListener('submit', async (e) => {
    e.preventDefault();
    const row = {
      tenant_id: profile.tenant_id,
      name: root.querySelector('#sh-name').value.trim(),
      start_time: root.querySelector('#sh-start').value + ':00',
      end_time: root.querySelector('#sh-end').value + ':00',
      break_minutes: parseInt(root.querySelector('#sh-break').value) || 0,
      color: root.querySelector('#sh-color').value,
    };
    try {
      await upsertShiftType(row);
      toast('시프트 추가됨', 'success');
      e.target.reset();
      root.querySelector('#sh-color').value = '#00c9a7';
      await loadAll(root, profile);
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function loadAll(root, profile) {
  const state = root._shiftState;
  state.shiftTypes = await listShiftTypes(profile.tenant_id);
  renderShiftTypes(root, profile, state);

  const { data: emps } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'employee')
    .eq('active', true)
    .order('name');
  state.employees = emps || [];

  const today = new Date().toISOString().slice(0, 10);
  const { data: shifts } = await supabase
    .from('employee_shifts')
    .select('employee_id, weekday, shift_type_id')
    .eq('tenant_id', profile.tenant_id)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gte.${today}`);

  state.grid = {};
  for (const e of state.employees) state.grid[e.id] = {};
  for (const s of shifts || []) state.grid[s.employee_id][s.weekday] = s.shift_type_id;

  renderGrid(root, profile, state);
}

function renderShiftTypes(root, profile, state) {
  const list = root.querySelector('#shift-types-list');
  if (!state.shiftTypes.length) { list.innerHTML = '<div class="empty-state">시프트가 없습니다. 아래에서 추가하세요.</div>'; return; }
  list.innerHTML = state.shiftTypes.map(st => `
    <div class="shift-pill" style="border-color:${st.color}">
      <span class="dot" style="background:${st.color}"></span>
      <strong>${st.name}</strong>
      <span class="time">${st.start_time.slice(0,5)} ~ ${st.end_time.slice(0,5)}</span>
      ${st.is_overnight ? '<span class="pill night">야간</span>' : ''}
      ${st.break_minutes ? `<span class="muted">휴게 ${st.break_minutes}분</span>` : ''}
      <button class="btn small ghost" data-del-shift="${st.id}">삭제</button>
    </div>
  `).join('');
  list.querySelectorAll('[data-del-shift]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('시프트 타입을 삭제할까요? 이미 사용된 기록은 보존됩니다.')) return;
    try { await deleteShiftType(b.dataset.delShift); toast('삭제됨', 'success'); await loadAll(root, profile); }
    catch (err) { toast(err.message, 'error'); }
  }));
}

function renderGrid(root, profile, state) {
  const body = root.querySelector('#grid-body');
  if (!state.employees.length) { body.innerHTML = `<tr><td colspan="8" class="empty">활성 직원이 없습니다</td></tr>`; return; }
  body.innerHTML = state.employees.map(emp => `
    <tr>
      <td><strong>${emp.name}</strong></td>
      ${DOW.map((_, dow) => {
        const stId = state.grid[emp.id][dow];
        const st = state.shiftTypes.find(s => s.id === stId);
        return `<td class="grid-cell" data-emp="${emp.id}" data-dow="${dow}">
          ${cellHtml(st)}
        </td>`;
      }).join('')}
    </tr>
  `).join('');
  body.querySelectorAll('.grid-cell').forEach(td => {
    td.addEventListener('click', () => openCellPicker(td, root, profile, state));
  });
}

function cellHtml(st) {
  if (!st) return '<span class="muted">휴무</span>';
  return `<span class="shift-chip" style="background:${st.color}20;color:${st.color};border-color:${st.color}40">
    ${st.name}<br><span style="font-size:10px;opacity:.8">${st.start_time.slice(0,5)}~${st.end_time.slice(0,5)}</span>
  </span>`;
}

function openCellPicker(td, root, profile, state) {
  const empId = td.dataset.emp;
  const dow = parseInt(td.dataset.dow);
  const popup = document.createElement('div');
  popup.className = 'cell-picker';
  popup.innerHTML = `
    <div class="picker-row" data-id=""><span class="muted">휴무</span></div>
    ${state.shiftTypes.map(st => `
      <div class="picker-row" data-id="${st.id}">
        <span class="dot" style="background:${st.color}"></span>
        <strong>${st.name}</strong>
        <span class="muted">${st.start_time.slice(0,5)}~${st.end_time.slice(0,5)}</span>
      </div>
    `).join('')}
  `;
  td.appendChild(popup);
  popup.addEventListener('click', async (e) => {
    const row = e.target.closest('.picker-row');
    if (!row) return;
    const newId = row.dataset.id || null;
    try {
      await setShiftAssignment({ tenantId: profile.tenant_id, employeeId: empId, weekday: dow, shiftTypeId: newId });
      state.grid[empId][dow] = newId;
      td.innerHTML = cellHtml(state.shiftTypes.find(s => s.id === newId));
      popup.remove();
      toast('시프트 변경 완료 (오늘부터 적용)', 'success');
    } catch (err) { toast(err.message, 'error'); popup.remove(); }
  });
  const closeOnOutside = (e) => {
    if (!popup.contains(e.target) && e.target !== td) {
      popup.remove();
      document.removeEventListener('click', closeOnOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside, true), 50);
}
