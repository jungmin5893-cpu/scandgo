import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';

const MIN_WAGE = 10030; // 2025년 최저임금 (원/시간) — 매년 갱신 필요

export async function renderEmployees({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>직원 관리</h1>
      <div class="page-sub">전화번호와 6자리 가입 코드를 발급해 직원이 자기 폰으로 가입하게 합니다</div>
    </div>
    <div class="card">
      <div class="card-head">
        <h2>직원 초대</h2>
        <div class="card-sub">신규 직원의 전화번호를 등록하면 가입 코드가 자동 생성됩니다</div>
      </div>
      <form id="form-invite" class="form-row">
        <input type="text" id="inv-name" placeholder="이름 (선택)" />
        <input type="tel" id="inv-phone" placeholder="010-1234-5678" required />
        <select id="inv-store"></select>
        <button type="submit" id="btn-invite" class="btn primary">가입 코드 발급</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h2>미사용 가입 코드</h2><div class="card-sub">7일 후 자동 만료</div></div>
      <div class="table-wrap">
        <table class="att-table">
          <thead><tr><th>이름</th><th>전화번호</th><th>매장</th><th>코드</th><th>만료</th><th></th></tr></thead>
          <tbody id="invites-rows"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>활성 직원</h2>
        <div class="card-sub">시급, 직책, 공제 유형 수정 가능 · ⚠️ 최저임금(${MIN_WAGE.toLocaleString()}원) 미만 경고</div>
      </div>
      <div class="table-wrap">
        <table class="att-table">
          <thead><tr><th>이름</th><th>전화번호</th><th>매장</th><th>시급</th><th>직책</th><th>공제</th><th>활성</th><th></th></tr></thead>
          <tbody id="emp-rows"></tbody>
        </table>
      </div>
    </div>
  `;

  const form      = root.querySelector('#form-invite');
  const btnInvite = root.querySelector('#btn-invite');

  await loadStores(root, profile);
  await loadInvites(root, profile);
  await loadEmployees(root, profile);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btnInvite.disabled) return;
    btnInvite.disabled = true;
    btnInvite.textContent = '발급 중…';

    const name    = root.querySelector('#inv-name').value.trim();
    const phone   = root.querySelector('#inv-phone').value.trim();
    const storeId = root.querySelector('#inv-store').value || null;

    if (!phone) {
      btnInvite.disabled = false;
      btnInvite.textContent = '가입 코드 발급';
      return;
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { error } = await supabase.from('employee_invites').insert({
      tenant_id: profile.tenant_id, store_id: storeId, phone, name, code,
    });

    btnInvite.disabled = false;
    btnInvite.textContent = '가입 코드 발급';

    if (error) { toast(error.message, 'error'); return; }
    toast(`가입 코드: ${code}\n${phone}로 전달해주세요`, 'success', 5000);
    form.reset();
    await loadInvites(root, profile);
  });
}

async function loadStores(root, profile) {
  const { data } = await supabase.from('stores').select('id, name').eq('tenant_id', profile.tenant_id).order('name');
  const sel = root.querySelector('#inv-store');
  if (!sel) return;
  sel.innerHTML = '<option value="">매장 미지정</option>';
  for (const s of data || []) sel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
}

async function loadInvites(root, profile) {
  const { data } = await supabase
    .from('employee_invites')
    .select('id, name, phone, code, expires_at, store:stores(name)')
    .eq('tenant_id', profile.tenant_id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  const tbody = root.querySelector('#invites-rows');
  if (!tbody) return;
  if (!data?.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">대기 중인 초대 없음</td></tr>'; return; }
  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${r.name || '-'}</td>
      <td>${r.phone}</td>
      <td>${r.store?.name || '미지정'}</td>
      <td><strong class="code">${r.code}</strong></td>
      <td>${new Date(r.expires_at).toLocaleDateString('ko-KR')}</td>
      <td><button class="btn small ghost" data-cancel="${r.id}">취소</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-cancel]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('이 초대를 취소할까요?')) return;
      await supabase.from('employee_invites').delete().eq('id', b.dataset.cancel);
      await loadInvites(root, profile);
    });
  });
}

async function loadEmployees(root, profile) {
  // deduction_type 컬럼이 아직 추가되지 않은 경우를 대비해 fallback 처리
  let { data, error } = await supabase
    .from('profiles')
    .select('id, name, phone, hourly_wage, position, active, deduction_type, store:stores(name)')
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'employee')
    .order('name');
  if (error && /deduction_type/i.test(error.message)) {
    toast('⚠️ profiles 테이블에 deduction_type 컬럼이 없습니다. 공제 기능 사용을 위해 SQL을 실행해주세요.', 'warn', 6000);
    const fallback = await supabase
      .from('profiles')
      .select('id, name, phone, hourly_wage, position, active, store:stores(name)')
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'employee')
      .order('name');
    data = fallback.data;
    error = fallback.error;
  }
  const tbody = root.querySelector('#emp-rows');
  if (!tbody) return;
  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="empty">에러: ${error.message}</td></tr>`; return; }
  if (!data?.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">아직 등록된 직원이 없습니다</td></tr>'; return; }
  tbody.innerHTML = data.map(r => {
    const wage       = r.hourly_wage || 0;
    const wageWarn   = wage > 0 && wage < MIN_WAGE
      ? `<span title="최저임금(${MIN_WAGE.toLocaleString()}원) 미만입니다" style="color:#f04438;cursor:help;margin-left:4px">⚠️</span>`
      : '';
    const deduction  = r.deduction_type || 'insurance';
    return `
    <tr data-id="${r.id}">
      <td><strong>${r.name}</strong></td>
      <td>${r.phone || '-'}</td>
      <td>${r.store?.name || '-'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:2px">
          <input type="number" class="cell-edit" data-field="hourly_wage" value="${wage}" style="width:90px">
          ${wageWarn}
        </div>
      </td>
      <td><input type="text" class="cell-edit" data-field="position" value="${r.position || ''}" style="width:90px"></td>
      <td>
        <select class="cell-edit" data-field="deduction_type" style="width:110px;font-size:12px">
          <option value="insurance" ${deduction === 'insurance' ? 'selected' : ''}>4대보험 (~9.4%)</option>
          <option value="freelancer" ${deduction === 'freelancer' ? 'selected' : ''}>프리랜서 3.3%</option>
          <option value="none" ${deduction === 'none' ? 'selected' : ''}>공제 없음</option>
        </select>
      </td>
      <td><label class="switch"><input type="checkbox" class="cell-edit" data-field="active" ${r.active ? 'checked' : ''}><span></span></label></td>
      <td><button class="btn small primary" data-save="${r.id}">저장</button></td>
    </tr>
    `;
  }).join('');

  // 시급 입력 시 실시간 최저임금 경고
  tbody.querySelectorAll('[data-field="hourly_wage"]').forEach(input => {
    input.addEventListener('input', () => {
      const val  = +input.value;
      const wrap = input.parentElement;
      let warn   = wrap.querySelector('.wage-warn');
      if (val > 0 && val < MIN_WAGE) {
        if (!warn) {
          warn = document.createElement('span');
          warn.className = 'wage-warn';
          warn.title = `최저임금(${MIN_WAGE.toLocaleString()}원) 미만입니다`;
          warn.style.cssText = 'color:#f04438;cursor:help;margin-left:4px';
          warn.textContent = '⚠️';
          wrap.appendChild(warn);
        }
      } else {
        warn?.remove();
      }
    });
  });

  tbody.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr      = btn.closest('tr');
      const updates = {};
      tr.querySelectorAll('.cell-edit').forEach(el => {
        const f = el.dataset.field;
        if (el.type === 'checkbox') updates[f] = el.checked;
        else if (el.type === 'number') updates[f] = +el.value;
        else updates[f] = el.value;
      });
      // 최저임금 경고 후 저장 진행
      if (updates.hourly_wage > 0 && updates.hourly_wage < MIN_WAGE) {
        if (!confirm(`시급 ${Number(updates.hourly_wage).toLocaleString()}원은 최저임금(${MIN_WAGE.toLocaleString()}원)보다 낮습니다. 그래도 저장할까요?`)) return;
      }
      btn.disabled = true;
      const { error } = await supabase.from('profiles').update(updates).eq('id', btn.dataset.save);
      btn.disabled = false;
      if (error) toast(error.message, 'error');
      else toast('저장됨', 'success');
    });
  });
}
