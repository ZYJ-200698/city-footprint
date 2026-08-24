// shots_v21.js — 抓 v2.1 双特效视觉帧（清掉 splash 露出底层）
const { chromium } = require('playwright-core');
const OUT = 'C:/Users/ZYJ/Documents/Agent 开发/workspace-013/city-footprint/tests';
const URL = 'http://127.0.0.1:8766/';

const shots = [
  { name: 'v21_boot_early.png',  mode: 'boot', t: 130 },
  { name: 'v21_boot_mid.png',    mode: 'boot', t: 480 },
  { name: 'v21_boot_late.png',   mode: 'boot', t: 1000 },
  { name: 'v21_dive_early.png',  mode: 'dive', t: 130 },
  { name: 'v21_dive_mid.png',    mode: 'dive', t: 480 },
  { name: 'v21_dive_late.png',   mode: 'dive', t: 1000 },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  // 移掉启动屏，露出底层（真实使用中，启动屏 1100ms 后自然消失；返回全国时根本不存在启动屏）
  await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
  for (const s of shots) {
    await page.evaluate(m => reveal(m), s.mode);
    await page.waitForTimeout(s.t);
    await page.screenshot({ path: `${OUT}/${s.name}` });
    console.log('captured', s.name);
  }
  await browser.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
