const { chromium } = require('playwright');
const fs = require('fs');

const SHOT = 'C:/Users/ZYJ/Documents/Agent 开发/workspace-013/city-footprint/tests';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' });
  await sleep(1200);
  await page.screenshot({ path: SHOT + '/v3_shot1_map.png' });

  // 标记广州去过
  await page.evaluate(() => { openSheet('cn_440100'); });
  await sleep(300);
  if (!(await page.$eval('#sheet-toggle', el => el.classList.contains('on')))) {
    await page.click('#sheet-toggle');
  }
  await page.fill('#fld-date', '2024-05-12');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(400);

  // 想去：深圳（未去）
  await page.evaluate(() => { openSheet('cn_440300'); });
  await sleep(300);
  await page.click('#sheet-wish');
  await sleep(200);
  const wishOn = await page.$eval('#sheet-wish', el => el.classList.contains('on'));
  await page.evaluate(() => closeSheets());
  await sleep(400);
  console.log('wish toggled on:', wishOn);

  await page.screenshot({ path: SHOT + '/v3_shot2_wish_border.png' });

  // 清单页：验证想去专区
  await page.click('#tabbar button[data-tab="list"]');
  await sleep(400);
  const wishGroup = await page.$('.wish-group');
  console.log('wish group present in list:', !!wishGroup);
  await page.screenshot({ path: SHOT + '/v3_shot3_list_wish.png' });

  // 统计页：环形 + 时间轴 + 分享图
  await page.click('#tabbar button[data-tab="stats"]');
  await sleep(500);
  const ring = await page.$('.ring');
  const tl = await page.$$('.tl-row');
  console.log('ring present:', !!ring, 'timeline rows:', tl.length);
  await page.screenshot({ path: SHOT + '/v3_shot4_stats.png' });

  // 生成分享图并落盘
  const url = await page.evaluate(async () => { return await shareCard(); });
  const b64 = url.split(',')[1];
  fs.writeFileSync(SHOT + '/v3_share.png', Buffer.from(b64, 'base64'));
  console.log('share card bytes:', Buffer.from(b64, 'base64').length);

  // 深色模式
  await page.click('#tabbar button[data-tab="me"]');
  await sleep(300);
  await page.click('#theme-toggle');
  await sleep(400);
  const theme = await page.getAttribute('html', 'data-theme');
  console.log('theme after toggle:', theme);
  await page.click('#tabbar button[data-tab="map"]');
  await sleep(400);
  await page.screenshot({ path: SHOT + '/v3_shot5_dark.png' });

  // 回到统计看深色
  await page.click('#tabbar button[data-tab="stats"]');
  await sleep(400);
  await page.screenshot({ path: SHOT + '/v3_shot6_dark_stats.png' });

  console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
