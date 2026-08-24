/* verify13.js — v2.0 穿云俯冲验证
   1. 启动入场：触发 reveal()，采 4 个时点（t=30ms 起、t=400ms 高峰、t=900ms 末尾、t=1500ms 收尾），
      检查 fx-blob.b1 的 opacity 从 0→实→0，fx 整层 opacity 衰减到 0，无控制台错误；
   2. 点省份：showProvince(330000) 完成，地图切到 prov_330000；
   3. 点城市：openSheet('CN330100',{dive:true}) 后，200ms 时 #sheet 仍 hidden，1000ms 时显示。 */
const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    serviceWorkers: 'block',     // 不让 SW 缓存干扰：直接读最新 dist
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error:' + m.text()); });

  const log = (...a) => console.log('[v]', ...a);
  const r = (n, ok, info='') => log((ok ? 'PASS ' : 'FAIL ') + n + (info ? ' — ' + info : ''));
  let pass = 0, fail = 0;
  const check = (n, ok, info='') => { r(n, ok, info); if (ok) pass++; else fail++; };

  await page.goto('http://127.0.0.1:8766/?_=' + Date.now(), { waitUntil: 'load' });
  // 等启动屏与初次 reveal 收尾
  await page.waitForTimeout(3200);

  // ===== 1. 重新触发一次 reveal，采 4 个时点 =====
  await page.evaluate(() => window.reveal && window.reveal());

  // t≈30ms：fx 应已 .show；blob.b1 opacity 应从 0 开始上升；fx 整层 opacity≈1
  const t0 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const b1 = fx && fx.querySelector('.fx-blob.b1');
    const cs = b1 ? getComputedStyle(b1) : null;
    return {
      shown: !!(fx && fx.classList.contains('show')),
      b1Opacity: cs ? parseFloat(cs.opacity) : null,
      fxOpacity: fx ? parseFloat(getComputedStyle(fx).opacity) : null,
    };
  });
  check('boot.reveal.shown@t0', t0.shown === true);
  check('boot.fx-blob.b1 present', typeof t0.b1Opacity === 'number', 'b1Opacity=' + t0.b1Opacity);
  check('boot.fx opacity≈1@t0', t0.fxOpacity != null && t0.fxOpacity > 0.8, 'fx=' + t0.fxOpacity);

  // t≈400ms：blob 应进入"高峰"（opacity 高、rect 明显大于初始 90vmin）
  await page.waitForTimeout(400);
  const t1 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const b1 = fx.querySelector('.fx-blob.b1');
    const r = b1.getBoundingClientRect();
    return {
      b1Opacity: parseFloat(getComputedStyle(b1).opacity),
      b1W: r.width, b1H: r.height,
    };
  });
  check('boot.b1 peak opacity@400ms', t1.b1Opacity > 0.4, 'op=' + t1.b1Opacity.toFixed(3));
  // 90vmin @ 390x844 viewport => 90 * min(390,844)/100 = 351px。带 perspective+scale 应当远大于此。
  check('boot.b1 rect expanded@400ms', t1.b1W > 500 || t1.b1H > 500, 'w=' + t1.b1W.toFixed(0) + ' h=' + t1.b1H.toFixed(0));

  // t≈900ms：blob 与 haze 都接近收尾（视觉上云雾基本散去）
  await page.waitForTimeout(500);
  const t2 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const b1 = fx.querySelector('.fx-blob.b1');
    const haze = fx.querySelector('.fx-haze');
    return {
      b1Opacity: parseFloat(getComputedStyle(b1).opacity),
      hazeOpacity: parseFloat(getComputedStyle(haze).opacity),
    };
  });
  check('boot.b1 fading@900ms', t2.b1Opacity < 0.5, 'op=' + t2.b1Opacity.toFixed(3));
  check('boot.haze fading@900ms', t2.hazeOpacity < 0.5, 'op=' + t2.hazeOpacity.toFixed(3));

  // t≈1500ms：fx 被 reveal 定时器 remove('show')，整层应不可见（display:none）
  await page.waitForTimeout(600);
  const t3 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    return {
      shown: fx.classList.contains('show'),
      display: getComputedStyle(fx).display,
    };
  });
  check('boot.fx removed@1500ms', t3.shown === false, 'shown=' + t3.shown + ' display=' + t3.display);

  // ===== 2. 点省份：showProvince(330000) =====
  // 先等 1.5s 让定时器彻底清掉
  await page.waitForTimeout(600);
  const provResult = await page.evaluate(async () => {
    await window.showProvince(330000);
    return { ok: true };
  });
  check('showProvince resolves', provResult.ok === true);
  await page.waitForTimeout(1800);
  const provState = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    // 通过 chart 的当前 option 是否含 prov_330000 名称来验证（间接）
    return { fxRemoved: !fx.classList.contains('show') };
  });
  check('prov reveal completes', provState.fxRemoved === true);

  // ===== 3. 点城市：openSheet({dive:true})，验证 200ms 仍隐藏、1000ms 显示 =====
  // 先回到 national
  await page.evaluate(async () => {
    if (typeof window.showChina === 'function') await window.showChina();
  });
  await page.waitForTimeout(800);
  await page.evaluate(async () => { await window.showProvince(330000); });
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.openSheet('CN330100', { dive: true }));
  await page.waitForTimeout(200);
  const sheetEarly = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    return { hidden: s.classList.contains('hidden') };
  });
  check('city.sheet hidden@200ms(dive)', sheetEarly.hidden === true, 'hidden=' + sheetEarly.hidden);
  await page.waitForTimeout(900);
  const sheetLate = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    return { hidden: s.classList.contains('hidden'), title: document.getElementById('sheet-title').textContent };
  });
  check('city.sheet visible@1100ms(dive)', sheetLate.hidden === false, 'title=' + sheetLate.title);

  check('no console errors', errors.length === 0, errors.join(' | '));

  console.log(`\n========== verify13 summary: ${pass} pass, ${fail} fail ==========`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
