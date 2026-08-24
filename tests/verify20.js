const { chromium } = require('playwright');
const path = require('path');

const URL = 'http://127.0.0.1:8766/index.html';
const SHOTS = __dirname;
let pass = 0, fail = 0;
function check(name, cond) { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name); }

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);

  // 跳到统计 tab
  await p.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-stats').classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('on'));
    document.querySelector('[data-tab="stats"]').classList.add('on');
    if (typeof renderStats === 'function') renderStats();
  });
  await p.waitForTimeout(400);

  // 1) 两条进度条都在
  const bars = await p.evaluate(() => {
    const cards = document.querySelectorAll('.stat-card.stat-wide');
    return Array.from(cards).map(c => {
      const bar = c.querySelector('.progress');
      const lbl = c.querySelector('.progress-lbl');
      const fill = bar ? bar.querySelector('i') : null;
      return {
        hasBar: !!bar,
        isWorld: bar ? bar.classList.contains('world') : null,
        fillW: fill ? fill.style.width : null,
        lblLeft: lbl ? lbl.querySelector('span:first-child').textContent : null,
        lblRight: lbl ? lbl.querySelector('.progress-pct').textContent : null,
      };
    });
  });
  check('two stat-wide cards rendered', bars.length === 2);
  check('中国卡：进度条存在（非 world）', bars[0] && bars[0].hasBar && bars[0].isWorld === false);
  check('中国卡：标签 = 「探索中国进程」', bars[0] && bars[0].lblLeft === '探索中国进程');
  check('世界卡：进度条存在且为 .world', bars[1] && bars[1].hasBar && bars[1].isWorld === true);
  check('世界卡：标签 = 「探索世界进程」', bars[1] && bars[1].lblRight && bars[1].lblLeft === '探索世界进程');

  // 2) 初始全 0（无记录）
  const initial = await p.evaluate(() => {
    const fills = document.querySelectorAll('.stat-wide .progress i');
    return Array.from(fills).map(f => f.style.width);
  });
  check('initial: both bars at 0%', initial[0] === '0%' && initial[1] === '0%');

  await p.screenshot({ path: path.join(SHOTS, 'v26_stats_progress_empty.png') });

  // 3) 模拟去过的城市：从 S.dest 拿真实 ID 注记录
  const realIds = await p.evaluate(() => {
    // 拿 6 个中国城市（北京 + 5 个河北城市）
    const cnCities = ['cn_110000', 'cn_130100', 'cn_130200', 'cn_130300', 'cn_130400', 'cn_130500'];
    // 拿 1 个世界国家
    const wd = Object.values(S.dest.world || {})[0];
    const wdCities = wd ? wd.cities.slice(0, 1) : [];
    return { cnCities, wdCity: wdCities[0] || null, wdName: wd?.name || null };
  });
  console.log('  using cnIds:', realIds.cnCities, 'wdCity:', realIds.wdCity, 'wdName:', realIds.wdName);
  await p.evaluate(({ cnCities, wdCity }) => {
    const r = {};
    cnCities.forEach((id, i) => { r[id] = { first: `2025-0${(i%9)+1}-15`, times: 1 }; });
    if (wdCity) r[wdCity.id] = { first: '2025-04-01', times: 1 };
    S.records = r;
    renderStats();
  }, realIds);
  await p.waitForTimeout(700);

  const filled = await p.evaluate(() => {
    const fills = document.querySelectorAll('.stat-wide .progress i');
    const lbls = document.querySelectorAll('.stat-wide .progress-lbl .progress-pct');
    const num = document.querySelectorAll('.stat-wide .num');
    return {
      cnW: fills[0] && fills[0].style.width,
      wdW: fills[1] && fills[1].style.width,
      cnTxt: lbls[0] && lbls[0].textContent,
      wdTxt: lbls[1] && lbls[1].textContent,
      cnN: num[0] && num[0].textContent.trim(),
      wdN: num[1] && num[1].textContent.trim(),
    };
  });
  // 不变量：条宽 = 标签里的百分比；条宽 > 0（数据驱动有效）
  const cnPct = parseInt((filled.cnTxt.match(/(\d+)%/) || [])[1] || '0', 10);
  const wdPct = parseInt((filled.wdTxt.match(/(\d+)%/) || [])[1] || '0', 10);
  check('中国条宽 = 标签里的百分比', parseInt(filled.cnW, 10) === cnPct);
  check('世界条宽 = 标签里的百分比', parseInt(filled.wdW, 10) === wdPct);
  check('注入 6 个中国城市后，中国条 % > 0', cnPct > 0);
  check('同时注入 1 个国家后，世界条 % > 0', wdPct > 0);
  check('中国数字 = 2 / 34 省级（北京 + 河北）', filled.cnN.startsWith('2 '));
  check('世界数字 = 1 / 111 国', filled.wdN.startsWith('1 '));

  await p.screenshot({ path: path.join(SHOTS, 'v26_stats_progress_filled.png') });

  check('no console errors', errs.length === 0);
  if (errs.length) console.log('  errors:', errs.slice(0, 3));

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
