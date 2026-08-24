/* 城市足迹 · 真实渲染验收脚本（iPhone 视口 + 系统 Edge） */
const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname);
const BASE = 'http://127.0.0.1:8765/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const errors = [];
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.echarts && document.querySelector('#map canvas'), null, { timeout: 15000 });
  await sleep(800);

  // 1. 全国地图
  await page.screenshot({ path: path.join(OUT, 'shot1_national.png') });

  // 2. 钻取广东省（走真实代码路径：fetch + registerMap + 渲染）
  await page.evaluate(() => showProvince(440000));
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'shot2_province.png') });

  // 3. 打开广州记录弹层并标记去过
  await page.evaluate(() => openSheet('cn_440100'));
  await sleep(400);
  await page.click('#sheet-toggle');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'shot3_sheet.png') });

  // 校验记录已写入 localStorage
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('fp_records_v1') || '{}'));
  console.log('record cn_440100:', JSON.stringify(rec['cn_440100'] || null));

  // 再标记深圳，关闭弹层看省级地图点亮
  await page.evaluate(() => closeSheets());
  await sleep(300);
  await page.evaluate(() => openSheet('cn_440300'));
  await sleep(300);
  await page.click('#sheet-toggle');
  await sleep(300);
  await page.evaluate(() => closeSheets());
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'shot4_province_marked.png') });

  // 4. 返回全国 → 广东应着色
  await page.evaluate(() => showChina());
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'shot5_national_marked.png') });

  // 5. 世界地图 + 国家弹层
  await page.evaluate(() => showWorld());
  await sleep(1000);
  await page.evaluate(() => openCountrySheet(IDX.countryByEn['Japan']));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'shot6_world_country.png') });
  await page.evaluate(() => closeSheets());

  // 6. 清单视图（搜索）
  await page.evaluate(() => switchTab('list'));
  await sleep(500);
  await page.fill('#search', '广州');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'shot7_list_search.png') });

  // 7. 统计视图
  await page.evaluate(() => { document.querySelector('#search').value = ''; switchTab('stats'); });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'shot8_stats.png') });
  const statsText = await page.evaluate(() => document.querySelector('#stats-cards').innerText);
  console.log('stats:', statsText.replace(/\n+/g, ' | '));

  // 8. 我的视图
  await page.evaluate(() => switchTab('me'));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'shot9_me.png') });

  console.log('CONSOLE_ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
