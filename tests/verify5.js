const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  const B = 'http://127.0.0.1:8766';
  await page.goto(B, { waitUntil: 'networkidle' });
  await sleep(2200); // 等启动屏消失
  await page.screenshot({ path: 'v5_before.png' });

  // 进入省份 → 触发拨云见日
  await page.evaluate(() => { if (typeof showProvince === 'function') showProvince('440000'); });
  await sleep(280); // 动画中途
  await page.screenshot({ path: 'v5_cloud_prov.png' });
  const leftT  = await page.$eval('#cloud-fx .cloud.left',  el => getComputedStyle(el).transform);
  const rightT = await page.$eval('#cloud-fx .cloud.right', el => getComputedStyle(el).transform);
  const fxShow = await page.$eval('#cloud-fx', el => el.classList.contains('show'));
  await sleep(950);
  await page.screenshot({ path: 'v5_prov_after.png' });

  // 进入城市（记录弹层）→ 再次触发
  await page.evaluate(() => { if (typeof openSheet === 'function') openSheet('cn_440100'); });
  await sleep(280);
  await page.screenshot({ path: 'v5_cloud_city.png' });
  await sleep(950);
  await page.screenshot({ path: 'v5_city_after.png' });

  console.log('ERRORS:', JSON.stringify(errors));
  console.log('CLOUD_FX_SHOW_DURING:', fxShow);
  console.log('CLOUD_LEFT_TRANSFORM:', leftT);
  console.log('CLOUD_RIGHT_TRANSFORM:', rightT);
  await browser.close();
})();
