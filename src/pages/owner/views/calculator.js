import { toast } from '../../../lib/toast.js';

const MIN_HOURLY  = 10320;               // 2026년 최저시급
const MIN_MONTHLY = MIN_HOURLY * 209;    // 2026년 최저월급 (주 40h 기준)

export async function renderCalculator({ root }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>급여 계산기</h1>
      <div class="page-sub">2026년 노무법 기준 · 최저시급 ${MIN_HOURLY.toLocaleString()}원 · 순방향(시급→월급) / 역방향(목표월급→시급)</div>
    </div>

    <!-- 모드 선택 -->
    <div class="card">
      <div style="padding:16px 20px;display:flex;gap:10px">
        <button class="btn primary" id="btn-mode-fwd" style="flex:1;padding:14px;line-height:1.5">
          📐 순방향 계산<br><small style="font-weight:400;opacity:.8">시급 × 근무조건 → 월급</small>
        </button>
        <button class="btn" id="btn-mode-rev" style="flex:1;padding:14px;line-height:1.5">
          🔄 역방향 계산<br><small style="font-weight:400;opacity:.8">목표 실수령액 → 필요 시급</small>
        </button>
      </div>
    </div>

    <!-- ── 순방향 ── -->
    <div id="calc-fwd" class="card">
      <div class="card-head"><h2>순방향 계산</h2><div class="card-sub">근무 조건 입력 → 월 급여 자동 산출</div></div>
      <div class="form-grid" style="padding:18px 20px">
        <label>급여 방식
          <select id="fwd-type">
            <option value="hourly">시급제</option>
            <option value="daily">일급제</option>
            <option value="monthly">월급제</option>
          </select>
        </label>
        <label>금액 (원)
          <input type="number" id="fwd-amount" placeholder="${MIN_HOURLY}" min="0" step="10">
        </label>
        <label id="lbl-fwd-days">주 근무일수
          <select id="fwd-days">
            <option value="5">주 5일</option>
            <option value="6">주 6일</option>
            <option value="4">주 4일</option>
            <option value="3">주 3일</option>
            <option value="2">주 2일</option>
          </select>
        </label>
        <label id="lbl-fwd-hours">1일 근무시간
          <input type="number" id="fwd-hours" value="8" min="1" max="12" step="0.5">
        </label>
        <label>공제 유형
          <select id="fwd-ded">
            <option value="insurance">4대보험 (근로자 부담분)</option>
            <option value="freelancer">프리랜서 3.3%</option>
            <option value="none">공제 없음</option>
          </select>
        </label>
        <div style="display:flex;align-items:flex-end">
          <button class="btn primary" id="btn-calc-fwd" style="width:100%">계산하기</button>
        </div>
      </div>
      <div id="fwd-result" style="padding:0 20px 20px;display:none"></div>
    </div>

    <!-- ── 역방향 ── -->
    <div id="calc-rev" class="card" style="display:none">
      <div class="card-head"><h2>역방향 계산</h2><div class="card-sub">직원에게 줄 실수령액 → 세전 급여 · 시급 역산</div></div>
      <div class="form-grid" style="padding:18px 20px">
        <label>목표 실수령액 (원)
          <input type="number" id="rev-net" placeholder="2500000" min="0" step="10000">
        </label>
        <label>공제 유형
          <select id="rev-ded">
            <option value="insurance">4대보험 (근로자 부담분)</option>
            <option value="freelancer">프리랜서 3.3%</option>
            <option value="none">공제 없음</option>
          </select>
        </label>
        <label>주 근무일수
          <select id="rev-days">
            <option value="5">주 5일</option>
            <option value="6">주 6일</option>
            <option value="4">주 4일</option>
            <option value="3">주 3일</option>
            <option value="2">주 2일</option>
          </select>
        </label>
        <label>1일 근무시간
          <input type="number" id="rev-hours" value="8" min="1" max="12" step="0.5">
        </label>
        <div style="display:flex;align-items:flex-end">
          <button class="btn primary" id="btn-calc-rev" style="width:100%">역산하기</button>
        </div>
      </div>
      <div id="rev-result" style="padding:0 20px 20px;display:none"></div>
    </div>

    <!-- ── 노무 가이드 ── -->
    <div class="card">
      <div class="card-head"><h2>💡 2026년 노무 계산 가이드</h2></div>
      <div style="padding:16px 20px;font-size:13px;color:#3d4a5c;line-height:2">
        <strong style="color:#0F2942">최저시급</strong> 10,320원 (2026년) · 최저월급 2,156,880원 (주 40h · 209시간 기준)<br>
        <strong style="color:#0F2942">주휴수당</strong> 주 15시간 이상 + 소정근로일 개근 → 1일치 유급 (주 소정h÷40×8시간×시급)<br>
        <strong style="color:#0F2942">월 소정근로시간</strong> 주 40h 기준 209h = (40+8)h × 4.345주 (주휴 포함)<br>
        <strong style="color:#0F2942">4대보험 근로자 부담</strong> 국민연금 4.5% · 건강보험 3.545% · 장기요양 건보료×12.95% · 고용보험 0.9%<br>
        <strong style="color:#0F2942">사업주 추가 부담</strong> 국민연금 4.5% · 건강보험 3.545% · 장기요양 동일 · 고용보험 0.9~1.05% · 산재보험 별도<br>
        <strong style="color:#0F2942">퇴직금 발생</strong> 계속근로 1년 이상 + 주평균 15h 이상 → 평균임금 × 30일 × 근속연수<br>
        <small style="color:#8a94a6">※ 5인 이상 사업장: 연장·야간·휴일근로 1.5배 가산 의무 · 10인 이상: 취업규칙 신고 의무</small>
      </div>
    </div>
  `;

  // ── 모드 토글 ──
  const fwdBtn = root.querySelector('#btn-mode-fwd');
  const revBtn = root.querySelector('#btn-mode-rev');
  const fwdSection = root.querySelector('#calc-fwd');
  const revSection = root.querySelector('#calc-rev');

  fwdBtn.addEventListener('click', () => {
    fwdSection.style.display = '';  revSection.style.display = 'none';
    fwdBtn.className = 'btn primary'; revBtn.className = 'btn';
    fwdBtn.style.cssText = 'flex:1;padding:14px;line-height:1.5';
    revBtn.style.cssText = 'flex:1;padding:14px;line-height:1.5';
  });
  revBtn.addEventListener('click', () => {
    fwdSection.style.display = 'none'; revSection.style.display = '';
    fwdBtn.className = 'btn'; revBtn.className = 'btn primary';
    fwdBtn.style.cssText = 'flex:1;padding:14px;line-height:1.5';
    revBtn.style.cssText = 'flex:1;padding:14px;line-height:1.5';
  });

  // 급여 방식에 따라 근무일/시간 입력 표시
  root.querySelector('#fwd-type').addEventListener('change', e => {
    const isMonthly = e.target.value === 'monthly';
    root.querySelector('#lbl-fwd-days').style.opacity = isMonthly ? '.4' : '1';
    root.querySelector('#lbl-fwd-hours').style.opacity = isMonthly ? '.4' : '1';
  });

  // ── 순방향 계산 ──
  root.querySelector('#btn-calc-fwd').addEventListener('click', () => {
    const type      = root.querySelector('#fwd-type').value;
    const amount    = Number(root.querySelector('#fwd-amount').value);
    const days      = Number(root.querySelector('#fwd-days').value);
    const hpd       = Number(root.querySelector('#fwd-hours').value); // hours per day
    const dedType   = root.querySelector('#fwd-ded').value;

    if (!amount) { toast('금액을 입력해주세요', 'warn'); return; }

    let grossPay = 0, detailHtml = '';

    if (type === 'hourly') {
      const weeklyHours = days * hpd;
      // 주휴수당 시간 (주 15h 이상)
      const weeklyHolidayHours = weeklyHours >= 15 ? (weeklyHours / 40) * 8 : 0;
      // 월 근무시간 (4.345주/월)
      const monthlyWorkHours = Math.round(weeklyHours * 4.345);
      const monthlyHolidayHours = Math.round(weeklyHolidayHours * 4.345);
      const basePayMonth = Math.round(amount * monthlyWorkHours / 10) * 10;
      const holidayPayMonth = Math.round(amount * weeklyHolidayHours * 4.345 / 10) * 10;
      grossPay = basePayMonth + holidayPayMonth;

      const minWarn = amount < MIN_HOURLY
        ? `<div style="background:#fee2e2;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:13px;color:#dc2626;font-weight:700">⚠️ 최저시급(${MIN_HOURLY.toLocaleString()}원) 미만 — 노무 리스크 발생!</div>`
        : `<div style="background:#d1fae5;border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:12px;color:#059669;font-weight:600">✓ 최저시급 기준 충족</div>`;
      detailHtml = `${minWarn}
        <div style="background:#f4f6f9;border-radius:8px;padding:12px 14px;margin-bottom:10px;font-size:13px;line-height:1.9">
          <strong style="color:#0F2942">근무 조건 분석</strong><br>
          주 ${days}일 × ${hpd}h = 주 ${weeklyHours}h · 월 근무 약 ${monthlyWorkHours}h<br>
          기본급: ${basePayMonth.toLocaleString()}원
          ${holidayPayMonth > 0 ? `<br>주휴수당: ${holidayPayMonth.toLocaleString()}원 <small style="color:#8a94a6">(주 ${weeklyHolidayHours.toFixed(1)}h × 4.345주)</small>` : '<br><span style="color:#f59e0b;font-size:12px">⚠️ 주 15h 미만 — 주휴수당 미발생</span>'}
        </div>`;
    } else if (type === 'daily') {
      const weeklyHours = days * 8;
      const monthlyDays = Math.round(days * 4.345);
      const basePayMonth = amount * monthlyDays;
      const holidayPayMonth = weeklyHours >= 15 ? Math.round(amount * 4.345 / 10) * 10 : 0;
      grossPay = basePayMonth + holidayPayMonth;
      detailHtml = `
        <div style="background:#f4f6f9;border-radius:8px;padding:12px 14px;margin-bottom:10px;font-size:13px;line-height:1.9">
          월 근무일수: 약 ${monthlyDays}일 · 기본급: ${basePayMonth.toLocaleString()}원
          ${holidayPayMonth > 0 ? `<br>주휴수당: ${holidayPayMonth.toLocaleString()}원` : ''}
        </div>`;
    } else { // monthly
      grossPay = amount;
      const minWarn = amount < MIN_MONTHLY
        ? `<div style="background:#fee2e2;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:13px;color:#dc2626;font-weight:700">⚠️ 최저월급(${MIN_MONTHLY.toLocaleString()}원) 미만!</div>`
        : `<div style="background:#d1fae5;border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:12px;color:#059669;font-weight:600">✓ 최저월급 기준 충족</div>`;
      detailHtml = minWarn;
    }

    const ded = calcDed(dedType, grossPay);
    const netPay = grossPay - ded.total;
    const empBurden = dedType === 'insurance' ? calcEmployerBurden(grossPay) : 0;
    const totalCost = grossPay + empBurden;

    const resultEl = root.querySelector('#fwd-result');
    resultEl.style.display = '';
    resultEl.innerHTML = `
      <div style="border-top:1px solid #e2e7ef;padding-top:18px">
        ${detailHtml}
        ${renderDedBreakdown(dedType, ded)}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px">
          ${kpiBox('세전 급여', grossPay, '#e0faf6', '#007a62')}
          ${kpiBox('실수령액', netPay, '#f0f7ff', '#1565c0', true)}
          ${kpiBox('사업주 총 인건비', totalCost, '#fff3e0', '#e65100', false, empBurden > 0 ? `사업주 4대보험: ${empBurden.toLocaleString()}원` : '')}
        </div>
      </div>`;
  });

  // ── 역방향 계산 ──
  root.querySelector('#btn-calc-rev').addEventListener('click', () => {
    const netTarget = Number(root.querySelector('#rev-net').value);
    const dedType   = root.querySelector('#rev-ded').value;
    const days      = Number(root.querySelector('#rev-days').value);
    const hpd       = Number(root.querySelector('#rev-hours').value);

    if (!netTarget) { toast('목표 실수령액을 입력해주세요', 'warn'); return; }

    // 역산: net = gross × (1 - dedRate)
    let grossPay = 0;
    if (dedType === 'insurance') {
      // np=4.5%, hi=3.545%, lc=hi×12.95%, ei=0.9% → 합계 ≈ 9.395%
      const approxRate = 0.045 + 0.03545 + 0.03545 * 0.1295 + 0.009;
      grossPay = Math.round(netTarget / (1 - approxRate) / 10) * 10;
    } else if (dedType === 'freelancer') {
      grossPay = Math.round(netTarget / (1 - 0.033) / 10) * 10;
    } else {
      grossPay = Math.round(netTarget / 10) * 10;
    }

    const ded = calcDed(dedType, grossPay);
    const actualNet = grossPay - ded.total;

    // 시급 역산 (주휴 포함 월 근무시간 기준)
    const weeklyHours = days * hpd;
    const weeklyHolidayHours = weeklyHours >= 15 ? (weeklyHours / 40) * 8 : 0;
    const monthlyTotalHours = Math.round((weeklyHours + weeklyHolidayHours) * 4.345);
    const hourlyRate = monthlyTotalHours > 0 ? Math.round(grossPay / monthlyTotalHours / 10) * 10 : 0;

    const empBurden = dedType === 'insurance' ? calcEmployerBurden(grossPay) : 0;
    const totalCost = grossPay + empBurden;

    const minWarn = hourlyRate > 0 && hourlyRate < MIN_HOURLY
      ? `<div style="background:#fee2e2;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:13px;color:#dc2626;font-weight:700">⚠️ 역산 시급 ${hourlyRate.toLocaleString()}원 — 최저시급(${MIN_HOURLY.toLocaleString()}원) 미만! 실수령액 목표를 높여야 합니다.</div>`
      : hourlyRate > 0 ? `<div style="background:#d1fae5;border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:12px;color:#059669;font-weight:600">✓ 최저시급 기준 충족 (역산 시급 ${hourlyRate.toLocaleString()}원)</div>` : '';

    const resultEl = root.querySelector('#rev-result');
    resultEl.style.display = '';
    resultEl.innerHTML = `
      <div style="border-top:1px solid #e2e7ef;padding-top:18px">
        ${minWarn}
        <div style="background:#f4f6f9;border-radius:8px;padding:12px 14px;margin-bottom:10px;font-size:13px;line-height:1.9">
          <strong style="color:#0F2942">역산 조건</strong>: 주 ${days}일 × ${hpd}h = 월 약 ${monthlyTotalHours}h (주휴 포함)
        </div>
        ${renderDedBreakdown(dedType, ded)}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px">
          ${kpiBox('역산 시급', hourlyRate, '#f5f0ff', '#7c3aed', false, '주휴 포함 월 시간 기준')}
          ${kpiBox('세전 급여', grossPay, '#e0faf6', '#007a62')}
          ${kpiBox('사업주 총 인건비', totalCost, '#fff3e0', '#e65100', false, empBurden > 0 ? `사업주 4대보험: ${empBurden.toLocaleString()}원` : '')}
        </div>
        <div style="background:#f0f7ff;border-radius:10px;padding:16px;text-align:center;margin-top:10px;border:2px solid #1565c0">
          <div style="font-size:11px;color:#1565c0;font-weight:700;margin-bottom:4px">실제 실수령액 (10원 단위 반올림 반영)</div>
          <div style="font-size:20px;font-weight:900;color:#1565c0">${actualNet.toLocaleString()}원
            <span style="font-size:13px;color:#8a94a6;font-weight:400"> (목표: ${netTarget.toLocaleString()}원, 차이: ${(actualNet - netTarget).toLocaleString()}원)</span>
          </div>
        </div>
      </div>`;
  });
}

// ── 공제 계산 ──────────────────────────────────────────────
function calcDed(type, gross) {
  if (type === 'insurance') {
    const np = Math.round(gross * 0.045   / 10) * 10;
    const hi = Math.round(gross * 0.03545 / 10) * 10;
    const lc = Math.round(hi   * 0.1295  / 10) * 10;
    const ei = Math.round(gross * 0.009   / 10) * 10;
    return { np, hi, lc, ei, it: 0, lo: 0, total: np + hi + lc + ei };
  }
  if (type === 'freelancer') {
    const it = Math.round(gross * 0.03 / 10) * 10;
    const lo = Math.round(it   * 0.1  / 10) * 10;
    return { np: 0, hi: 0, lc: 0, ei: 0, it, lo, total: it + lo };
  }
  return { np: 0, hi: 0, lc: 0, ei: 0, it: 0, lo: 0, total: 0 };
}

function calcEmployerBurden(gross) {
  const np = Math.round(gross * 0.045   / 10) * 10;
  const hi = Math.round(gross * 0.03545 / 10) * 10;
  const lc = Math.round(hi   * 0.1295  / 10) * 10;
  const ei = Math.round(gross * 0.009   / 10) * 10;
  return np + hi + lc + ei; // 산재보험 제외 (업종별 상이)
}

function renderDedBreakdown(type, ded) {
  if (type === 'none') return '';
  if (type === 'insurance') {
    return `
      <div style="background:#f4f6f9;border-radius:8px;padding:12px 14px;font-size:13px">
        <div style="font-weight:700;color:#0F2942;margin-bottom:8px">공제 내역 (4대보험 근로자 부담)</div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:3px 8px;color:#3d4a5c">
          <span>국민연금 (4.5%)</span><span style="text-align:right;font-weight:600">${ded.np.toLocaleString()}원</span>
          <span>건강보험 (3.545%)</span><span style="text-align:right;font-weight:600">${ded.hi.toLocaleString()}원</span>
          <span>장기요양 (건보×12.95%)</span><span style="text-align:right;font-weight:600">${ded.lc.toLocaleString()}원</span>
          <span>고용보험 (0.9%)</span><span style="text-align:right;font-weight:600">${ded.ei.toLocaleString()}원</span>
          <span style="font-weight:700;border-top:1px solid #e2e7ef;padding-top:4px;margin-top:2px">합계</span>
          <span style="text-align:right;font-weight:800;border-top:1px solid #e2e7ef;padding-top:4px;margin-top:2px">${ded.total.toLocaleString()}원</span>
        </div>
      </div>`;
  }
  return `
    <div style="background:#f4f6f9;border-radius:8px;padding:12px 14px;font-size:13px">
      <div style="font-weight:700;color:#0F2942;margin-bottom:8px">공제 내역 (프리랜서 3.3%)</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:3px 8px;color:#3d4a5c">
        <span>소득세 (3%)</span><span style="text-align:right;font-weight:600">${ded.it.toLocaleString()}원</span>
        <span>지방소득세 (소득세×10%)</span><span style="text-align:right;font-weight:600">${ded.lo.toLocaleString()}원</span>
        <span style="font-weight:700;border-top:1px solid #e2e7ef;padding-top:4px;margin-top:2px">합계</span>
        <span style="text-align:right;font-weight:800;border-top:1px solid #e2e7ef;padding-top:4px;margin-top:2px">${ded.total.toLocaleString()}원</span>
      </div>
    </div>`;
}

function kpiBox(label, value, bg, color, highlight = false, sub = '') {
  return `
    <div style="background:${bg};border-radius:10px;padding:16px;text-align:center;${highlight ? `border:2px solid ${color}` : ''}">
      <div style="font-size:11px;color:${color};font-weight:700;margin-bottom:6px">${label}</div>
      <div style="font-size:${value > 9999999 ? '16px' : '20px'};font-weight:900;color:${color}">${value.toLocaleString()}원</div>
      ${sub ? `<div style="font-size:10px;color:${color};opacity:.65;margin-top:3px">${sub}</div>` : ''}
    </div>`;
}
