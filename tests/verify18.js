// verify18.js — v2.4 验收：进入=张开(boot) / 退出=闭上(close)
const path = require('path');
const playwright = require('playwright');

const URL_BASE = 'http://127.0.0.1:8766';
const SHOTS = path.resolve(__dirname);

const log = (...a) => console.log('[verify18]', ...a);
const check = (label, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto(URL_BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const fx = document.getElementById('reveal-fx');
    const splash = document.getElementById('splash');
    return fx && !fx.classList.contains('show') && !splash;
  }, null, { timeout: 8000 }).catch(() => {});

  // helper：直接触发 reveal 并抓某时刻的 c-left 位移 / 整体状态
  async function stateAt(mode, delayMs) {
    await page.evaluate((m) => { window.reveal(m); }, mode);
    await page.waitForTimeout(delayMs);
    return await page.evaluate(() => {
      const fx = document.getElementById('reveal-fx');
      const cl = document.querySelector('#reveal-fx .fx-boot .c-left');
      const cr = document.querySelector('#reveal-fx .fx-boot .c-right');
      const sky = document.querySelector('#reveal-fx .fx-sky');
      const computed = cl ? getComputedStyle(cl).transform : null;
      // 解析 matrix translateX
      let tx = null;
      if (computed && computed.startsWith('matrix')) {
        const parts = computed.replace(/matrix\(|\)/g, '').split(',').map(s => parseFloat(s.trim()));
        tx = parts[4]; // e 分量 = translateX(px)
      }
      return {
        show: fx.classList.contains('show'),
        boot: fx.classList.contains('boot'),
        close: fx.classList.contains('close'),
        dive: fx.classList.contains('dive'),
        cLeftTx: tx,
        skyOpacity: sky ? parseFloat(getComputedStyle(sky).opacity) : null,
        fxOpacity: parseFloat(getComputedStyle(fx).opacity)
      };
    });
  }

  // 1. 进入：boot 模式。中段（~550ms）云应已拨开（c-left translateX 接近 -118% × 宽）。
  //    390 宽，c-left width 70% = 273px，translateX(-118%) = -322px。用阈值 < -200 判定"已张开"。
  const bootMid = await stateAt('boot', 550);
  check('enter: boot mode active', bootMid.show && bootMid.boot && !bootMid.close && !bootMid.dive);
  check('enter: clouds parted (c-left translateX < -200px)', bootMid.cLeftTx !== null && bootMid.cLeftTx < -200);
  await page.screenshot({ path: path.join(SHOTS, 'v24_enter_boot.png') });

  // 2. 退出：close 模式。早期（~400ms，云合拢中）c-left 应从 -322px 向 0 移动（即 tx 绝对值变小）；
  //    晚期（~900ms，整层淡出后）fx opacity 趋近 0。
  const closeEarly = await stateAt('close', 450);
  check('exit: close mode active', closeEarly.show && closeEarly.close && !closeEarly.boot && !closeEarly.dive);
  // 450ms 时：云合拢动画 0.22s 起、0.62s 时长 → 进度约 (0.45-0.22)/0.62 ≈ 0.37，tx 在 -322→0 之间。
  // 断言"正在合拢"：tx 明显比初始 -322 更靠近 0，又还没合到中央（> -60）。
  check('exit: clouds closing (c-left tx between -310 and -60)', closeEarly.cLeftTx !== null && closeEarly.cLeftTx > -310 && closeEarly.cLeftTx < -60);
  await page.screenshot({ path: path.join(SHOTS, 'v24_exit_closing.png') });

  const closeLate = await stateAt('close', 1250);
  check('exit: whole layer faded out (fx opacity < 0.15)', closeLate.fxOpacity < 0.15);
  await page.screenshot({ path: path.join(SHOTS, 'v24_exit_faded.png') });

  // 3. 控制台 0 报错
  check('zero console errors', errs.length === 0);
  if (errs.length) log('errors:', errs);

  log('shots at', SHOTS);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
