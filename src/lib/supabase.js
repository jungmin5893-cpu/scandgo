import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIGURED =
  !!url && !!anonKey &&
  !url.includes('placeholder') && !anonKey.includes('placeholder');

if (!SUPABASE_CONFIGURED) {
  console.warn('[supabase] 셋업 전입니다. .env.local에 실제 URL/anon key를 넣어주세요.');
  // 셋업 전이면 셋업 안내 페이지로 안내 (login/dashboard/employee 어느 페이지든)
  if (typeof window !== 'undefined' && !location.pathname.endsWith('setup.html')) {
    setTimeout(() => { location.href = '/setup.html'; }, 0);
  }
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'tagin.auth',
  },
  realtime: { params: { eventsPerSecond: 5 } },
});

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export function getJwtClaims() {
  const session = supabase.auth.getSession ? null : null;
  // 동기 접근용 — 호출자가 await getSession() 후 access_token 디코드
  return null;
}

export function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}
