/**
 * generate-icon.mjs
 * Playwright를 이용해 resources/icon.png (1024×1024) 자동 생성
 * 실행: npm run gen:icon
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

(async () => {
  console.log('🎨 아이콘 생성 중...');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1024, height: 1024 });

  await page.setContent(`<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f1b2d">
<canvas id="c" width="1024" height="1024" style="display:block"></canvas>
<script>
const ctx = document.getElementById('c').getContext('2d');
const W = 1024;

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

/* ── Navy background ── */
ctx.fillStyle = '#0f1b2d';
roundRect(0,0,W,W,150);
ctx.fill();

/* ── Teal strokes ── */
ctx.strokeStyle = '#00c9a7';
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.lineWidth = 62;

function line(pts){
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
  ctx.stroke();
}

const PAD=105, LEG=200;

/* Four corner L-brackets */
line([[PAD,PAD+LEG],[PAD,PAD],[PAD+LEG,PAD]]);
line([[W-PAD-LEG,PAD],[W-PAD,PAD],[W-PAD,PAD+LEG]]);
line([[PAD,W-PAD-LEG],[PAD,W-PAD],[PAD+LEG,W-PAD]]);
line([[W-PAD-LEG,W-PAD],[W-PAD,W-PAD],[W-PAD,W-PAD-LEG]]);

/* Arrow pointing right */
const CY=W/2, aL=232, aR=W-218, hD=178, hH=196, bodyEnd=aR-hD;
line([[aL,CY],[bodyEnd,CY]]);
line([[bodyEnd,CY-hH],[aR,CY],[bodyEnd,CY+hH]]);
</script>
</body></html>`);

  await page.waitForTimeout(300);

  const pngBase64 = await page.evaluate(() =>
    document.getElementById('c').toDataURL('image/png').split(',')[1]
  );

  mkdirSync(join(__dirname, 'resources'), { recursive: true });
  const outPath = join(__dirname, 'resources', 'icon.png');
  writeFileSync(outPath, Buffer.from(pngBase64, 'base64'));

  await browser.close();
  console.log('✅ resources/icon.png 생성 완료! (1024×1024)');
  console.log('👉 다음: npm run cap:icons');
})();
