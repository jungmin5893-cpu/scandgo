import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import { getLabels } from '../../../lib/labels.js';
import * as XLSX from 'xlsx';

const MIN_HOURLY  = 10320;               // 2026년 최저시급 (원)
const MIN_DAILY   = MIN_HOURLY * 8;      // 최저일급 (8h 기준)
const MIN_MONTHLY = MIN_HOURLY * 209;    // 최저월급 (209h 기준, 2026년 = 2,156,880원)

const WAGE_META = {
  hourly:  { label: '시급', unit: '원/시간', min: MIN_HOURLY  },
  daily:   { label: '일급', unit: '원/일',   min: MIN_DAILY   },
  monthly: { label: '월급', unit: '원/월',   min: MIN_MONTHLY },
};

export async function renderEmployees({ root, profile }) {
  const labels = getLabels(profile.tenants?.industry_type);
  const wLbl = labels.worker;   // 직원 / 근로자 / 인력
  const sLbl = labels.site;     // 현장 / 파견처

  root.innerHTML = `
    <div class="page-head">
      <h1>${wLbl} 관리</h1>
      <div class="page-sub">전화번호와 6자리 가입 코드를 발급해 ${wLbl}이 자기 폰으로 가입하게 합니다</div>
    </div>

    <!-- ── 엑셀 일괄 등록 ── -->
    <div class="card">
      <div class="card-head" style="flex-direction:row;justify-content:space-between;align-items:center">
        <div>
          <h2>📋 엑셀 일괄 등록</h2>
          <div class="card-sub">엑셀 파일로 ${wLbl}을 한 번에 등록합니다</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn small" id="btn-dl-template">📥 템플릿 다운로드</button>
          <button class="btn small primary" id="btn-import-excel">📤 엑셀 업로드</button>
          <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv" style="display:none">
        </div>
      </div>
      <div id="import-preview" style="display:none;padding:14px 20px;border-top:1px solid var(--gray2)">
        <!-- 미리보기 -->
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>${wLbl} 초대</h2>
        <div class="card-sub">신규 ${wLbl}의 전화번호를 등록하면 가입 코드가 자동 생성됩니다</div>
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
          <thead><tr><th>이름</th><th>전화번호</th><th>${sLbl}</th><th>코드</th><th>만료</th><th></th></tr></thead>
          <tbody id="invites-rows"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>활성 ${wLbl}</h2>
        <div class="card-sub">급여 방식(시급·일급·월급)·금액·공제 유형 수정 가능 · 최저임금 미만 경고</div>
      </div>
      <div class="table-wrap">
        <table class="att-table">
          <thead>
            <tr>
              <th>이름</th><th>전화번호</th><th>${sLbl}</th>
              <th>급여 방식</th><th>금액</th>
              <th>직책</th><th>공제</th><th>활성</th><th>권한</th><th></th>
            </tr>
          </thead>
          <tbody id="emp-rows"></tbody>
        </table>
      </div>
    </div>
  `;

  root._siteLbl = sLbl; // 내부 함수에서 참조
  await loadStores(root, profile);
  await loadInvites(root, profile);
  await loadEmployees(root, profile);

  // ── 엑셀 일괄 등록 ──────────────────────────────────────
  root.querySelector('#btn-dl-template').addEventListener('click', () => downloadTemplate());
  root.querySelector('#btn-import-excel').addEventListener('click', () => {
    root.querySelector('#import-file-input').click();
  });
  root.querySelector('#import-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset
    await handleImportFile(file, root, profile);
  });

  root.querySelector('#form-invite').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = root.querySelector('#btn-invite');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '발급 중…';

    const name    = root.querySelector('#inv-name').value.trim();
    const phone   = root.querySelector('#inv-phone').value.trim();
    const storeId = root.querySelector('#inv-store').value || null;

    if (!phone) { btn.disabled = false; btn.textContent = '가입 코드 발급'; return; }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { error } = await supabase.from('employee_invites').insert({
      tenant_id: profile.tenant_id, store_id: storeId, phone, name, code,
    });
    btn.disabled = false;
    btn.textContent = '가입 코드 발급';
    if (error) { toast(error.message, 'error'); return; }
    e.target.reset();
    await loadInvites(root, profile);
    showInviteShareCard(root, { code, phone, name });
  });
}

