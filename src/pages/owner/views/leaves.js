import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';

export async function renderLeaves({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>연차 · 휴가 관리</h1>
      <div class="page-sub">직원 휴가 신청 승인 및 내역 관리</div>
    </div>
    <div class="card">
      <div class="card-head">
        <h2>신청 목록</h2>
        <div style="display:flex;gap:8px">
          <select id="lv-filter" style="padding:6px 10px;border:1px solid #e2e7ef;border-radius:6px;font-size:13px;background:#fff">
            <option value="pending">검토중</option>
            <option value="approved">승인됨</option>
            <option value="rejected">반려됨</option>
            <option value="">전체</option>
          </select>
        </div>
      </div>
      <div id="lv-list"><div class="loading">불러오는 중…</div></div>
    </div>
  `;

  await loadLeaves(root, profile);

  root.querySelector('#lv-filter').addEventListener('change', () => loadLeaves(root, profile));
}

async function loadLeaves(root, profile) {
  const status = root.querySelector('#lv-filter').value;
  let q = supabase
    .from('leave_requests')
    .select('*, employee:profiles!leave_requests_employee_id_fkey(name, position)')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  const container = root.querySelector('#lv-list');
  if (!container) return;

  if (error) { container.innerHTML = `<div class="error-box">${error.message}</div>`; return; }
  if (!data?.length) {
    container.innerHTML = '<div class="empty-state" style="padding:32px;text-align:center;color:#8a94a6">신청 내역이 없습니다</div>';
    return;
  }

  const statusLabel = { pending: '검토중', approved: '승인', rejected: '반려' };
  const statusColor = { pending: '#d97706', approved: '#059669', rejected: '#dc2626' };
  const statusBg    = { pending: '#fef3c7', approved: '#d1fae5', rejected: '#fee2e2' };

  container.innerHTML = `
    <div class="table-wrap">
      <table class="att-table">
        <thead>
          <tr>
            <th>직원</th><th>종류</th><th>기간</th><th>일수</th><th>사유</th><th>상태</th><th>액션</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => {
            const dateStr = r.start_date === r.end_date ? r.start_date : `${r.start_date}~${r.end_date}`;
            const isPending = r.status === 'pending';
            return `
              <tr>
                <td>
                  <div style="font-weight:700">${r.employee?.name || '?'}</div>
                  <div style="font-size:11px;color:#8a94a6">${r.employee?.position || ''}</div>
                </td>
                <td style="font-weight:600">${r.leave_type}</td>
                <td style="font-size:12px">${dateStr}</td>
                <td style="text-align:center;font-weight:700">${r.days}일</td>
                <td style="font-size:12px;color:#64748b;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.reason || '—'}</td>
                <td>
                  <span style="padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;background:${statusBg[r.status]};color:${statusColor[r.status]}">
                    ${statusLabel[r.status] || r.status}
                  </span>
                </td>
                <td>
                  ${isPending ? `
                    <div style="display:flex;gap:6px">
                      <button class="btn small primary" data-approve="${r.id}">승인</button>
                      <button class="btn small danger" data-reject="${r.id}">반려</button>
                    </div>` : `<span style="font-size:12px;color:#94a3b8">—</span>`}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', () => handleReview(root, profile, btn.dataset.approve, 'approved'));
  });
  container.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', () => handleReject(root, profile, btn.dataset.reject));
  });
}

async function handleReview(root, profile, id, status, rejectReason = null) {
  const { error } = await supabase.from('leave_requests')
    .update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString(), reject_reason: rejectReason })
    .eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast(status === 'approved' ? '승인 완료' : '반려 완료', 'success');
  await loadLeaves(root, profile);
}

async function handleReject(root, profile, id) {
  const reason = prompt('반려 사유를 입력하세요 (선택사항)');
  if (reason === null) return; // 취소
  await handleReview(root, profile, id, 'rejected', reason || null);
}
