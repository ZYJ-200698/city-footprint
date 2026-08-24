/* v1.1 复验：连续色阶（1 城极淡 / 梯度差异）+ 美化页面截图 */
const { chromium } = require('playwright');
const path = require('path');
const OUT = __dirname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const errors = [];
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:8765/index.html');
  await sleep(350); // 启动屏可见期
  await page.screenshot({ path: path.join(OUT, 'v2_shot1_splash.png') });
  await page.waitForFunction(() => window.echarts && document.querySelector('#map canvas'), null, { timeout: 15000 });
  await sleep(1500); // 等 splash 淡出

  // 场景 1：只去过广州 1 城 → 广东应极淡
  await page.evaluate(() => {
    S.records['cn_440100'] = { first: '2026-08-15', times: 1, note: '', photos: [] };
    saveRecords(); showChina();
  });
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, 'v2_shot2_one_city.png') });

  // 场景 2：梯度——广东全省(21/21)、江苏一半(6/13)、浙江 2/11
  await page.evaluate(() => {
    const mark = (adcode, count) => {
      const prov = S.dest.china.find(p => p.adcode === adcode);
      prov.cities.slice(0, count).forEach(c => {
        S.records[c.id] = { first: '2026-08-15', times: 1, note: '', photos: [] };
      });
    };
    mark(440000, 21); mark(320000, 6); mark(330000, 2);
    saveRecords(); showChina();
  });
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, 'v2_shot3_gradient.png') });

  // 校验色值梯度
  const colors = await page.evaluate(() => {
    const g = S.dest.china.find(p => p.adcode === 440000);
    const j = S.dest.china.find(p => p.adcode === 320000);
    const z = S.dest.china.find(p => p.adcode === 330000);
    const b = S.dest.china.find(p => p.adcode === 110000);
    return { 广东全省: provColor(g), 江苏半省: provColor(j), 浙江两城: provColor(z), 北京未去: provColor(b) };
  });
  console.log('colors:', JSON.stringify(colors));

  // 美化后各页面
  await page.evaluate(() => openSheet('cn_440100'));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'v2_shot4_sheet.png') });
  await page.evaluate(() => closeSheets());

  await page.evaluate(() => switchTab('stats'));
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'v2_shot5_stats.png') });

  await page.evaluate(() => switchTab('list'));
  await sleep(500);
  await page.evaluate(() => document.querySelector('.group-head').click());
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'v2_shot6_list.png') });

  await page.evaluate(() => { switchTab('map'); showWorld(); });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'v2_shot7_world.png') });

  await page.evaluate(() => switchTab('me'));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'v2_shot8_me.png') });

  console.log('CONSOLE_ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
