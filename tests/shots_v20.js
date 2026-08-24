/* shots_v20.js — v2.0 穿云俯冲视觉验收
   每个场景独立加载页面（headless 单会话动画后期会冻结），
   截取关键帧：云团刚开始出现、云团冲到镜头前、云团冲过、收尾见地图。 */
const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const shots = [
    // boot 俯冲四帧
    { name: 'v20_boot_early.png',   t: 60,   fn: 'reveal()',      setup: 'boot' },
    { name: 'v20_boot_peak.png',    t: 480,  fn: 'reveal()',      setup: 'boot' },
    { name: 'v20_boot_passing.png', t: 900,  fn: 'reveal()',      setup: 'boot' },
    { name: 'v20_boot_end.png',     t: 1700, fn: 'reveal()',      setup: 'boot' },
    // 省份俯冲三帧
    { name: 'v20_prov_peak.png',    t: 500,  fn: 'showProvince(330000)', setup: 'prov' },
    { name: 'v20_prov_passing.png', t: 900,  fn: 'showProvince(330000)', setup: 'prov' },
    { name: 'v20_prov_end.png',     t: 1900, fn: 'showProvince(330000)', setup: 'prov' },
    // 城市俯冲三帧
    { name: 'v20_city_peak.png',    t: 500,  fn: "openSheet('CN330100',{dive:true})", setup: 'city' },
    { name: 'v20_city_passing.png', t: 950,  fn: "openSheet('CN330100',{dive:true})", setup: 'city' },
    { name: 'v20_city_end.png',     t: 1200, fn: "openSheet('CN330100',{dive:true})", setup: 'city' },
  ];

  for (const s of shots) {
    const ctx = await browser.newContext({
      ...devices['iPhone 13'],
      serviceWorkers: 'block',
    });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8766/?_=' + Date.now() + '_' + s.name, { waitUntil: 'load' });
    // 等启动屏 + 初始 reveal 收尾
    await page.waitForTimeout(3200);

    if (s.setup === 'prov') {
      // 先让页面进入中国国家级
      await page.evaluate(async () => {
        if (typeof window.showChina === 'function') await window.showChina();
      });
      await page.waitForTimeout(400);
    } else if (s.setup === 'city') {
      // 先到浙江省
      await page.evaluate(async () => {
        if (typeof window.showChina === 'function') await window.showChina();
        await window.showProvince(330000);
      });
      await page.waitForTimeout(2000);
    }

    // 触发对应动作
    await page.evaluate((src) => { eval(src); }, s.fn);
    await page.waitForTimeout(s.t);
    await page.screenshot({ path: 'tests/' + s.name });
    console.log('shot', s.name, 'at t=' + s.t + 'ms');
    await ctx.close();
  }

  await browser.close();
  console.log('all shots saved');
})();
