/* v1.9 验证：点开每个省份/城市时的"俯冲"特效
   - reveal('dive', tapX) 触发后：
       #reveal-fx 同时拥有 .show 与 .dive 两个类；
       CSS 变量 --dive-x 被设为传入的 tapX（决定云朵拨开的横向中心）；
       云朵 .c-left/.c-right 进入 cloudRushL/R（同时 translateX + scale 放大 = 冲过镜头）；
       .fx-sky 进入 skyDive（scale 1→1.16 = 天空前推）；
       .sun 进入 sunBurstDive（更大爆发 = 破云而出）。
   - 校验：
       (1) reveal('dive', 0.3) 之后 .show.dive 存在，--dive-x 近似 0.3；
       (2) ~300ms 时云朵 c-left 的 transform 同时具有 translateX(<0) 与 scale(>1) —— 冲过镜头；
       (3) 1.3s 后 fx 整体 opacity 接近 0，云朵彻底滑出；
       (4) showProvince 流程结束后 S.curProv 切到目标省份，地图层级为 'province'；
       (5) openSheet({dive,tapX}) 流程：开始时 #sheet.hidden 仍存在，约 800ms 后才显现；
       (6) 控制台无错误。 */

const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'http://127.0.0.1:8766/';
const EXE = 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';

// 从 transform 矩阵同时解析 translateX 与 scale：matrix(a, b, c, d, tx, ty)
// 注意 a==d==scale，tx 是第 5 个数。
function parseMatrix2D(t) {
  if (!t || t === 'none') return { tx: 0, sx: 1 };
  const m = t.match(/matrix\(([^)]+)\)/);
  if (!m) return { tx: 0, sx: 1 };
  const p = m[1].split(',').map(s => parseFloat(s.trim()));
  return { tx: p[4], sx: p[0] };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  // 等 boot 走完：splash 消失 + reveal 函数就绪
  await page.waitForFunction(() => typeof reveal === 'function' && !document.getElementById('splash'));

  // 让 boot 期间的 reveal 自然结束，避免与我们的测试 reveal 重入
  await sleep(1700);

  /* ============ Test 1: 点开省份（浙江 330000, tapX=0.3 偏左） ============ */
  await page.evaluate(() => reveal('dive', 0.3));
  // 立刻：应该有 .show.dive，--dive-x 接近 0.3
  const t0 = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    return {
      show: fx.classList.contains('show'),
      dive: fx.classList.contains('dive'),
      diveX: parseFloat(fx.style.getPropertyValue('--dive-x')),
      cloudShift: getComputedStyle(fx.querySelector('.fx-cloud')).transform, // 平移到落点
    };
  });
  await sleep(300);
  const tMid = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    const cl = fx.querySelector('.c-left');
    const cr = fx.querySelector('.c-right');
    const sky = fx.querySelector('.fx-sky');
    return {
      cl: getComputedStyle(cl).transform,
      cr: getComputedStyle(cr).transform,
      sky: getComputedStyle(sky).transform,
      sun: parseFloat(getComputedStyle(fx.querySelector('.sun')).opacity),
      fxOpacity: parseFloat(getComputedStyle(fx).opacity),
    };
  });
  const clMid = parseMatrix2D(tMid.cl);
  const crMid = parseMatrix2D(tMid.cr);
  await sleep(900);
  const tEnd = await page.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    return {
      cl: getComputedStyle(fx.querySelector('.c-left')).transform,
      cr: getComputedStyle(fx.querySelector('.c-right')).transform,
      fxOpacity: parseFloat(getComputedStyle(fx).opacity),
    };
  });
  const clEnd = parseMatrix2D(tEnd.cl);
  const crEnd = parseMatrix2D(tEnd.cr);

  // 等动画完全结束（1.5s）再查地图状态
  await sleep(400);

  // 触发一次真正的 showProvince 走完整链路（确保链路可被正常调用）
  await page.evaluate(() => showProvince('330000', 0.3));
  // 等异步加载 + 动画结束
  await sleep(2000);
  const provState = await page.evaluate(() => ({
    curProv: S.curProv,
    mapLevel: S.mapLevel,
    chartMap: S.chart.getOption().series[0].map,
  }));

  // 再等 reveal 自然结束进入下一次测试
  await sleep(300);

  /* ============ Test 2: 点开城市（在省份里点 city，dive + 800ms 延迟弹层） ============ */
  // 浙江第一个城市：拿一个真实 city id
  const cityId = await page.evaluate(() => IDX.provByAdcode['330000'].cities[0].id);
  // 触发前 sheet 应该是 hidden
  const sheetBefore = await page.evaluate(() => ({
    maskHidden: document.getElementById('sheet-mask').classList.contains('hidden'),
    sheetHidden: document.getElementById('sheet').classList.contains('hidden'),
  }));
  await page.evaluate((id) => openSheet(id, { dive: true, tapX: 0.6 }), cityId);
  // 200ms 时弹层应该仍是 hidden（800ms 延迟），且 reveal 已带 dive
  await sleep(200);
  const sheetAt200 = await page.evaluate(() => ({
    maskHidden: document.getElementById('sheet-mask').classList.contains('hidden'),
    sheetHidden: document.getElementById('sheet').classList.contains('hidden'),
    fxDive: document.getElementById('reveal-fx').classList.contains('dive'),
    diveX: parseFloat(document.getElementById('reveal-fx').style.getPropertyValue('--dive-x')),
  }));
  // 1000ms 时弹层应该已经显示
  await sleep(800);
  const sheetAt1000 = await page.evaluate(() => ({
    maskHidden: document.getElementById('sheet-mask').classList.contains('hidden'),
    sheetHidden: document.getElementById('sheet').classList.contains('hidden'),
    sheetTitle: document.getElementById('sheet-title').textContent,
  }));

  await browser.close();

  // ===== 判定 =====
  const checks = [];
  checks.push(['1.show', t0.show === true]);
  checks.push(['1.dive', t0.dive === true]);
  checks.push(['1.diveX≈0.3', Math.abs(t0.diveX - 0.3) < 0.001]);
  checks.push(['1.cloudShift非none', t0.cloudShift && t0.cloudShift !== 'none']);
  // 中段：云朵 c-left 同时具有 tx<0 和 sx>1（冲过镜头）
  checks.push(['1.mid.clLeft<0', clMid.tx < 0]);
  checks.push(['1.mid.clLeftScale>1', clMid.sx > 1.05]);
  checks.push(['1.mid.crRight>0', crMid.tx > 0]);
  checks.push(['1.mid.crRightScale>1', crMid.sx > 1.05]);
  checks.push(['1.mid.skyScale>1', parseMatrix2D(tMid.sky).sx > 1.01]);
  checks.push(['1.mid.sun>0', tMid.sun > 0.1]);
  // 末段：云彻底滑出（|tx| >= 250px 视口 390 => ~64%）+ 天空淡出
  checks.push(['1.end.clOut', Math.abs(clEnd.tx) >= 250]);
  checks.push(['1.end.crOut', Math.abs(crEnd.tx) >= 250]);
  checks.push(['1.end.fxFade', tEnd.fxOpacity < 0.6]);
  // 省份切换完成
  checks.push(['2.curProv=330000', provState.curProv === '330000']);
  checks.push(['2.mapLevel=province', provState.mapLevel === 'province']);
  checks.push(['2.chartMap=prov_330000', provState.chartMap === 'prov_330000']);
  // 城市 dive：开始时 sheet 隐藏
  checks.push(['3.sheetBeforeHidden', sheetBefore.maskHidden && sheetBefore.sheetHidden]);
  // 200ms 仍隐藏 + dive 已开
  checks.push(['3.sheetAt200Hidden', sheetAt200.maskHidden && sheetAt200.sheetHidden]);
  checks.push(['3.fxDive', sheetAt200.fxDive === true]);
  checks.push(['3.diveX≈0.6', Math.abs(sheetAt200.diveX - 0.6) < 0.001]);
  // 1000ms 时弹层已显示，且标题已写入
  checks.push(['3.sheetAt1000Shown', !sheetAt1000.maskHidden && !sheetAt1000.sheetHidden]);
  checks.push(['3.sheetTitleFilled', sheetAt1000.sheetTitle && sheetAt1000.sheetTitle.length > 0]);
  // 控制台无错误
  checks.push(['4.noErrors', errors.length === 0]);

  let pass = true;
  for (const [k, v] of checks) {
    console.log(`  ${v ? 'OK ' : 'FAIL'}  ${k}`);
    if (!v) pass = false;
  }
  console.log('---');
  console.log('T0  show=', t0.show, 'dive=', t0.dive, 'diveX=', t0.diveX, 'shift=', t0.cloudShift);
  console.log('TMID cl', JSON.stringify(tMid.cl), 'cr', JSON.stringify(tMid.cr), 'sky', JSON.stringify(tMid.sky), 'sun=', tMid.sun, 'fxOp=', tMid.fxOpacity);
  console.log('  parsed clMid =', clMid, ' crMid =', crMid);
  console.log('TEND cl', JSON.stringify(tEnd.cl), 'cr', JSON.stringify(tEnd.cr), 'fxOp=', tEnd.fxOpacity);
  console.log('  parsed clEnd =', clEnd, ' crEnd =', crEnd);
  console.log('PROV', JSON.stringify(provState));
  console.log('SHEET before', JSON.stringify(sheetBefore));
  console.log('SHEET at 200', JSON.stringify(sheetAt200));
  console.log('SHEET at 1000', JSON.stringify(sheetAt1000));
  console.log('ERRORS', JSON.stringify(errors));
  console.log(pass ? 'VERIFY12_PASS' : 'VERIFY12_FAIL');
  process.exit(pass ? 0 : 1);
})();
