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
  await sleep(2200);

  // 注入 MutationObserver：记录每一次 #cloud-fx class 变化（含调用栈）
  await page.evaluate(() => {
    const fx = document.getElementById('cloud-fx');
    window.__log = [];
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        const now = Math.round(performance.now());
        const had = m.oldValue ? m.oldValue.split(' ').includes('show') : false;
        const has = fx.classList.contains('show');
        if (had !== has) {
          window.__log.push({ t: now, had, has, stack: new Error().stack.split('\n').slice(1,4).join(' | ') });
        }
      }
    });
    obs.observe(fx, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  });

  console.log('>>> call showProvince');
  await page.evaluate(() => { showProvince('440000'); });

  // 每 150ms 轮询 show 状态，记录首次消失时间
  let firstGone = null;
  for (let i = 0; i < 12; i++) {
    const st = await page.evaluate(() => ({
      show: document.getElementById('cloud-fx').classList.contains('show'),
      t: Math.round(performance.now())
    }));
    console.log(`poll@${st.t} show=${st.show}`);
    if (!st.show && firstGone === null) firstGone = st.t;
    await sleep(150);
  }

  const log = await page.evaluate(() => window.__log);
  console.log('MUTATION_LOG:', JSON.stringify(log, null, 2));
  console.log('FIRST_GONE_AT:', firstGone);
  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
