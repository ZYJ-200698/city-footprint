/* v1.9 截图：点开省份（dive）与点开城市（dive）的中段与末段画面。
   每次独立加载页面（规避 headless 单次会话动画后期冻结）。 */
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'http://127.0.0.1:8766/';
const EXE = 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';

async function setup() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof reveal === 'function' && !document.getElementById('splash'));
  await sleep(1700); // 等 boot reveal 结束
  return { browser, page };
}

// 省份 dive：tapX=0.3 偏左，看云朵从偏左位置冲过镜头
async function shotProv(name, delay) {
  const { browser, page } = await setup();
  await page.evaluate(() => showProvince('330000', 0.3));
  await sleep(delay);
  await page.screenshot({ path: `tests/${name}.png` });
  await browser.close();
  console.log(name, 'done');
}

// 城市 dive：tapX=0.6 偏右
async function shotCity(name, delay) {
  const { browser, page } = await setup();
  // 先切到浙江（让 onMapClick 走的同一条链路也能验证：点省份→点城市）
  await page.evaluate(() => showProvince('330000', 0.3));
  await sleep(1700);
  const cityId = await page.evaluate(() => IDX.provByAdcode['330000'].cities[0].id);
  await page.evaluate((id) => openSheet(id, { dive: true, tapX: 0.6 }), cityId);
  await sleep(delay);
  await page.screenshot({ path: `tests/${name}.png` });
  await browser.close();
  console.log(name, 'done');
}

(async () => {
  // 省份 dive 中段：云朵正在冲过镜头（放大+外推），落点偏左
  await shotProv('v19_prov_dive_mid', 400);
  // 省份 dive 末段：云已离屏、天空淡出，浙江地图显出
  await shotProv('v19_prov_dive_end', 1280);
  // 城市 dive 中段：云朵从偏右冲过镜头，弹层尚未升起
  await shotCity('v19_city_dive_mid', 400);
  // 城市 dive 末段：云已拨开，弹层从底部升起
  await shotCity('v19_city_dive_end', 950);
})();
