import { supabase } from '../../lib/supabase.js';
import { requireRole, signOut } from '../../lib/auth.js';
import { toast } from '../../lib/toast.js';
import { renderOverview } from './views/overview.js';
import { renderAttendance } from './views/attendance.js';
import { renderEmployees } from './views/employees.js';
import { renderStores } from './views/stores.js';
import { renderShifts } from './views/shifts.js';
import { renderPayroll } from './views/payroll.js';
import { renderSettings } from './views/settings.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let profile = null;
let currentRoute = '';
let isNavigating = false;

const ROUTES = {
  overview: renderOverview,
  attendance: renderAttendance,
  employees: renderEmployees,
  stores: renderStores,
  shifts: renderShifts,
  payroll: renderPayroll,
  settings: renderSettings,
};

init();

async function init() {
  profile = await requireRole('owner');
  if (!profile) return;

  $('#biz-name').textContent = profile.tenants?.name || '사업장';
  $('#owner-name').textContent = profile.name;

  showTrialBadge(profile.tenants);
  bindNav();

  const initial = location.hash.replace('#/', '') || 'overview';
  navigate(initial);
}

function showTrialBadge(t) {
  if (!t) return;
  if (t.subscription_status === 'trialing') {
    const remain = Math.max(0, Math.ceil((new Date(t.trial_ends_at) - Date.now()) / 86400000));
    $('#trial-badge').textContent = `무료체험 D-${remain}`;
    $('#trial-badge').classList.add('active');
  } else if (t.subscription_status === 'active') {
    $('#trial-badge').textContent = `${t.plan?.toUpperCase() || 'PRO'} 구독중`;
    $('#trial-badge').classList.add('active', 'paid');
  } else {
    $('#trial-badge').textContent = '구독 만료';
    $('#trial-badge').classList.add('active', 'expired');
  }
}

function bindNav() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const route = item.dataset.route;
      navigate(route);
    });
  });

  // hashchange는 외부에서 뒤로가기/북마크로 이동할 때만 처리
  window.addEventListener('hashchange', () => {
    const r = location.hash.replace('#/', '') || 'overview';
    if (r !== currentRoute) navigate(r, true);
  });

  $('#btn-logout').addEventListener('click', signOut);

  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  $('#mobile-menu').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('active');
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('active');
  });
}

async function navigate(route, fromHash = false) {
  if (!ROUTES[route]) route = 'overview';
  if (route === currentRoute && !fromHash) return; // 같은 페이지 중복 방지
  if (isNavigating) return; // 로딩 중 중복 방지

  isNavigating = true;
  currentRoute = route;

  if (!fromHash) location.hash = `#/${route}`;
  $$('.nav-item').forEach(it => it.classList.toggle('active', it.dataset.route === route));
  $('#sidebar').classList.remove('open');
  $('#sidebar-backdrop').classList.remove('active');

  const root = $('#view-root');
  // 이전 뷰 실시간 구독 정리
  if (root._teardown) { root._teardown(); root._teardown = null; }

  root.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    await ROUTES[route]({ root, profile });
  } catch (err) {
    console.error('[navigate]', err);
    root.innerHTML = `<div class="error-box">화면 로드 실패: ${err.message}</div>`;
    toast(err.message, 'error');
  } finally {
    isNavigating = false;
  }
}