async function loadStores(root, profile) {
  const { data } = await supabase.from('stores').select('id, name')
    .eq('tenant_id', profile.tenant_id).order('name');
  const sel = root.querySelector('#inv-store');
  if (!sel) return;
  // siteLbl: loadStores는 내부 함수라 root에 저장된 값 사용
  const siteLbl = root._siteLbl || '현장';
  sel.innerHTML = `<option value="">${siteLbl} 미지정</option>`;
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
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">대기 중인 초대 없음</td></tr>';
    return;
  }
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
  // 전체 매장 목록 (select 드롭다운용)
  const { data: allStores } = await supabase
    .from('stores').select('id, name')
    .eq('tenant_id', profile.tenant_id).order('name');
  const stores = allStores || [];

  // wage_type / deduction_type 컬럼이 없는 구 DB 대비 fallback
  let { data, error } = await supabase
    .from('profiles')
    .select('id, name, phone, hourly_wage, wage_type, deduction_type, position, active, store_id, role, birth_date, gender, hire_date, bank_name, bank_account, store:stores(name)')
    .eq('tenant_id', profile.tenant_id)
    .in('role', ['employee', 'manager'])
    .order('name');

  if (error && /wage_type|deduction_type/i.test(error.message)) {
    toast('⚠️ DB 컬럼이 부족합니다. supabase/migrations/0005_wage_type.sql 을 Supabase SQL Editor에서 실행해주세요.', 'warn', 8000);
    const fb = await supabase
      .from('profiles')
      .select('id, name, phone, hourly_wage, position, active, store_id, store:stores(name)')
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'employee')
      .order('name');
    data = fb.data; error = fb.error;
  }

  const tbody = root.querySelector('#emp-rows');
  if (!tbody) return;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">에러: ${error.message}</td></tr>`;
    return;
  }
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">아직 등록된 직원이 없습니다</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(r => {
    const wt  = r.wage_type || 'hourly';
    const amt = r.hourly_wage || 0;
    const meta = WAGE_META[wt] || WAGE_META.hourly;
    const warnHtml = amt > 0 && amt < meta.min && wt !== 'monthly'
      ? `<span class="wage-warn" title="최저임금 미만 (${meta.min.toLocaleString()}${meta.unit})">⚠️</span>`
      : '';
    const ded = r.deduction_type || 'insurance';

    const storeOptions = stores.map(s =>
      `<option value="${s.id}" ${r.store_id === s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    return `
    <tr data-id="${r.id}">
      <td><strong>${r.name}</strong></td>
      <td>${r.phone || '-'}</td>
      <td>
        <select class="cell-edit" data-field="store_id" style="width:120px;font-size:12px">
          <option value="" ${!r.store_id ? 'selected' : ''}>${root._siteLbl || '현장'} 미지정</option>
          ${storeOptions}
        </select>
      </td>
      <td>
        <select class="cell-edit" data-field="wage_type" style="width:72px;font-size:12px">
          <option value="hourly"  ${wt === 'hourly'  ? 'selected' : ''}>시급</option>
          <option value="daily"   ${wt === 'daily'   ? 'selected' : ''}>일급</option>
          <option value="monthly" ${wt === 'monthly' ? 'selected' : ''}>월급</option>
        </select>
      </td>
      <td>
        <div class="wage-wrap" style="display:flex;align-items:center;gap:4px">
          <input type="number" class="cell-edit" data-field="hourly_wage"
            value="${amt}" min="0" style="width:96px">
          <span class="wage-unit" style="font-size:11px;color:#8a94a6;white-space:nowrap">${meta.unit}</span>
          ${warnHtml}
        </div>
      </td>
      <td><input type="text" class="cell-edit" data-field="position"
        value="${r.position || ''}" style="width:80px"></td>
      <td>
        <select class="cell-edit" data-field="deduction_type" style="width:118px;font-size:12px">
          <option value="insurance"  ${ded === 'insurance'  ? 'selected' : ''}>4대보험 (~9.4%)</option>
          <option value="freelancer" ${ded === 'freelancer' ? 'selected' : ''}>프리랜서 3.3%</option>
          <option value="none"       ${ded === 'none'       ? 'selected' : ''}>공제 없음</option>
        </select>
      </td>
      <td>
        <label class="switch">
          <input type="checkbox" class="cell-edit" data-field="active" ${r.active ? 'checked' : ''}>
          <span></span>
        </label>
      </td>
      <td>
        ${r.role === 'manager'
          ? `<span style="font-size:11px;font-weight:700;color:#d97706;background:#fef3c7;padding:3px 8px;border-radius:12px">매니저</span>`
          : ''}
        <button class="btn small ghost" data-role-toggle="${r.id}" data-current-role="${r.role}" style="font-size:11px;margin-top:4px">
          ${r.role === 'manager' ? '권한 해제' : '매니저 지정'}
        </button>
      </td>
      <td>
        <button class="btn small primary" data-save="${r.id}">저장</button>
        <button class="btn small ghost" data-detail="${r.id}" style="margin-top:4px;font-size:11px">상세정보</button>
      </td>
    </tr>`;
  }).join('');

  // wage_type 변경 시 unit 라벨 + 최저임금 경고 즉시 갱신
  tbody.querySelectorAll('[data-field="wage_type"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const tr    = sel.closest('tr');
      const amtEl = tr.querySelector('[data-field="hourly_wage"]');
      const unitEl = tr.querySelector('.wage-unit');
      const wt     = sel.value;
      const meta   = WAGE_META[wt] || WAGE_META.hourly;
      unitEl.textContent = meta.unit;
      updateWageWarn(tr, +amtEl.value, wt);
    });
  });

  // 금액 입력 시 실시간 최저임금 경고
  tbody.querySelectorAll('[data-field="hourly_wage"]').forEach(input => {
    input.addEventListener('input', () => {
      const tr = input.closest('tr');
      const wt = tr.querySelector('[data-field="wage_type"]').value;
      updateWageWarn(tr, +input.value, wt);
    });
  });

  // 저장
  tbody.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const updates = {};
      tr.querySelectorAll('.cell-edit').forEach(el => {
        const f = el.dataset.field;
        if (el.type === 'checkbox') updates[f] = el.checked;
        else if (el.type === 'number') updates[f] = +el.value;
        else if (f === 'store_id') updates[f] = el.value || null;  // 빈 문자열 → null
        else updates[f] = el.value;
      });
      // 최저임금 미만 경고 확인 (월급은 제외)
      const meta = WAGE_META[updates.wage_type] || WAGE_META.hourly;
      if (updates.wage_type !== 'monthly' && updates.hourly_wage > 0 && updates.hourly_wage < meta.min) {
        const label = meta.label;
        if (!confirm(
          `${label} ${Number(updates.hourly_wage).toLocaleString()}원은 최저${label}(${meta.min.toLocaleString()}원)보다 낮습니다.\n그래도 저장할까요?`
        )) return;
      }
      btn.disabled = true;
      const { error } = await supabase.from('profiles').update(updates).eq('id', btn.dataset.save);
      btn.disabled = false;
      if (error) toast(error.message, 'error');
      else toast('저장됨', 'success');
    });
  });

  // 상세정보 모달 (생년월일·성별·입사일·계좌)
  tbody.querySelectorAll('[data-detail]').forEach(btn => {
    const empId = btn.dataset.detail;
    const emp = data.find(d => d.id === empId);
    if (!emp) return;
    btn.addEventListener('click', () => openDetailModal(emp));
  });

  // 매니저 지정 / 해제
  tbody.querySelectorAll('[data-role-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const empId = btn.dataset.roleToggle;
      const cur   = btn.dataset.currentRole;
      const next  = cur === 'manager' ? 'employee' : 'manager';
      const label = next === 'manager' ? '매니저로 지정' : '일반 직원으로 변경';
      if (!confirm(`${label}하시겠습니까?\n매니저는 출퇴근·직원·연차 관리 권한을 갖습니다.`)) return;
      btn.disabled = true;
      const { error } = await supabase.from('profiles').update({ role: next }).eq('id', empId);
      btn.disabled = false;
      if (error) { toast(error.message, 'error'); return; }
      toast(next === 'manager' ? '매니저로 지정됐습니다' : '일반 직원으로 변경됐습니다', 'success');
      await loadEmployees(root, profile);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// ★ 초대 코드 공유 카드 — 링크 클릭 시 코드 자동 입력
// ─────────────────────────────────────────────────────────────
function showInviteShareCard(root, { code, phone, name }) {
  // 로그인 페이지 URL 동적 생성 (배포 환경 대응)
  const base = location.origin + location.pathname.replace(/dashboard\.html.*$/, '') + 'login.html';
  const shareUrl  = `${base}?code=${code}&phone=${encodeURIComponent(phone.replace(/[^0-9]/g, ''))}`;
  const shareText = `[SCAN&GO] 출퇴근 앱 가입 초대 🎉\n\n아래 링크를 눌러 가입해주세요 👇\n${shareUrl}\n\n📌 가입코드: ${code}\n⏰ 7일 이내 사용 가능`;

  // 카드를 폼 바로 아래에 삽입 (이미 있으면 재사용)
  let card = root.querySelector('#invite-share-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'invite-share-card';
    root.querySelector('#form-invite').insertAdjacentElement('afterend', card);
  }
  card.style.cssText = `
    padding:16px 20px 20px;
    background:linear-gradient(135deg,rgba(0,201,167,.07),rgba(184,147,90,.05));
    border-top:2px solid rgba(0,201,167,.25);
    animation:fadeInDown .3s ease;
  `;
  card.innerHTML = `
    <div style="font-size:12px;color:#059669;font-weight:700;margin-bottom:10px">
      ✅ ${name ? `${name}(${phone})` : phone} 가입 코드 발급 완료
    </div>
    <div style="display:flex;align-items:center;gap:12px;background:#fff;
         border:1px solid rgba(0,201,167,.3);border-radius:10px;padding:12px 16px;margin-bottom:12px">
      <span style="font-size:30px;font-weight:900;letter-spacing:8px;
           color:#0f2942;font-family:'Courier New',monospace">${code}</span>
      <span style="font-size:11px;color:#8a94a6">가입코드</span>
    </div>
    <p style="font-size:12px;color:#64748b;margin:0 0 10px;line-height:1.6">
      아래 버튼으로 직원에게 링크를 보내세요.<br>
      <b>링크를 누르면 코드가 자동 입력</b>되어 바로 가입할 수 있습니다.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button id="btn-invite-copy" class="btn small primary" style="flex:1;min-width:120px">🔗 링크 복사</button>
      ${navigator.share ? `<button id="btn-invite-share" class="btn small" style="flex:1;min-width:120px">📤 카카오·문자 공유</button>` : ''}
    </div>
  `;

  // 링크 복사
  card.querySelector('#btn-invite-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareUrl); }
    catch {
      const el = document.createElement('textarea');
      el.value = shareUrl;
      el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(el); el.select(); document.execCommand('copy'); el.remove();
    }
    import('../../../lib/toast.js').then(({ toast }) =>
      toast('링크 복사됨! 직원에게 카카오·문자로 붙여넣기 해주세요 📋', 'success', 4000)
    );
  });

  // 네이티브 공유 (카카오톡·문자·기타)
  if (navigator.share) {
    card.querySelector('#btn-invite-share')?.addEventListener('click', () => {
      navigator.share({ title: 'SCAN&GO 가입 초대', text: shareText }).catch(() => {});
    });
  }
}

function openDetailModal(emp) {
  document.querySelectorAll('.emp-detail-modal').forEach(m => m.remove());

  const fmt = (v) => v ? v.slice(0, 10) : '';
  const modal = document.createElement('div');
  modal.className = 'pay-modal emp-detail-modal';
  modal.innerHTML = `
    <div class="pay-modal-backdrop"></div>
    <div class="pay-modal-box" style="max-width:420px">
      <div class="pay-modal-head">
        <h2>${emp.name}님 상세정보</h2>
        <button class="pay-modal-close">✕</button>
      </div>
      <div class="pay-modal-body" style="padding:20px">
        <div style="display:grid;gap:14px">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555">
            생년월일
            <input type="date" id="d-birth" value="${fmt(emp.birth_date)}" style="padding:8px;border:1px solid #dde3ed;border-radius:6px;font-size:14px">
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555">
            성별
            <select id="d-gender" style="padding:8px;border:1px solid #dde3ed;border-radius:6px;font-size:14px">
              <option value="" ${!emp.gender ? 'selected' : ''}>선택 안 함</option>
              <option value="남" ${emp.gender === '남' ? 'selected' : ''}>남</option>
              <option value="여" ${emp.gender === '여' ? 'selected' : ''}>여</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555">
            입사일
            <input type="date" id="d-hire" value="${fmt(emp.hire_date)}" style="padding:8px;border:1px solid #dde3ed;border-radius:6px;font-size:14px">
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555">
            은행명
            <input type="text" id="d-bank" value="${emp.bank_name || ''}" placeholder="국민은행" style="padding:8px;border:1px solid #dde3ed;border-radius:6px;font-size:14px">
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555">
            계좌번호
            <input type="text" id="d-acct" value="${emp.bank_account || ''}" placeholder="123-456-789012" style="padding:8px;border:1px solid #dde3ed;border-radius:6px;font-size:14px">
          </label>
          <button class="btn primary" id="d-save" style="margin-top:6px">저장</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.pay-modal-backdrop').addEventListener('click', () => modal.remove());
  modal.querySelector('.pay-modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#d-save').addEventListener('click', async () => {
    const updates = {
      birth_date:   modal.querySelector('#d-birth').value || null,
      gender:       modal.querySelector('#d-gender').value || null,
      hire_date:    modal.querySelector('#d-hire').value || null,
      bank_name:    modal.querySelector('#d-bank').value.trim() || null,
      bank_account: modal.querySelector('#d-acct').value.trim() || null,
    };
    const btn = modal.querySelector('#d-save');
    btn.disabled = true;
    const { error } = await supabase.from('profiles').update(updates).eq('id', emp.id);
    btn.disabled = false;
    if (error) { toast(error.message, 'error'); return; }
    Object.assign(emp, updates);
    toast('상세정보 저장됨', 'success');
    modal.remove();
  });
}

