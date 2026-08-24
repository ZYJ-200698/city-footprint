// verify14.js — 验证 v2.1 双特效：boot(开云雾散/拨云见日) 与 dive(穿云俯冲)
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:8766/';
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  PASS ' + name + (extra ? '  ('+extra+')' : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ('+extra+')' : '')); }
}
function txOf(transform) {
  // 解析 matrix(...) 的 translateX（e 值），无 transform 返回 0
  if (!transform || transform === 'none') return 0;
  const m = transform.match(/matrix\(([^)]+)\)/);
  if (!m) return 0;
  return parseFloat(m[1].split(',')[4]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  console.log('\n[BOOT] 开云雾散 / 拨云见日');
  // 直接重启 boot 特效（覆盖启动已播过的）
  await page.evaluate(() => reveal('boot'));
  await page.waitForTimeout(120);
  const b0 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const cs = el => getComputedStyle(el);
    const boot = fx.querySelector('.fx-boot'), sky = fx.querySelector('.fx-sky');
    const haze = fx.querySelector('.fx-haze'), cloud = fx.querySelector('.fx-cloud');
    const left = fx.querySelector('.fx-boot .c-left');
    return {
      classes: fx.className,
      bootDisp: cs(boot).display, skyDisp: cs(sky).display,
      hazeDisp: cs(haze).display, cloudDisp: cs(cloud).display,
      bg: cs(left).backgroundImage,
    };
  });
  check('boot has .show.boot (no .dive)', b0.classes.includes('show') && b0.classes.includes('boot') && !b0.classes.includes('dive'), b0.classes);
  check('boot shows .fx-boot + .fx-sky', b0.bootDisp === 'block' && b0.skyDisp === 'block', `boot=${b0.bootDisp} sky=${b0.skyDisp}`);
  check('boot hides dive art (.fx-haze/.fx-cloud none)', b0.hazeDisp === 'none' && b0.cloudDisp === 'none', `haze=${b0.hazeDisp} cloud=${b0.cloudDisp}`);
  check('boot left cloud uses cloud_l.png', /cloud_l\.png/.test(b0.bg), b0.bg.slice(0, 60));

  await page.waitForTimeout(350); // ~470ms
  const b1 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const left = fx.querySelector('.fx-boot .c-left');
    const sun = fx.querySelector('.fx-boot .sun');
    return { leftTx: getComputedStyle(left).transform, sunOp: parseFloat(getComputedStyle(sun).opacity) };
  });
  const b1tx = txOf(b1.leftTx);
  check('boot clouds parting (left translateX < -50px)', b1tx < -50, 'tx=' + b1tx.toFixed(1));
  check('boot sun bursting (opacity > 0.3)', b1.sunOp > 0.3, 'op=' + b1.sunOp.toFixed(2));

  await page.waitForTimeout(1100); // ~1570ms, timer removed show
  const b2 = await page.evaluate(() => document.getElementById('reveal-fx').className);
  check('boot effect ends (show removed)', !b2.includes('show'), b2);

  console.log('\n[DIVE] 穿云俯冲');
  await page.evaluate(() => reveal('dive'));
  await page.waitForTimeout(120);
  const d0 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const cs = el => getComputedStyle(el);
    const boot = fx.querySelector('.fx-boot'), sky = fx.querySelector('.fx-sky');
    const haze = fx.querySelector('.fx-haze'), cloud = fx.querySelector('.fx-cloud');
    return {
      classes: fx.className,
      bootDisp: cs(boot).display, skyDisp: cs(sky).display,
      hazeDisp: cs(haze).display, cloudDisp: cs(cloud).display,
    };
  });
  check('dive has .show.dive (no .boot)', d0.classes.includes('show') && d0.classes.includes('dive') && !d0.classes.includes('boot'), d0.classes);
  check('dive shows .fx-haze + .fx-cloud', d0.hazeDisp === 'block' && d0.cloudDisp === 'block', `haze=${d0.hazeDisp} cloud=${d0.cloudDisp}`);
  check('dive hides boot art (.fx-boot/.fx-sky none)', d0.bootDisp === 'none' && d0.skyDisp === 'none', `boot=${d0.bootDisp} sky=${d0.skyDisp}`);

  await page.waitForTimeout(350); // ~470ms
  const d1 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const b1 = fx.querySelector('.fx-blob.b1');
    const haze = fx.querySelector('.fx-haze');
    return { b1Op: parseFloat(getComputedStyle(b1).opacity), hazeOp: parseFloat(getComputedStyle(haze).opacity) };
  });
  check('dive blob visible mid (opacity > 0.4)', d1.b1Op > 0.4, 'op=' + d1.b1Op.toFixed(2));
  check('dive haze covering mid (opacity > 0.4)', d1.hazeOp > 0.4, 'op=' + d1.hazeOp.toFixed(2));

  await page.waitForTimeout(1100);
  const d2 = await page.evaluate(() => document.getElementById('reveal-fx').className);
  check('dive effect ends (show removed)', !d2.includes('show'), d2);

  console.log('\n[CONSOLE]');
  check('no console/page errors', errors.length === 0, errors.slice(0,3).join(' | '));

  await browser.close();
  console.log(`\n=== verify14: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
