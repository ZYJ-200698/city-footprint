/* verify8 — v1.5 双模式入场特效 + Web Audio 音效验收（Playwright headless, iPhone 390x844） */
const { chromium } = require('playwright');
const SHELL = 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
const URL = 'http://127.0.0.1:8766/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const errors = [], pages = [];
  const browser = await chromium.launch({ executablePath: SHELL, args: ['--autoplay-policy=no-user-gesture-required'] });
  const results = {};

  for (const mode of ['cloud', 'paper']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${mode}] console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[${mode}] pageerror: ${e.message}`));
    // 预置特效模式 + 注入 AudioContext 钩子，记录实例与是否运行
    await page.addInitScript((m) => {
      localStorage.setItem('fp_reveal_fx_v1', m);
      window.__audio = [];
      const O = window.AudioContext || window.webkitAudioContext;
      function Wrapped(...a) { const c = new O(...a); window.__audio.push(c); return c; }
      Wrapped.prototype = O.prototype;
      window.AudioContext = Wrapped; window.webkitAudioContext = Wrapped;
    }, mode);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof showProvince === 'function', { timeout: 15000 });
    await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });

    const dataFx = await page.$eval('#reveal-fx', el => el.dataset.fx);
    // 触发：进入省份 -> reveal()
    await page.evaluate(() => showProvince('440000'));
    await sleep(450);
    const r = await page.evaluate((md) => {
      const fx = document.getElementById('reveal-fx');
      const activeSel = md === 'cloud'
        ? ['#reveal-fx .fx-cloud .c-left', '#reveal-fx .fx-cloud .c-right']
        : ['#reveal-fx .fx-paper .p-left', '#reveal-fx .fx-paper .p-right'];
      const inactiveSel = md === 'cloud'
        ? '#reveal-fx .fx-paper'
        : '#reveal-fx .fx-cloud';
      const trA = activeSel.map(s => getComputedStyle(document.querySelector(s)).transform);
      const dispInactive = getComputedStyle(document.querySelector(inactiveSel)).display;
      const audio = (window.__audio || []).map(c => c.state);
      const show = fx.classList.contains('show');
      return { show, trA, dispInactive, audio };
    }, mode);

    results[mode] = { dataFx, ...r };
    await ctx.close();
  }

  await browser.close();

  // 判定
  const anyAnim = (arr) => arr.some(t => t && t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)');
  const okCloud = results.cloud.dataFx === 'cloud' && results.cloud.show
    && anyAnim(results.cloud.trA) && results.cloud.dispInactive === 'none'
    && results.cloud.audio.length > 0;
  const okPaper = results.paper.dataFx === 'paper' && results.paper.show
    && anyAnim(results.paper.trA) && results.paper.dispInactive === 'none'
    && results.paper.audio.length > 0;

  console.log(JSON.stringify({ results, errors, okCloud, okPaper }, null, 2));
  if (errors.length || !okCloud || !okPaper) { console.log('VERIFY8_FAIL'); process.exit(1); }
  console.log('VERIFY8_PASS');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
