const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'http://127.0.0.1:8766/';
const tx = m => { const n = m.match(/matrix\(([^)]+)\)/); if (!n) return null; return parseFloat(n[1].split(',')[4]); };

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof reveal === 'function' && !document.getElementById('splash'));

  // 直接调用 reveal()（干净单一定时器，规避 boot 残留竞态）
  await page.evaluate(() => reveal());

  const applied = await page.evaluate(() => document.getElementById('reveal-fx').classList.contains('show'));
  await sleep(120);
  const start = await page.evaluate(() => ({
    fxOpacity: parseFloat(getComputedStyle(document.getElementById('reveal-fx')).opacity),
    bg: getComputedStyle(document.querySelector('#reveal-fx .c-left')).backgroundImage.slice(0, 60),
    sun: parseFloat(getComputedStyle(document.querySelector('#reveal-fx .sun')).opacity)
  }));
  await sleep(400); // ~520ms 中段
  const mid = await page.evaluate(() => ({
    cl: getComputedStyle(document.querySelector('#reveal-fx .c-left')).transform,
    cr: getComputedStyle(document.querySelector('#reveal-fx .c-right')).transform,
    fxOpacity: parseFloat(getComputedStyle(document.getElementById('reveal-fx')).opacity),
    sun: parseFloat(getComputedStyle(document.querySelector('#reveal-fx .sun')).opacity)
  }));
  // 在 Node 端从 transform 字符串解析位移
  mid.clTx = tx(mid.cl); mid.crTx = tx(mid.cr);
  await sleep(630); // ~1150ms 末段（云已离屏，天空淡出中/已淡出）
  const late = await page.evaluate(() => ({
    cl: getComputedStyle(document.querySelector('#reveal-fx .c-left')).transform,
    cr: getComputedStyle(document.querySelector('#reveal-fx .c-right')).transform,
    fxOpacity: parseFloat(getComputedStyle(document.getElementById('reveal-fx')).opacity)
  }));
  late.clTx = tx(late.cl); late.crTx = tx(late.cr);

  await browser.close();

  const PASS =
    applied === true &&
    start.bg.includes('cloud_l.png') &&           // 写实云贴图已加载
    tx(mid.cl) < -40 && tx(mid.cr) > 40 &&        // 中段：云正在向两侧拨开
    Math.abs(late.clTx) >= 254 && Math.abs(late.crTx) >= 254 &&  // 末段：云完全滑出（全部拨开）
    late.fxOpacity < 0.6 &&                       // 天空正在淡出（不再硬切）
    errors.length === 0;

  console.log('APPLIED:', applied);
  console.log('START:', JSON.stringify(start));
  console.log('MID cl/cr tx =', tx(mid.cl), tx(mid.cr), 'fxOpacity=', mid.fxOpacity, 'sun=', mid.sun);
  console.log('LATE cl/cr tx =', late.clTx, late.crTx, 'fxOpacity=', late.fxOpacity);
  console.log('ERRORS:', JSON.stringify(errors));
  console.log(PASS ? 'VERIFY11_PASS' : 'VERIFY11_FAIL');
  process.exit(PASS ? 0 : 1);
})();
