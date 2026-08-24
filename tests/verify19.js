const { chromium } = require('playwright');
const path = require('path');

const URL = 'http://127.0.0.1:8766/index.html';
const SHOTS = path.join(__dirname);
let pass = 0, fail = 0;
function check(name, cond) { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name); }

function txOf(p) {
  return p.evaluate(() => {
    const cl = document.querySelector('#reveal-fx .fx-boot .c-left');
    if (!cl) return null;
    const tf = getComputedStyle(cl).transform;
    if (!tf || tf === 'none') return 0;
    const m = tf.match(/matrix\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(',').map(s => parseFloat(s.trim()));
    return Math.round(a[4]); // translateX in px
  });
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200); // 等初始启动 + splash 结束

  // 触发退出（close）特效，立即在 100ms（处于 0.22s 延迟内）采样
  await p.evaluate(() => window.reveal('close'));
  await p.waitForTimeout(100);
  const earlyTx = await txOf(p);
  check('exit@100ms: clouds OPEN during delay (tx < -200, NOT ~0/closed)', earlyTx !== null && earlyTx < -200);
  await p.screenshot({ path: path.join(SHOTS, 'v25_close_early_open.png') });

  // 中段 500ms：应在合拢途中（tx 介于 -322 与 0 之间，靠近 -200 量级）
  await p.evaluate(() => window.reveal('close'));
  await p.waitForTimeout(500);
  const midTx = await txOf(p);
  check('exit@500ms: clouds closing (tx between -322 and ~ -50)', midTx !== null && midTx > -322 && midTx < -50);
  await p.screenshot({ path: path.join(SHOTS, 'v25_close_mid.png') });

  // 末段 1250ms（fade 0.84s→1.16s 完成后）：整层应淡出（opacity 趋近 0）
  await p.evaluate(() => window.reveal('close'));
  await p.waitForTimeout(1250);
  const fxOp = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('reveal-fx')).opacity));
  check('exit@1250ms: whole layer faded out (opacity < 0.05)', fxOp < 0.05);

  check('no console errors', errs.length === 0);
  if (errs.length) console.log('  errors:', errs.slice(0, 3));

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
