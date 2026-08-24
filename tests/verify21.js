const { chromium } = require('playwright');
const path = require('path');

const URL = 'http://127.0.0.1:8766/index.html';
const SHOTS = __dirname;
let pass = 0, fail = 0;
function check(name, cond) { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name); }

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);

  // 1) CSS：pageTurn / pageTurnR / pageShade 关键帧 + #main perspective 存在
  const css = await p.evaluate(async () => {
    const sheet = Array.from(document.styleSheets).find(s => {
      try { return s.href && s.href.endsWith('styles.css'); } catch { return false; }
    });
    let rules = '';
    if (sheet) { try { rules = Array.from(sheet.cssRules).map(r => r.cssText).join('\n'); } catch {} }
    const mainPer = getComputedStyle(document.getElementById('main')).perspective;
    return { rules, mainPer };
  });
  check('#main perspective 已设置', css.mainPer !== 'none' && css.mainPer !== '');
  check('@keyframes pageTurn 存在', css.rules.includes('@keyframes pageTurn'));
  check('@keyframes pageTurnR 存在', css.rules.includes('@keyframes pageTurnR'));
  check('@keyframes pageShade 存在', css.rules.includes('@keyframes pageShade'));
  check('.view.flip-in 动画规则存在', /animation:\s*[^;]*pageTurn/.test(css.rules));

  // 2) 切换到「清单」：incoming view 应带 flip-in + 方向（map->list 向右 → from-left）
  await p.evaluate(() => switchTab('list'));
  await p.waitForTimeout(60);
  const flip1 = await p.evaluate(() => {
    const v = document.getElementById('view-list');
    return { has: v.classList.contains('flip-in'), dir: v.classList.contains('from-left') ? 'from-left' : (v.classList.contains('from-right') ? 'from-right' : null), visible: !v.classList.contains('hidden') };
  });
  check('切到清单：view-list 显示', flip1.visible);
  check('切到清单：触发 flip-in', flip1.has);
  check('切到清单：方向为 from-left（向右切）', flip1.dir === 'from-left');
  await p.screenshot({ path: path.join(SHOTS, 'v27_flip_list_mid.png') });
  await p.waitForTimeout(500);

  // 3) 再切到「统计」（list->stats 仍向右 → from-left）
  await p.evaluate(() => switchTab('stats'));
  await p.waitForTimeout(60);
  const flip2 = await p.evaluate(() => {
    const v = document.getElementById('view-stats');
    return { has: v.classList.contains('flip-in'), dir: v.classList.contains('from-left') ? 'from-left' : (v.classList.contains('from-right') ? 'from-right' : null) };
  });
  check('切到统计：触发 flip-in + from-left', flip2.has && flip2.dir === 'from-left');
  await p.waitForTimeout(500);

  // 4) 向左切回「地图」（stats->map 向左 → from-right）
  await p.evaluate(() => switchTab('map'));
  await p.waitForTimeout(60);
  const flip3 = await p.evaluate(() => {
    const v = document.getElementById('view-map');
    return { has: v.classList.contains('flip-in'), dir: v.classList.contains('from-right') ? 'from-right' : (v.classList.contains('from-left') ? 'from-left' : null) };
  });
  check('切回地图：触发 flip-in + from-right（向左切）', flip3.has && flip3.dir === 'from-right');
  await p.screenshot({ path: path.join(SHOTS, 'v27_flip_map_right.png') });
  await p.waitForTimeout(500);

  // 5) 云特效（reveal-fx）不受影响：点击省份仍触发 reveal('boot')
  await p.evaluate(() => { if (typeof showChina === 'function') showChina(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { if (typeof reveal === 'function') reveal('boot'); });
  await p.waitForTimeout(120);
  const revealOk = await p.evaluate(() => {
    const fx = document.getElementById('reveal-fx');
    return fx && fx.classList.contains('boot') && fx.classList.contains('show');
  });
  check('云特效 reveal-fx 仍正常触发（boot）', revealOk);
  await p.screenshot({ path: path.join(SHOTS, 'v27_reveal_still_ok.png') });
  await p.waitForTimeout(800);

  // 6) 进场动画结束：约 460ms 后 flip-in 仍在 class 上（保持 final 帧），不残留 display 问题
  const after = await p.evaluate(() => {
    const v = document.getElementById('view-map');
    return { hasFlip: v.classList.contains('flip-in'), hidden: v.classList.contains('hidden') };
  });
  check('动画结束后 view-map 仍可见且保留 flip-in 类', after.hidden === false && after.hasFlip === true);

  // 7) 无 JS 报错 / console error
  check('无 JS / console 错误', errs.length === 0);
  if (errs.length) console.log('  错误明细:', errs.slice(0, 5));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
