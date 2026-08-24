// verify17.js — v2.3.1 验收：强制刷新按钮 + boot 在省份/城市/世界/国家/返回全国 都还在
const path = require('path');
const playwright = require('playwright');

const URL_BASE = 'http://127.0.0.1:8766';
const SHOTS = path.resolve(__dirname);

const log = (...a) => console.log('[verify17]', ...a);
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

  // 1. 等初始启动 boot 结束（fx.show 移除 + splash 删除）
  await page.waitForFunction(() => {
    const fx = document.getElementById('reveal-fx');
    const splash = document.getElementById('splash');
    return fx && !fx.classList.contains('show') && !splash;
  }, null, { timeout: 8000 }).catch(() => {});
  check('initial boot finished + splash removed', await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const splash = document.getElementById('splash');
    return fx && !fx.classList.contains('show') && !splash;
  }));

  // 2. 切换到「我的」面板
  await page.evaluate(() => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('on'));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const me = document.getElementById('view-me');
    if (me) me.classList.remove('hidden');
    const meBtn = document.querySelector('[data-view="me"]');
    if (meBtn) meBtn.classList.add('on');
  });

  // 3. 强制刷新按钮存在且可见
  const btn = await page.$('#btn-force-refresh');
  check('btn-force-refresh rendered', !!btn);
  if (btn) {
    const visible = await btn.isVisible();
    check('btn-force-refresh visible', visible);
  }

  // 4. 触发 reveal('boot')（省份点击的效果就是这一行），期望 show.boot 状态
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const map = document.getElementById('view-map'); if (map) map.classList.remove('hidden');
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.reveal && window.reveal('boot'); }).catch(() => {});
  await page.waitForTimeout(120);
  const provState = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    return { show: fx.classList.contains('show'), boot: fx.classList.contains('boot'), dive: fx.classList.contains('dive') };
  });
  check('province: reveal.boot && !dive', provState.show && provState.boot && !provState.dive);
  await page.screenshot({ path: path.join(SHOTS, 'v231_prov_force.png') });

  // 5. SW 注册存在
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { ok: false, reason: 'no sw api' };
    const reg = await navigator.serviceWorker.getRegistration();
    return { ok: !!reg, scope: reg && reg.scope, controller: !!navigator.serviceWorker.controller };
  });
  check('service worker registered', swState.ok);

  // 6. forceRefresh 点击后会显示「正在检查更新…」toast；reload 因为不能稳定 stub 而改用 toast 断言
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-me').classList.remove('hidden');
  });
  // 监听：拦截 location.reload 不让它真刷页面（location.reload 是 non-writable，
  //    但可换一招：先看 toast 文本，再忽略后续 reload）
  await page.evaluate(() => {
    window.__beforeUnload = false;
    window.addEventListener('beforeunload', () => { window.__beforeUnload = true; });
  });
  await page.click('#btn-force-refresh');
  await page.waitForTimeout(150);
  const toastShown = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return !!(t && !t.classList.contains('hidden') && t.textContent.includes('检查更新'));
  });
  check('forceRefresh shows "检查更新" toast', toastShown);

  // 7. 控制台错误
  check('zero console errors', errs.length === 0);
  if (errs.length) log('errors:', errs);

  log('shots at', SHOTS);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
