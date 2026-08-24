// v2.3 验证：云波雾散（开云雾散 / 拨云见日，'boot'）现已统一用于所有导航与记录层。
// 关键断言：点开省份、点开城市（记录层）、世界模式 都应触发 reveal-fx 的 .show.boot，且不再触发 .dive。
const { chromium } = require('playwright');
const path = require('path');

const URL = 'http://127.0.0.1:8766/index.html';
const SHOTS = path.resolve(__dirname);

const checks = [];
function check(name, ok, info) {
  checks.push({ name, ok: !!ok, info: info || '' });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' · ' + info : ''}`);
}

const fxState = `(() => {
  const fx = document.getElementById('reveal-fx');
  return { show: fx.classList.contains('show'), boot: fx.classList.contains('boot'), dive: fx.classList.contains('dive') };
})()`;

const waitClear = `(() => new Promise(res => {
  const t = setInterval(() => {
    const fx = document.getElementById('reveal-fx');
    if (fx && !fx.classList.contains('show')) { clearInterval(t); res(true); }
  }, 50);
  setTimeout(() => { clearInterval(t); res(true); }, 4000);
}))()`;

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

  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // 等初始启动 boot 真正结束：splash 已移除、reveal-fx.show 已清除。
  // 注意：单查 fx!show 会过早满足（initial reveal 在 setTimeout 350ms 后才加 .show），
  // 必须同时等 splash 消失（splash.remove() 在 boot 内 ~950ms 执行），避免后续截图截到启动屏。
  await page.waitForFunction(() => {
    const fx = document.getElementById('reveal-fx');
    return !document.getElementById('splash') && fx && !fx.classList.contains('show');
  }, null, { timeout: 8000 });
  check('initial boot finished (splash removed + fx cleared)', true);

  // ===== 1) 点开省份 → boot =====
  const provAd = await page.evaluate(() => Object.keys(IDX.provByAdcode)[0]);
  await page.evaluate((ad) => showProvince(ad), provAd);
  await page.waitForTimeout(120);
  const p1 = await page.evaluate(fxState);
  check('province click → show.boot (no dive)', p1.show && p1.boot && !p1.dive, JSON.stringify(p1));
  await page.screenshot({ path: path.join(SHOTS, 'v23_prov_boot.png'), fullPage: false });
  await page.evaluate(waitClear);

  // ===== 2) 点开城市（记录层 openSheet）→ boot =====
  await page.evaluate(() => { const id = Object.keys(IDX.cityById)[0]; openSheet(id); });
  await page.waitForTimeout(120);
  const p2 = await page.evaluate(fxState);
  check('city sheet → show.boot (no dive)', p2.show && p2.boot && !p2.dive, JSON.stringify(p2));
  await page.screenshot({ path: path.join(SHOTS, 'v23_city_boot.png'), fullPage: false });
  await page.evaluate(() => closeSheets());
  await page.evaluate(waitClear);

  // ===== 3) 世界模式 → boot =====
  await page.evaluate(() => showWorld());
  await page.waitForTimeout(120);
  const p3 = await page.evaluate(fxState);
  check('world mode → show.boot (no dive)', p3.show && p3.boot && !p3.dive, JSON.stringify(p3));
  await page.screenshot({ path: path.join(SHOTS, 'v23_world_boot.png'), fullPage: false });
  await page.evaluate(waitClear);

  // ===== 4) 国家弹层 → boot =====
  const countryEn = await page.evaluate(() => Object.keys(IDX.countryByEn)[0]);
  await page.evaluate((en) => openCountrySheet(IDX.countryByEn[en]), countryEn);
  await page.waitForTimeout(120);
  const p4 = await page.evaluate(fxState);
  check('country sheet → show.boot (no dive)', p4.show && p4.boot && !p4.dive, JSON.stringify(p4));
  await page.evaluate(() => closeSheets());
  await page.evaluate(waitClear);

  // ===== 5) 启动「返回全国」showChina 也仍是 boot =====
  await page.evaluate(() => showChina());
  await page.waitForTimeout(120);
  const p5 = await page.evaluate(fxState);
  check('back-to-national showChina → show.boot (no dive)', p5.show && p5.boot && !p5.dive, JSON.stringify(p5));
  await page.evaluate(waitClear);

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
