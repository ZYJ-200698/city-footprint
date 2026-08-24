/* verify9 — v1.6 单模式云朵展开 + 音效验收（Playwright headless, iPhone 390x844） */
const { chromium } = require('playwright');
const SHELL = 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
const URL = 'http://127.0.0.1:8766/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const errors = [];
  const browser = await chromium.launch({
    executablePath: SHELL,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

  // 注入 AudioContext 钩子，捕获实例与 state
  await page.addInitScript(() => {
    window.__audio = [];
    const O = window.AudioContext || window.webkitAudioContext;
    function Wrapped(...a) { const c = new O(...a); window.__audio.push(c); return c; }
    Wrapped.prototype = O.prototype;
    window.AudioContext = Wrapped; window.webkitAudioContext = Wrapped;
  });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof showProvince === 'function', { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 20000 });

  // 触发入场特效
  await page.evaluate(() => showProvince('440000'));
  await sleep(520);

  const r = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const cl = document.querySelector('#reveal-fx .c-left');
    const cr = document.querySelector('#reveal-fx .c-right');
    const sun = document.querySelector('#reveal-fx .sun');
    const haze = document.querySelector('#reveal-fx .c-haze');
    return {
      show: fx.classList.contains('show'),
      dataFx: fx.dataset.fx || null,
      // 写实云景：12 层径向渐变应至少渲染出来（getComputedStyle.backgroundImage 含 gradient）
      leftBgHasGradient: getComputedStyle(cl).backgroundImage.includes('gradient'),
      rightBgHasGradient: getComputedStyle(cr).backgroundImage.includes('gradient'),
      clTransform: getComputedStyle(cl).transform,
      crTransform: getComputedStyle(cr).transform,
      sunOpacity: parseFloat(getComputedStyle(sun).opacity),
      hazeOpacity: parseFloat(getComputedStyle(haze).opacity),
      audio: (window.__audio || []).map(c => c.state),
      // 取色：中央顶部 0.18 高度区域的颜色，应是暖金色（拨云见日的核心观感）
      centerColor: (() => {
        const c = document.createElement('canvas'); c.width = c.height = 1;
        // 由于无法离屏截图，用元素的 background 计算的中间像素近似
        return getComputedStyle(document.querySelector('#reveal-fx .fx-cloud')).background.slice(0, 80);
      })(),
    };
  });

  await browser.close();

  // 判定：动画进行中
  const anyAnim = (t) => t && t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)';
  const ok = r.show
    && anyAnim(r.clTransform) && anyAnim(r.crTransform)
    && r.sunOpacity > 0.3
    && r.leftBgHasGradient && r.rightBgHasGradient
    && r.audio.length > 0 && r.audio.some(s => s === 'running');

  console.log(JSON.stringify({ r, errors, ok }, null, 2));
  if (errors.length || !ok) { console.log('VERIFY9_FAIL'); process.exit(1); }
  console.log('VERIFY9_PASS');
})().catch(e => { console.error('FATAL', e); process.exit(2); });