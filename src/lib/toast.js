// 가벼운 toast 알림
let container = null;
function ensure() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  container.style.cssText = `
    position:fixed;top:20px;left:50%;transform:translateX(-50%);
    z-index:99999;display:flex;flex-direction:column;gap:8px;
    pointer-events:none;width:max-content;max-width:90vw;
  `;
  document.body.appendChild(container);
  return container;
}

export function toast(message, type = 'info', duration = 2500) {
  ensure();
  const colors = {
    info: '#1565c0', success: '#00c9a7', error: '#f04438', warn: '#f79009',
  };
  const el = document.createElement('div');
  el.style.cssText = `
    background:${colors[type] || colors.info};color:#fff;padding:12px 20px;
    border-radius:10px;font-size:14px;font-weight:600;
    box-shadow:0 8px 24px rgba(0,0,0,.18);
    pointer-events:auto;animation:tg-toast-in .18s ease;
    max-width:90vw;white-space:pre-line;
  `;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 200);
  }, duration);
}

// 스타일 1회 주입
if (!document.getElementById('tg-toast-style')) {
  const style = document.createElement('style');
  style.id = 'tg-toast-style';
  style.textContent = `@keyframes tg-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}`;
  document.head.appendChild(style);
}
