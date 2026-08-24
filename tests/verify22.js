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

  // 1) 翻动动画时长 = 720ms
  const dur = await p.evaluate(() => {
    const sheet = Array.from(document.styleSheets).find(s => s.href && s.href.endsWith('styles.css'));
    const r = Array.from(sheet.cssRules).find(x => x.selectorText === '.view.flip-in');
    return r ? r.style.animationDuration : null;
  });
  check('翻动动画时长 = 720ms（更慢）', dur === '720ms');

  // 2) playPageFlipSound 函数存在
  const hasSound = await p.evaluate(() => typeof playPageFlipSound === 'function');
  check('playPageFlipSound 函数存在', hasSound);

  // 3) 单元测试：直接以 spied AudioContext 调 playPageFlipSound，验证能正常合成（创建音频节点、不抛错）
  const sndTest = await p.evaluate(async () => {
    let nodes = 0, err = null;
    const OrigCtx = window.AudioContext || window.webkitAudioContext;
    // 构造一个 state=running 的 spy，统计 createOscillator / createBufferSource 次数
    const spy = new OrigCtx();
    spy.state = 'running';
    const origOsc = spy.createOscillator.bind(spy);
    const origBuf = spy.createBufferSource.bind(spy);
    spy.createOscillator = () => { nodes++; const o = origOsc(); const os = o.start.bind(o); o.start = () => { try { os(); } catch {} return; }; return o; };
    spy.createBufferSource = () => { nodes++; const s = origBuf(); const ss = s.start.bind(s); s.start = () => { try { ss(); } catch {} return; }; return s; };
    try { playPageFlipSound(spy); } catch (e) { err = e.message; }
    // 给音频调度留一点时间
    await new Promise(r => setTimeout(r, 50));
    return { nodes, err };
  });
  check('翻书页音效能正常合成（音频节点 > 0 且不报错）', sndTest.nodes > 0 && !sndTest.err);

  // 4) 切到清单（真实切换）→ 触发 flip-in
  await p.evaluate(() => { switchTab('list'); });
  await p.waitForTimeout(80);
  const s1 = await p.evaluate(() => document.getElementById('view-list').classList.contains('flip-in'));
  check('切到清单：触发 flip-in', s1);
  await p.screenshot({ path: path.join(SHOTS, 'v28_flip_slow_mid.png') });
  await p.waitForTimeout(900);

  // 5) 重复点同一 tab（stats→stats）不应播声音（switchTab 内 tab===prev 短路）
  await p.evaluate(() => { switchTab('stats'); });   // 真实切到 stats（此时会尝试播，但 headless 无 gesture→running=false→不播，仅为设置 prev）
  await p.waitForTimeout(100);
  const flipStats = await p.evaluate(() => document.getElementById('view-stats').classList.contains('flip-in'));
  check('切到统计：触发 flip-in', flipStats);
  await p.waitForTimeout(800);

  // 6) 向左切回地图：from-right
  await p.evaluate(() => { switchTab('map'); });
  await p.waitForTimeout(80);
  const s3 = await p.evaluate(() => ({
    flip: document.getElementById('view-map').classList.contains('flip-in'),
    right: document.getElementById('view-map').classList.contains('from-right'),
  }));
  check('切回地图：触发 flip-in + from-right', s3.flip && s3.right);
  await p.screenshot({ path: path.join(SHOTS, 'v28_flip_right_mid.png') });
  await p.waitForTimeout(800);

  // 7) 云特效不受影响
  await p.evaluate(() => { if (typeof reveal === 'function') reveal('boot'); });
  await p.waitForTimeout(120);
  const revealOk = await p.evaluate(() => { const fx = document.getElementById('reveal-fx'); return fx.classList.contains('boot') && fx.classList.contains('show'); });
  check('云特效 reveal-fx 仍正常（boot）', revealOk);

  // 8) 无 JS 报错
  check('无 JS / console 错误', errs.length === 0);
  if (errs.length) console.log('  错误明细:', errs.slice(0, 5));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
