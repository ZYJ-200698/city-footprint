const { chromium } = require('playwright');
const EXE = 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
const URL = 'http://127.0.0.1:8766/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shotAt(browser, t, name) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof reveal === 'function' && !document.getElementById('splash'));
  await page.evaluate(() => reveal());
  await sleep(t);
  await page.screenshot({ path: name });
  await page.close();
  console.log('shot', name, '@', t, 'ms');
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  await shotAt(browser, 120,  'tests/v17_cover.png');   // 云团闭拢、即将拨开
  await shotAt(browser, 520,  'tests/v17_mid.png');     // 中段：两片云向两侧拨开，中央见日
  await shotAt(browser, 1150, 'tests/v17_reveal.png');  // 末端：云已滑出、天空淡出、地图露出
  await browser.close();
  console.log('DONE');
})();
