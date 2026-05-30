import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import { calcMonthlyFee } from '../../../lib/labels.js';
import { subscribePush, unsubscribePush, isPushSubscribed } from '../../../lib/push.js';

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
          <select id="t-industry">
            <option value="청소·시설관리" ${(t.industry_type || '') === '청소·시설관리' ? 'selected' : ''}>청소·시설관리 업체</option>
            <option value="경비·보안" ${(t.industry_type || '') === '경비·보안' ? 'selected' : ''}>경비·보안 업체</option>
            <option value="인력사무소" ${(t.industry_type || '') === '인력사무소' ? 'selected' : ''}>인력사무소·직업소개소</option>
            <option value="건설도급사" ${(t.industry_type || '') === '건설도급사' ? 'selected' : ''}>건설 전문 도급사</option>
            <option value="기타" ${(t.industry_type || '') === '기타' ? 'selected' : ''}>기타 다현장 운영 회사</option>
          </select>
        </label>
        <label>사업자등록번호<input type="text" id="t-biz-num" value="${t.business_number || ''}" placeholder="000-00-00000"></label>
        <label>대표자명<input type="text" id="t-ceo" value="${t.ceo_name || ''}" placeholder="홍길동"></label>
        <label style="grid-column:1/-1">사업장 주소<input type="text" id="t-address" value="${t.address || ''}" placeholder="서울시 강남구 ..."></label>
        <div class="form-actions"><button type="submit" class="btn primary">저장</button></div>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h2>구독</h2></div>
      <div class="sub-info">
        <div class="sub-row"><span>상태</span><strong class="sub-status ${t.subscription_status}">${labelSub(t.subscription_status)}</strong></div>
        <div class="sub-row"><span>요금제</span><strong>${(t.plan || 'TRIAL').toUpperCase()}</strong></div>
        <div class="sub-row"><span>체험 종료</span><strong>${t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('ko-KR') : '-'}</strong></div>
        <div class="sub-row"><span>등록 직원(최대)</span><strong>${t.peak_employee_count ?? 0}명</strong></div>
        <div class="sub-row"><span>이번 달 예상 요금</span><strong>${calcMonthlyFee(t.peak_employee_count ?? 0).toLocaleString()}원</strong></div>
      </div>
      <div class="sub-pricing-note" style="background:#f4f6f9;border-radius:5px;padding:14px 16px;margin:12px 0;font-size:13px;color:#3d4a5c;line-height:1.7">
        <strong style="display:block;margin-bottom:6px;color:#0F2942">요금 산정 방식</strong>
        직원 1인당 월 5,000원 × 해당 월 최대 등록 직원 수<br>
        <span style="color:#8a94a6;font-size:12px">※ 무료체험 중에는 요금이 발생하지 않습니다. 체험 종료 후 자동 청구됩니다.</span>
      </div>
      <div class="sub-cta">
        <button class="btn primary" id="btn-subscribe" disabled title="토스페이먼츠 연동은 다음 단계에서 활성화됩니다">구독 시작하기 (준비 중)</button>
        <div class="muted" style="margin-top:8px">결제 연동은 곧 활성화됩니다.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>알림 설정</h2></div>
      <div style="padding:14px 18px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text)">직원 출퇴근 푸시 알림</div>
            <div style="font-size:12px;color:var(--gray4);margin-top:3px" id="push-status-label">확인 중…</div>
          </div>
          <button class="btn" id="btn-push-toggle" style="min-width:80px">확인 중</button>
        </div>
      </div>
    </div>

    <div class="card" id="card-invite-link">
      <div class="card-head"><h2>직원 초대 링크</h2><div class="card-sub">링크 공유 시 직원이 자동으로 이 사업장에 연결됩니다</div></div>
      <div style="padding:16px 20px">
        <div style="background:#f4f6f9;border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:12px;color:#3d4a5c;line-height:1.7">
          <strong>사용 방법</strong><br>
          ① 아래 링크를 카카오톡/문자로 직원에게 공유<br>
          ② 직원이 링크 클릭 → 가입 시 <strong>이 사업장 자동 연결</strong><br>
          ③ 직원 관리에서 활성 확인 후 급여·현장 설정
        </div>
        <div id="invite-link-box" style="display:flex;gap:8px;align-items:center;background:#fff;border:1.5px solid var(--gray2);border-radius:8px;padding:10px 14px;margin-bottom:12px">
          <code id="invite-link-url" style="flex:1;font-size:12px;color:#0F2942;word-break:break-all;font-family:monospace">불러오는 중…</code>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary small" id="btn-copy-invite">🔗 링크 복사</button>
          <button class="btn small" id="btn-share-invite" style="${navigator.share ? '' : 'display:none'}">📤 공유하기</button>
          <button class="btn small" id="btn-regen-invite" style="margin-left:auto;color:#dc2626;border-color:#dc2626">🔄 링크 재생성</button>
        </div>
        <div style="margin-top:10px;font-size:11px;color:#8a94a6">
          ※ 재생성 시 기존 링크는 즉시 무효화됩니다
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>사용법 안내</h2></div>
      <div style="padding:14px 18px">
        <div style="font-size:13px;color:var(--gray4);margin-bottom:10px;line-height:1.6">
          처음 가입 시 보셨던 사용법 안내를 다시 보실 수 있습니다.
        </div>
        <button class="btn primary" id="btn-tutorial-restart">🎓 사장님 튜토리얼 다시 보기</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>위험 영역</h2></div>
      <button class="btn danger" id="btn-leave">사업장 탈퇴</button>
      <div class="muted" style="margin-top:8px">모든 데이터가 삭제됩니다. 복구 불가.</div>
    </div>
  `;

  // 푸시 알림 토글
  (async () => {
    const label = root.querySelector('#push-status-label');
    const btn   = root.querySelector('#btn-push-toggle');
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      label.textContent = '이 브라우저는 푸시 알림을 지원하지 않습니다';
      btn.style.display = 'none';
      return;
    }
    if (Notification.permission === 'denied') {
      label.textContent = '브라우저에서 알림이 차단됐습니다. 브라우저 설정에서 직접 허용해주세요.';
      btn.style.display = 'none';
      return;
    }

    async function refreshPushUI() {
      const subscribed = await isPushSubscribed();
      if (subscribed) {
        label.textContent = '활성화됨 — 직원 출퇴근 시 알림을 받습니다';
        label.style.color = '#00c9a7';
        btn.textContent = '알림 끄기';
        btn.className = 'btn';
      } else {
        label.textContent = '비활성화됨';
        label.style.color = '';
        btn.textContent = '알림 켜기';
        btn.className = 'btn primary';
      }
    }

    await refreshPushUI();

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const subscribed = await isPushSubscribed();
      if (subscribed) {
        await unsubscribePush(profile.id);
        localStorage.setItem('push_banner_decided', '1');
        toast('푸시 알림을 껐습니다', 'info');
      } else {
        const perm = Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
        if (perm === 'granted') {
          await subscribePush(profile.id, profile.tenants?.id);
          localStorage.setItem('push_banner_decided', '1');
          toast('푸시 알림을 켰습니다', 'success');
        } else {
          toast('알림 권한이 거부됐습니다. 브라우저 설정을 확인해주세요.', 'error');
          btn.disabled = false;
          return;
        }
      }
      await refreshPushUI();
      btn.disabled = false;
    });
  })();

  root.querySelector('#btn-tutorial-restart').addEventListener('click', async () => {
    try {
      await supabase.from('profiles').update({ tutorial_owner_done: false }).eq('id', profile.id);
      location.href = 'tutorial-owner.html';
    } catch (e) {
      toast('이동 중 오류가 발생했습니다', 'error');
    }
  });

  root.querySelector('#form-tenant').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {
      name: root.querySelector('#t-name').value.trim(),
      industry_type: root.querySelector('#t-industry').value,
      business_number: root.querySelector('#t-biz-num').value.trim() || null,
      ceo_name: root.querySelector('#t-ceo').value.trim() || null,
      address: root.querySelector('#t-address').value.trim() || null,
    };
    const { error } = await supabase.from('tenants').update(updates).eq('id', profile.tenant_id);
    if (error) toast(error.message, 'error');
    else toast('저장됨', 'success');
  });

  // ── 초대 링크 ───────────────────────────────────────────
  (async () => {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('invite_token')
      .eq('id', profile.tenant_id)
      .single();

    const token = tenant?.invite_token;
    const base  = location.origin + location.pathname.replace(/dashboard\.html.*$/, '');
    const link  = token ? `${base}login.html?join=${token}` : '(토큰 없음)';
    const urlEl = root.querySelector('#invite-link-url');
    if (urlEl) urlEl.textContent = link;

    root.querySelector('#btn-copy-invite')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); }
      catch {
        const el = Object.assign(document.createElement('textarea'), { value: link });
        el.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(el);
        el.select(); document.execCommand('copy'); el.remove();
      }
      toast('초대 링크 복사됨! 카카오톡·문자로 보내세요 📋', 'success');
    });

    root.querySelector('#btn-share-invite')?.addEventListener('click', () => {
      navigator.share?.({
        title: `[SCAN&GO] ${profile.tenants?.name || '사업장'} 직원 가입 초대`,
        text: '아래 링크를 눌러 출퇴근 앱에 가입해주세요',
        url: link,
      }).catch(() => {});
    });

    root.querySelector('#btn-regen-invite')?.addEventListener('click', async () => {
      if (!confirm('링크를 재생성하면 기존 링크는 즉시 사용 불가합니다. 계속할까요?')) return;
      const newToken = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
      const { error } = await supabase.from('tenants').update({ invite_token: newToken }).eq('id', profile.tenant_id);
      if (error) { toast(error.message, 'error'); return; }
      const newLink = `${base}login.html?join=${newToken}`;
      if (urlEl) urlEl.textContent = newLink;
      toast('초대 링크가 재생성됐습니다', 'success');
    });
  })();

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