// ═══════════════════════════════════════════════════════════
//  엑셀 일괄 등록
// ═══════════════════════════════════════════════════════════
function downloadTemplate() {
  const headers = ['이름*', '전화번호*', '급여방식(hourly/daily/monthly)*', '금액(원)*', '공제유형(insurance/freelancer/none)', '직책', '생년월일(YYYY-MM-DD)', '성별(남/여)', '입사일(YYYY-MM-DD)', '은행명', '계좌번호'];
  const sample  = ['홍길동', '010-1234-5678', 'hourly', '10320', 'insurance', '현장반장', '1990-01-15', '남', '2024-03-01', '국민은행', '123-456-789012'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, ws, '직원등록양식');
  XLSX.writeFile(wb, 'SCANDGO_직원등록양식.xlsx');
  toast('템플릿 다운로드 완료', 'success');
}

async function handleImportFile(file, root, profile) {
  try {
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 2) { toast('데이터 행이 없습니다', 'warn'); return; }

    // 헤더 행 skip
    const dataRows = rows.slice(1).filter(r => r[0]?.toString().trim());

    // 미리보기 렌더링
    const preview = root.querySelector('#import-preview');
    preview.style.display = '';
    preview.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:#0F2942;margin-bottom:10px">
        📋 ${dataRows.length}명 등록 예정 — 확인 후 [등록하기]를 누르세요
      </div>
      <div style="overflow-x:auto;margin-bottom:12px">
        <table class="att-table" style="min-width:600px">
          <thead><tr><th>#</th><th>이름</th><th>전화번호</th><th>급여방식</th><th>금액</th><th>공제</th><th>입사일</th><th>상태</th></tr></thead>
          <tbody>
            ${dataRows.map((r, i) => {
              const name    = r[0]?.toString().trim();
              const phone   = r[1]?.toString().trim();
              const wtype   = r[2]?.toString().trim() || 'hourly';
              const amount  = Number(r[3]) || 0;
              const err     = !name ? '이름 없음' : !phone ? '전화번호 없음' : amount <= 0 ? '금액 오류' : '';
              return `<tr>
                <td>${i+1}</td>
                <td><strong>${name || '?'}</strong></td>
                <td>${phone || '-'}</td>
                <td>${wtype}</td>
                <td>${amount.toLocaleString()}원</td>
                <td>${r[4]?.toString().trim() || 'insurance'}</td>
                <td>${r[8]?.toString().trim() || '-'}</td>
                <td>${err ? `<span style="color:#dc2626;font-size:11px;font-weight:700">${err}</span>` : '<span style="color:#059669;font-size:11px">✓</span>'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="btn-confirm-import">✅ ${dataRows.length}명 등록하기</button>
        <button class="btn" id="btn-cancel-import">취소</button>
      </div>
    `;
    preview.querySelector('#btn-cancel-import').addEventListener('click', () => {
      preview.style.display = 'none';
    });
    preview.querySelector('#btn-confirm-import').addEventListener('click', async () => {
      const btn = preview.querySelector('#btn-confirm-import');
      btn.disabled = true;
      btn.textContent = '등록 중…';

      let ok = 0, fail = 0;
      for (const r of dataRows) {
        const name  = r[0]?.toString().trim();
        const phone = r[1]?.toString().trim();
        const wtype = r[2]?.toString().trim() || 'hourly';
        const amount = Number(r[3]) || 0;
        if (!name || !phone) { fail++; continue; }

        const payload = {
          tenant_id:      profile.tenant_id,
          role:           'employee',
          name,
          phone,
          wage_type:      ['hourly','daily','monthly'].includes(wtype) ? wtype : 'hourly',
          hourly_wage:    amount,
          deduction_type: ['insurance','freelancer','none'].includes(r[4]?.toString().trim()) ? r[4].toString().trim() : 'insurance',
          position:       r[5]?.toString().trim() || null,
          birth_date:     r[6]?.toString().trim() || null,
          gender:         r[7]?.toString().trim() || null,
          hire_date:      r[8]?.toString().trim() || null,
          bank_name:      r[9]?.toString().trim() || null,
          bank_account:   r[10]?.toString().trim() || null,
          active:         true,
        };

        const { error } = await supabase.from('profiles').insert(payload);
        if (error) { console.warn('import row error', error.message); fail++; }
        else ok++;
      }

      preview.style.display = 'none';
      await loadEmployees(root, profile);
      if (fail > 0) toast(`${ok}명 등록 완료, ${fail}명 실패 (콘솔 확인)`, 'warn');
      else toast(`✅ ${ok}명 일괄 등록 완료!`, 'success');
    });
  } catch (e) {
    toast(`파일 파싱 오류: ${e.message}`, 'error');
  }
}

function updateWageWarn(tr, amt, wt) {
  const wrap = tr.querySelector('.wage-wrap');
  let warn = wrap.querySelector('.wage-warn');
  const meta = WAGE_META[wt] || WAGE_META.hourly;
  if (amt > 0 && amt < meta.min && wt !== 'monthly') {
    if (!warn) {
      warn = document.createElement('span');
      warn.className = 'wage-warn';
      warn.style.cssText = 'color:#f04438;cursor:help;font-size:14px';
      wrap.appendChild(warn);
    }
    warn.textContent = '⚠️';
    warn.title = `최저임금 미만 (${meta.min.toLocaleString()}${meta.unit})`;
  } else {
    warn?.remove();
  }
}
