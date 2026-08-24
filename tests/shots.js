/* shots.js — v1.6 拨云见日（参考图风）入场特效中段帧截图（iPhone 390x844） */
const { chromium } = require('playwright');
const SHELL = 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
const URL = 'http://127.0.0.1:8766/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: SHELL,
    args: ['--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'],
  });

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof showProvince === 'function', { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 20000 });

  // 触发入场特效（拨云见日）
  await page.evaluate(() => showProvince('440000'));
  // 1.05s 动画，520ms 是云体最舒展、太阳光晕最盛的一瞬
  await sleep(520);
  const out = 'tests/v16_cloud_mid.png';
  await page.screenshot({ path: out });
  console.log('SHOT ->', out);

  // 另存一张：特效刚启动的"云闭拢"瞬间（80ms），方便对比
  await page.evaluate(() => showProvince('440000'));
  await sleep(80);
  const out2 = 'tests/v16_cloud_open.png';
  await page.screenshot({ path: out2 });
  console.log('SHOT ->', out2);

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(2); });