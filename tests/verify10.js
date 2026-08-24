const { chromium } = require('playwright');
const EXE = 'C:/Users/ZYJ/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
const URL = 'http://127.0.0.1:8766/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const errors = [];
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof reveal === 'function' && !document.getElementById('splash'));

  // 屏幕宽度用于换算 % → px
  const VW = 390;
  const tx = m => { const n = m.match(/matrix\(([^)]+)\)/); if (!n) return null; return parseFloat(n[1].split(',')[4]); };

  // 触发：直接调用 reveal()（避免启动 boot 残留定时器干扰采样），单一干净定时器
  await page.evaluate(() => reveal());
  const applied = await page.evaluate(() => document.getElementById('reveal-fx').classList.contains('show'));

  // 中段 500ms：云正在拨开（应在屏内）
  await sleep(500);
  const mid = await page.evaluate(() => {
    const cl = getComputedStyle(document.querySelector('#reveal-fx .c-left')).transform;
    const cr = getComputedStyle(document.querySelector('#reveal-fx .c-right')).transform;
    return { cl, cr, fxOpacity: getComputedStyle(document.getElementById('reveal-fx')).opacity };
  });

  // 近末端 1150ms：云应已完全滑出屏幕（|translateX| ≥ 片宽253px），天空正在淡出
  await sleep(650);
  const late = await page.evaluate(() => {
    const cl = getComputedStyle(document.querySelector('#reveal-fx .c-left')).transform;
    const cr = getComputedStyle(document.querySelector('#reveal-fx .c-right')).transform;
    return {
      clTx: (() => { const m = cl.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[4]) : null; })(),
      crTx: (() => { const m = cr.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[4]) : null; })(),
      fxOpacity: getComputedStyle(document.getElementById('reveal-fx')).opacity,
      show: document.getElementById('reveal-fx').classList.contains('show')
    };
  });

  // 末端 1450ms：天空应已淡出至 opacity≈0（地图平滑露出），show 仍在（淡出承担揭示，而非 display:none 硬切）
  await sleep(300);
  const end = await page.evaluate(() => {
    const op = parseFloat(getComputedStyle(document.getElementById('reveal-fx')).opacity);
    return { fxOpacity: op, show: document.getElementById('reveal-fx').classList.contains('show') };
  });

  // 终末 1650ms：定时器(1500ms)已移除 show，但此时 opacity 早已为 0，移除不可见（无硬切）
  await sleep(200);
  const closed = await page.evaluate(() => ({
    show: document.getElementById('reveal-fx').classList.contains('show')
  }));

  await browser.close();

  const cloudW = 0.65 * VW; // 253.5px；云完全离开视口需 |tx| ≥ cloudW
  const PASS =
    applied === true &&
    tx(mid.cl) < -50 && tx(mid.cr) > 50 && parseFloat(mid.fxOpacity) > 0.9 &&  // 中段：正在拨开且天空满亮
    Math.abs(late.clTx) >= cloudW && Math.abs(late.crTx) >= cloudW &&          // 末端：云已彻底滑出（全部拨开）
    late.fxOpacity < 0.6 && late.fxOpacity > 0.05 && late.show === true &&     // 此时天空正在淡出、show 仍在
    end.fxOpacity < 0.05 && end.show === true &&                              // 天空完全淡出、地图露出
    closed.show === false &&                                                  // 定时器最终移除 show
    errors.length === 0;

  console.log('APPLIED:', applied);
  console.log('MID:', JSON.stringify(mid), 'clTx=', tx(mid.cl), 'crTx=', tx(mid.cr));
  console.log('LATE:', JSON.stringify(late), '(cloudW needs >=', cloudW.toFixed(0) + 'px)');
  console.log('END:', JSON.stringify(end));
  console.log('CLOSED:', JSON.stringify(closed));
  console.log('ERRORS:', JSON.stringify(errors));
  console.log(PASS ? 'VERIFY10_PASS' : 'VERIFY10_FAIL');
  process.exit(PASS ? 0 : 1);
})();
