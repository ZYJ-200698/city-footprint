const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://127.0.0.1:8766', { waitUntil: 'networkidle' });
  try { await page.waitForFunction(() => typeof showProvince === 'function', { timeout: 8000 }); console.log('SHOWPROVINCE_READY: true'); }
  catch { console.log('SHOWPROVINCE_READY: false'); }

  // 关键：等 boot() 完全结束（启动屏已移除），避免与初始 showChina() 的 cloudReveal 竞态
  await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 10000 }).catch(() => {});
  await sleep(300);
  console.log('BOOT_SETTLED, show before trigger =', await page.$eval('#cloud-fx', el => el.classList.contains('show')));

  // ---- 进入省份 ----
  await page.evaluate(() => showProvince('440000'));
  const immShow = await page.$eval('#cloud-fx', el => el.classList.contains('show'));
  await sleep(450); // 动画中段
  const mid = await page.evaluate(() => ({
    show: document.getElementById('cloud-fx').classList.contains('show'),
    layers: [...document.querySelectorAll('#cloud-fx .layer')].map(e => getComputedStyle(e).transform),
    sun: parseFloat(getComputedStyle(document.querySelector('#cloud-fx .sun')).opacity)
  }));
  await page.screenshot({ path: 'v6_cloud_prov.png' });
  console.log('PROV_IMM_SHOW:', immShow);
  console.log('PROV_MID:', JSON.stringify(mid));

  // ---- 进入城市 ----
  await sleep(1000); // 等上一段结束
  await page.evaluate(() => openSheet('cn_440100'));
  const immShow2 = await page.$eval('#cloud-fx', el => el.classList.contains('show'));
  await sleep(450);
  const mid2 = await page.evaluate(() => ({
    show: document.getElementById('cloud-fx').classList.contains('show'),
    layers: [...document.querySelectorAll('#cloud-fx .layer')].map(e => getComputedStyle(e).transform),
    sun: parseFloat(getComputedStyle(document.querySelector('#cloud-fx .sun')).opacity)
  }));
  await page.screenshot({ path: 'v6_cloud_city.png' });
  console.log('CITY_IMM_SHOW:', immShow2);
  console.log('CITY_MID:', JSON.stringify(mid2));

  console.log('ERRORS:', JSON.stringify(errors));

  // ---- 断言 ----
  const txVals = arr => arr.map(t => { const m = t.match(/matrix\(1, 0, 0, 1, (-?[\d.]+), 0\)/); return m ? parseFloat(m[1]) : null; });
  const provTx = txVals(mid.layers);
  const cityTx = txVals(mid2.layers);
  const ok =
    immShow && immShow2 &&
    mid.show && mid2.show &&
    errors.length === 0 &&
    // 前层左云应明显左移(负)、右云明显右移(正)
    provTx[2] < -30 && provTx[3] > 30 &&
    cityTx[2] < -30 && cityTx[3] > 30 &&
    // 见日光晕中段应可见
    mid.sun > 0.05 && mid2.sun > 0.05;
  console.log('ASSERT_PROV_TX:', JSON.stringify(provTx));
  console.log('ASSERT_CITY_TX:', JSON.stringify(cityTx));
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');

  await browser.close();
  process.exit(ok ? 0 : 1);
})();
