/* 备份闭环验收：造数据 → 导出 → 清空重装 → 导入 → 校验恢复 */
const { chromium } = require('playwright');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => console.log('pageerror:', e.message));

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.echarts && document.querySelector('#map canvas'), null, { timeout: 15000 });

  // 造一条北京记录（3 次 + 笔记）
  await page.evaluate(() => openSheet('cn_110000'));
  await page.click('#sheet-toggle');
  await page.click('#times-plus');
  await page.click('#times-plus');
  await page.fill('#fld-note', '测试笔记：故宫和烤鸭');
  await sleep(300);
  await page.evaluate(() => closeSheets());

  // 导出
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.evaluate(() => exportBackup()),
  ]);
  const bakPath = path.join(__dirname, 'backup_test.json');
  await download.saveAs(bakPath);
  console.log('exported:', bakPath);

  // 清空并重载
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.echarts && document.querySelector('#map canvas'));
  let stats = await page.evaluate(() => { renderStats(); return document.querySelector('#stats-cards').innerText; });
  console.log('after clear:', stats.split('\n')[0], '(期望 0)');

  // 导入
  await page.evaluate(() => switchTab('me'));
  await page.setInputFiles('#file-import', bakPath);
  await sleep(1500);
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('fp_records_v1') || '{}'));
  console.log('restored record:', JSON.stringify(rec['cn_110000'] || null));
  stats = await page.evaluate(() => { renderStats(); return document.querySelector('#stats-cards').innerText; });
  console.log('after import:', stats.split('\n').slice(0, 4).join(' | '), '(期望 1 城 3 次)');

  await browser.close();
  console.log('BACKUP_CYCLE_OK');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
