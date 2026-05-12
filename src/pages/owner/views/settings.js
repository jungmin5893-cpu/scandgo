import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';

export async function renderSettings({ root, profile }) {
  const t = profile.tenants || {};
  root.innerHTML = `
    <div class="page-head">
      <h1>설정 / 구독</h1>
      <div class="page-sub">사업장 정보와 구독 상태</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>사업장 정보</h2></div>
      <form id="form-tenant" class="form-grid">
        <label>사업장 이름<input type="text" id="t-name" value="${t.name || ''}"></label>
        <label>업종
          <select id="t-type">
            <option value="office" ${t.business_type === 'office' ? 'selected' : ''}>사무직</option>
            <option value="retail" ${t.business_type === 'retail' ? 'selected' : ''}>매장/요식업</option>
            <option value="field" ${t.business_type === 'field' ? 'selected' : ''}>현장/경비</option>
            <option value="small" ${t.business_type === 'small' ? 'selected' : ''}>소규모/기타</option>
          </select>
        </label>
        <div class="form-actions"><button type="submit" class="btn primary">저장</button></div>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h2>구독</h2></div>
      <div class="sub-info">
        <div class="sub-row"><span>상태</span><strong class="sub-status ${t.subscription_status}">${labelSub(t.subscription_status)}</strong></div>
        <div class="sub-row"><span>요금제</span><strong>${(t.plan || 'TRIAL').toUpperCase()}</strong></div>
        <div class="sub-row"><span>체험 종료</span><strong>${t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('ko-KR') : '-'}</strong></div>
      </div>
      <div class="sub-cta">
        <button class="btn primary" id="btn-subscribe" disabled title="토스페이먼츠 연동은 다음 단계에서 활성화됩니다">월 19,900원 구독하기 (준비 중)</button>
        <div class="muted" style="margin-top:8px">결제 연동은 Edge Function 배포 후 활성화됩니다. <code>supabase/functions/toss-webhook</code> 참고.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>위험 영역</h2></div>
      <button class="btn danger" id="btn-leave">사업장 탈퇴</button>
      <div class="muted" style="margin-top:8px">모든 데이터가 삭제됩니다. 복구 불가.</div>
    </div>
  `;

  root.querySelector('#form-tenant').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {
      name: root.querySelector('#t-name').value.trim(),
      business_type: root.querySelector('#t-type').value,
    };
    const { error } = await supabase.from('tenants').update(updates).eq('id', profile.tenant_id);
    if (error) toast(error.message, 'error');
    else toast('저장됨', 'success');
  });

  root.querySelector('#btn-leave').addEventListener('click', async () => {
    if (!confirm('정말로 사업장을 탈퇴할까요? 모든 데이터가 영구 삭제됩니다.')) return;
    if (!confirm('한 번 더 확인합니다. 정말 삭제할까요?')) return;
    const { error } = await supabase.from('tenants').delete().eq('id', profile.tenant_id);
    if (error) toast(error.message, 'error');
    else { await supabase.auth.signOut(); location.href = 'login.html'; }
  });
}

function labelSub(s) {
  return { trialing: '무료체험중', active: '활성', past_due: '결제실패', canceled: '취소됨' }[s] || s || '-';
}
