/**
 * HTML 특수문자를 이스케이프 — XSS 방지용
 * innerHTML에 사용자 입력값을 넣기 전 반드시 거쳐야 함
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 클립보드 복사 (구형 브라우저 fallback 포함)
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
    return true;
  }
}
