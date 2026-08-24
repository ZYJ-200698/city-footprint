// v2.2 验证：开云雾散真的能在用户视角清楚看到，而不是被 splash 遮住。
// 关键：(1) splash 渐隐期间 reveal-fx 已经在 z-index 250 上方拨云；
// (2) splash.remove() 后云继续展开 → 露出地图；
// (3) 「我的」页点重看按钮能再次触发 reveal('boot')。
const { chromium } = require('playwright');
const path = require('path');

const URL = 'http://127.0.0.1:8766/index.html';
const SHOTS = path.resolve(__dirname);

const checks = [];
function check(name, ok, info) {
  checks.push({ name, ok: !!ok, info: info || '' });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' · ' + info : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

  // 不等 networkidle：DOMContentLoaded → boot() 触发 splash + reveal
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // 等 reveal-fx 拿到 .show.boot（boot() 在 DOMContentLoaded 后 ~350ms 进入 reveal）
  await page.waitForFunction(() => {
    const fx = document.getElementById('reveal-fx');
    return fx && fx.classList.contains('show') && fx.classList.contains('boot');
  }, null, { timeout: 5000 });

  // ===== 阶段 1：splash 渐隐 + reveal 拨云 =====
  // 在 reveal 开始 ~150ms 后采样：splash 应正淡出、c-left 刚开始拨开
  await page.waitForTimeout(150);
  const phase1 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const splash = document.getElementById('splash');
    const left = fx.querySelector('.fx-boot .c-left');
    const sun = fx.querySelector('.fx-boot .sun');
    return {
      fxZ: parseInt(getComputedStyle(fx).zIndex, 10),
      splashZ: splash ? parseInt(getComputedStyle(splash).zIndex, 10) : null,
      splashFade: splash ? splash.classList.contains('fade') : null,
      splashRemoved: !splash,
      fxOpacity: parseFloat(getComputedStyle(fx).opacity),
      leftTx: new DOMMatrix(getComputedStyle(left).transform).e,
      sunOpacity: parseFloat(getComputedStyle(sun).opacity),
    };
  });
  check('phase1.fx.zIndex=250 (above splash 200)', phase1.fxZ === 250, 'got ' + phase1.fxZ);
  check('phase1.splash exists (still on screen)', phase1.splashZ != null);
  check('phase1.splash.zIndex=200', phase1.splashZ === 200, 'got ' + phase1.splashZ);
  check('phase1.splash.fade started', phase1.splashFade === true);
  check('phase1.fx.opacity=1', phase1.fxOpacity >= 0.95, 'op=' + phase1.fxOpacity.toFixed(3));
  check('phase1.c-left starting to move', phase1.leftTx < 0, 'tx=' + phase1.leftTx.toFixed(1));
  check('phase1.sun bursting', phase1.sunOpacity > 0, 'op=' + phase1.sunOpacity.toFixed(3));

  // 截 ~150ms（云刚开始拨、太阳刚破）
  await page.screenshot({ path: path.join(SHOTS, 'v22_boot_t150.png'), fullPage: false });

  // ===== 阶段 2：boot 中段：splash 已移除，云应拨出 ~60% =====
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 3000 });
  await page.waitForTimeout(400);   // splash.remove 后再 400ms，看云继续拨
  const phase2 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const left = fx.querySelector('.fx-boot .c-left');
    const right = fx.querySelector('.fx-boot .c-right');
    return {
      splashGone: !document.getElementById('splash'),
      leftTx: new DOMMatrix(getComputedStyle(left).transform).e,
      rightTx: new DOMMatrix(getComputedStyle(right).transform).e,
      leftBg: getComputedStyle(left).backgroundImage,
    };
  });
  check('phase2.splash removed', phase2.splashGone);
  check('phase2.c-left moved further', phase2.leftTx < -120, 'tx=' + phase2.leftTx.toFixed(1));
  check('phase2.c-right moved further', phase2.rightTx > 120, 'tx=' + phase2.rightTx.toFixed(1));
  check('phase2.c-left has cloud_l.png bg', /cloud_l\.png/.test(phase2.leftBg), phase2.leftBg);
  await page.screenshot({ path: path.join(SHOTS, 'v22_boot_t550.png'), fullPage: false });

  // ===== 阶段 3：boot 结束 fx 移除 =====
  await page.waitForFunction(() => {
    const fx = document.getElementById('reveal-fx');
    return fx && !fx.classList.contains('show');
  }, null, { timeout: 4000 });
  const phase3 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    return {
      hasShow: fx.classList.contains('show'),
      hasBoot: fx.classList.contains('boot'),
      hasDive: fx.classList.contains('dive'),
    };
  });
  check('phase3.fx.show removed', !phase3.hasShow);
  check('phase3.fx.boot cleared', !phase3.hasBoot);

  // ===== 阶段 4：切到「我的」页面，点重看 =====
  await page.waitForTimeout(300);
  await page.click('#tabbar button[data-tab="me"]');
  await page.waitForTimeout(200);

  const btnExists = await page.evaluate(() => !!document.getElementById('btn-replay-boot'));
  check('phase4.btn-replay-boot exists', btnExists);

  await page.click('#btn-replay-boot');
  await page.waitForTimeout(150);   // 让 animation 推进
  const replay = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const left = fx.querySelector('.fx-boot .c-left');
    return {
      hasShow: fx.classList.contains('show'),
      hasBoot: fx.classList.contains('boot'),
      hasDive: fx.classList.contains('dive'),
      leftTx: new DOMMatrix(getComputedStyle(left).transform).e,
    };
  });
  check('phase4.replay shows .show.boot', replay.hasShow && replay.hasBoot && !replay.hasDive);
  check('phase4.replay c-left moving', replay.leftTx < 0, 'tx=' + replay.leftTx.toFixed(1));
  await page.screenshot({ path: path.join(SHOTS, 'v22_replay_t150.png'), fullPage: false });

  // replay 收尾
  await page.waitForFunction(() => {
    const fx = document.getElementById('reveal-fx');
    return fx && !fx.classList.contains('show');
  }, null, { timeout: 4000 });
  check('phase4.replay cleaned up', true);

  check('console errors == 0', consoleErrors.length === 0, 'got ' + consoleErrors.length);
  if (consoleErrors.length) console.log('  ↳', consoleErrors.slice(0, 6).join(' | '));

  await browser.close();

  const failed = checks.filter(c => !c.ok);
  console.log(`\n${checks.length - failed.length} / ${checks.length} pass`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(c => console.log('  - ' + c.name + (c.info ? ' · ' + c.info : '')));
    process.exit(1);
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
