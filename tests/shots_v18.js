const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'http://127.0.0.1:8766/';
const EXE = 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';

// 每次单独加载页面，从 0 触发并截到目标时刻，规避 headless 单次会话动画冻结
async function shot(name, delay) {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof reveal === 'function' && !document.getElementById('splash'));
  await page.evaluate(() => reveal());
  await sleep(delay);
  await page.screenshot({ path: `tests/${name}.png` });
  await browser.close();
  console.log(name, 'done');
}

(async () => {
  await shot('v18_closed', 120);   // 云闭拢，金边中缝，太阳初亮
  await shot('v18_mid', 600);      // 云向两侧拨开（动画 1.1s 中段约 55%）
  await shot('v18_reveal', 1280);  // 云已离屏，天空淡出，地图显露
})();
