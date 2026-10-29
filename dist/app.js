/* 城市足迹 · 主逻辑（无框架，依赖 echarts） */
'use strict';

/* ================= 全局状态 ================= */
const S = {
  dest: null,               // destinations.json
  records: {},              // { destId: {first, times, note, photos:[pid]} }
  wish: {},                 // { destId: true } 想去的地方
  theme: 'light',           // light | dark
  tab: 'map',
  mapScope: 'china',        // china | world
  mapLevel: 'national',     // national | province （世界模式恒为 national）
  curProv: null,            // 当前省份 adcode
  chart: null,
  cityMaps: {},             // adcode -> geojson（已加载的省级图）
  sheetDest: null,          // 弹层编辑中的 destId
  sheetCountry: null,       // 国家弹层当前国家
  photoURLs: {},            // pid -> objectURL
  _shareURL: null,          // 调试/测试用：最近一次生成的分享图 dataURL
};

const REC_KEY = 'fp_records_v1';
const WISH_KEY = 'fp_wish_v1';
const THEME_KEY = 'fp_theme_v1';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ================= 索引 ================= */
const IDX = { provByAdcode: {}, provByName: {}, cityById: {}, cityNameById: {}, countryByEn: {}, destName: {} };

function buildIndex() {
  for (const p of S.dest.china) {
    IDX.provByAdcode[p.adcode] = p;
    IDX.provByName[p.name] = p;
    for (const c of p.cities) {
      IDX.cityById[c.id] = { ...c, prov: p };
      IDX.cityNameById[c.id] = c.name;
      IDX.destName[c.id] = c.name;
    }
  }
  for (const c of S.dest.world) {
    if (c.en === 'China') continue; // 国内走中国地图
    IDX.countryByEn[c.en] = c;
    for (const city of c.cities) {
      IDX.cityById[city.id] = { ...city, country: c };
      IDX.destName[city.id] = city.name;
    }
  }
}

/* ================= 记录存储（localStorage） ================= */
function loadRecords() {
  try { S.records = JSON.parse(localStorage.getItem(REC_KEY) || '{}'); }
  catch { S.records = {}; }
}
function saveRecords() {
  localStorage.setItem(REC_KEY, JSON.stringify(S.records));
}
function isVisited(id) { return !!S.records[id]; }

/* 想去的地方（愿望清单） */
function loadWish() {
  try { S.wish = JSON.parse(localStorage.getItem(WISH_KEY) || '{}'); }
  catch { S.wish = {}; }
}
function saveWish() { localStorage.setItem(WISH_KEY, JSON.stringify(S.wish)); }
function isWished(id) { return !!S.wish[id]; }
function toggleWish(id) {
  if (S.wish[id]) delete S.wish[id]; else S.wish[id] = true;
  saveWish();
}

/* 主题 */
function loadTheme() {
  S.theme = localStorage.getItem(THEME_KEY) || 'light';
}
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  const t = $('#theme-toggle');
  if (t) { t.classList.toggle('on', S.theme === 'dark'); t.setAttribute('aria-checked', String(S.theme === 'dark')); }
}
/* 按主题返回地图配色 */
function mapPalette() {
  if (S.theme === 'dark') {
    return { off: '#2A3142', border: '#3A4256', label: '#9AA4B8', emphasis: '#3D6FB0' };
  }
  return { off: '#E8ECF3', border: '#FFFFFF', label: '#5A6270', emphasis: '#90CAF9' };
}
function provStats(p) {
  let v = 0;
  for (const c of p.cities) if (isVisited(c.id)) v++;
  return { v, n: p.cities.length };
}
function countryStats(c) {
  let v = 0;
  for (const city of c.cities) if (isVisited(city.id)) v++;
  return { v, n: c.cities.length };
}

/* ================= 照片存储（IndexedDB） ================= */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('fp-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
      req.onsuccess = () => { idb.db = req.result; res(); };
      req.onerror = () => rej(req.error);
    });
  },
  put(photo) {
    return new Promise((res, rej) => {
      const tx = idb.db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(photo);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  },
  get(id) {
    return new Promise((res) => {
      const tx = idb.db.transaction('photos', 'readonly');
      const req = tx.objectStore('photos').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  },
  del(id) {
    return new Promise((res) => {
      const tx = idb.db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(id);
      tx.oncomplete = res;
    });
  },
  all() {
    return new Promise((res) => {
      const tx = idb.db.transaction('photos', 'readonly');
      const req = tx.objectStore('photos').getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });
  },
};

async function photoURL(pid) {
  if (S.photoURLs[pid]) return S.photoURLs[pid];
  const rec = await idb.get(pid);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  S.photoURLs[pid] = url;
  return url;
}

/* ================= 工具 ================= */
function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.add('hidden'), ms);
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/* 省份着色：按「已去城市数/全省城市数」连续插值。
   低比例段极淡（去 1 城近乎未点亮），足迹越密颜色越饱满。 */
const C_OFF = '#E8ECF3';
const C_BORDER = '#FFFFFF';
const COLOR_STOPS = [
  [0.00, [232, 236, 243]],   // 未去过：灰蓝
  [0.05, [246, 234, 222]],   // 仅一两城：极淡暖白
  [0.15, [252, 213, 178]],
  [0.35, [250, 171, 120]],
  [0.60, [247, 127, 72]],
  [0.85, [239, 83, 30]],
  [1.00, [198, 40, 40]],     // 全省走遍：深红
];
function lerpStops(t) {
  if (t <= 0) return COLOR_STOPS[0][1];
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    if (t <= COLOR_STOPS[i][0]) {
      const [t0, c0] = COLOR_STOPS[i - 1];
      const [t1, c1] = COLOR_STOPS[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((a, j) => Math.round(a + (c1[j] - a) * k));
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}
function provColor(p) {
  const { v, n } = provStats(p);
  const [r, g, b] = lerpStops(v / n);
  return `rgb(${r},${g},${b})`;
}
const C_CITY_ON = '#FF7043';

/* ================= 地图 ================= */
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`加载失败: ${url}`);
  return r.json();
}

function baseMapOption() {
  const pal = mapPalette();
  return {
    animation: false,
    tooltip: { show: false },
    series: [{
      type: 'map', roam: true, scaleLimit: { min: 0.8, max: 8 },
      zoom: 1, selectedMode: false,
      label: { show: false },
      itemStyle: { areaColor: pal.off, borderColor: pal.border, borderWidth: 0.6 },
      emphasis: { label: { show: false }, itemStyle: { areaColor: pal.emphasis } },
      data: [],
    }],
  };
}

async function showChina({ silent = false, fxMode = 'boot' } = {}) {
  if (!silent) reveal(fxMode);   // 启动/进入全国走 boot（张开）；从省份/世界返回全国走 close（闭上）
  S.mapScope = 'china'; S.mapLevel = 'national'; S.curProv = null;
  setTopbar('城市足迹', false, true);
  const opt = baseMapOption();
  opt.series[0].map = 'china';
  opt.series[0].data = S.dest.china.map(p => ({
    name: p.name, itemStyle: provItemStyle(p),
  }));
  S.chart.setOption(opt, true);
  $('#map-hint').textContent = '点击省份，点亮你的足迹';
}

/* 省份区块样式：已去按密度着色；含「想去」未去城市则加蓝色虚线描边 */
function provItemStyle(p) {
  const pal = mapPalette();
  const style = { areaColor: provColor(p) };
  const hasWish = p.cities.some(c => isWished(c.id) && !isVisited(c.id));
  if (hasWish) { style.borderColor = '#1E88E5'; style.borderWidth = 1.6; style.borderType = 'dashed'; }
  else { style.borderColor = pal.border; style.borderWidth = 0.6; }
  return style;
}

async function showProvince(adcode) {
  // 云波雾散 / 拨云见日：开云雾散后露出加载好的省级地图，营造"飞入省份"的感觉
  reveal('boot');
  const prov = IDX.provByAdcode[adcode];
  if (!prov) return;
  if (!S.cityMaps[adcode]) {
    S.cityMaps[adcode] = await fetchJSON(`assets/geo/city/${adcode}.json`);
    echarts.registerMap('prov_' + adcode, S.cityMaps[adcode]);
  }
  S.mapLevel = 'province'; S.curProv = adcode;
  setTopbar(prov.name, true, false);
  renderProvData(prov, true);
  $('#map-hint').textContent = prov.cities.length > 1 ? '点击城市标记去过' : '点击地图标记去过';
}

function renderProvData(prov, fresh) {
  const pal = mapPalette();
  const opt = baseMapOption();
  opt.series[0].map = 'prov_' + prov.adcode;
  opt.series[0].label = prov.cities.length > 1
    ? { show: true, fontSize: 9, color: pal.label } : { show: false };
  opt.series[0].data = prov.cities.map(c => {
    const style = { areaColor: isVisited(c.id) ? C_CITY_ON : pal.off };
    if (isWished(c.id) && !isVisited(c.id)) {
      style.borderColor = '#1E88E5'; style.borderWidth = 2; style.borderType = 'dashed';
    }
    return { name: prov.cities.length > 1 ? c.name : prov.name, itemStyle: style };
  });
  S.chart.setOption(opt, fresh); // fresh=true 全量重绘(notMerge)；否则合并保留缩放位置
}

async function showWorld({ fxMode = 'boot' } = {}) {
  reveal(fxMode);   // 进入世界走 boot（张开）；从世界返回全国走 close（闭上）
  S.mapScope = 'world'; S.mapLevel = 'national'; S.curProv = null;
  setTopbar('世界足迹', false, true);
  renderWorldData(true);
  $('#map-hint').textContent = '点击国家，标记去过的城市';
}

function renderWorldData(fresh) {
  const pal = mapPalette();
  const opt = baseMapOption();
  opt.series[0].map = 'world';
  const cnVisited = S.dest.china.some(p => provStats(p).v > 0);
  const cnWish = S.dest.china.some(p => p.cities.some(c => isWished(c.id) && !isVisited(c.id)));
  const data = [{ name: 'China', itemStyle: countryItemStyle('China', cnVisited, cnWish, pal) }];
  for (const en in IDX.countryByEn) {
    const c = IDX.countryByEn[en];
    data.push({ name: en, itemStyle: countryItemStyle(en, countryStats(c).v > 0, c.cities.some(ci => isWished(ci.id) && !isVisited(ci.id)), pal) });
  }
  opt.series[0].data = data;
  S.chart.setOption(opt, fresh);
}
function countryItemStyle(name, visited, wish, pal) {
  const style = { areaColor: visited ? C_CITY_ON : pal.off };
  if (wish && !visited) { style.borderColor = '#1E88E5'; style.borderWidth = 1.6; style.borderType = 'dashed'; }
  else { style.borderColor = pal.border; style.borderWidth = 0.6; }
  return style;
}

function setTopbar(title, showBack, showSwitch) {
  $('#topbar-title').textContent = title;
  $('#btn-back').classList.toggle('hidden', !showBack);
  $('#map-switch').classList.toggle('hidden', !showSwitch || S.tab !== 'map');
}

/* 入场特效：云波雾散 / 拨云见日（'boot'）/ 云闭合（'close'）
   - 'boot'：写实积云从中央拨开、中央见日光晕、天空淡出（进入：启动、点开省份/城市/世界/国家）。
   - 'close'：云从两侧合拢到中央（闭上），整层随后淡出（退出：返回全国、关闭记录层）。
   - 'dive' 穿云俯冲逻辑保留在 reveal() 中，但当前不再触发；如需可重新启用。 */
let _revealTimer = null;
let _audioCtx = null;
function reveal(mode) {
  const fx = $('#reveal-fx');
  if (!fx) return;
  const isDive = mode === 'dive';
  const isClose = mode === 'close';
  // 经典重启：先移除 show / boot / dive / close，强制同步重排(reflow)，再添加，确保 CSS 动画从 0% 帧重新播放。
  // 同步写法而非 requestAnimationFrame：避免与 boot() 初始 showChina() 的 reveal 产生竞态——同步 add 使 show 立即生效。
  fx.classList.remove('show', 'boot', 'dive', 'close');
  void fx.offsetWidth;          // 触发 reflow
  fx.classList.add('show');     // 重新添加，动画从初始帧开始
  if (isDive) fx.classList.add('dive');
  else if (isClose) fx.classList.add('close');
  else fx.classList.add('boot');
  // 音效：需用户手势内 AudioContext 已 running；否则静默跳过（浏览器自动播放策略）
  const ctx = getAudioCtx();
  if (ctx) {
    if (ctx.state === 'running') playCloudSound(ctx);
    else ctx.resume();
  }
  if (_revealTimer) clearTimeout(_revealTimer);
  _revealTimer = setTimeout(() => fx.classList.remove('show', 'boot', 'dive', 'close'), 1500);
}

/* ---------- Web Audio 合成音效（无需外部音频文件，离线可用） ---------- */
function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  return _audioCtx;
}
function makeNoise(ctx, dur) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
/* 云朵：柔和 whoosh（带通噪声扫频）+ 见日 shimmer（两枚轻柔正弦） */
function playCloudSound(ctx) {
  const t = ctx.currentTime;
  const noise = ctx.createBufferSource(); noise.buffer = makeNoise(ctx, 0.95);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.75);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  noise.connect(bp); bp.connect(g); g.connect(ctx.destination);
  noise.start(t); noise.stop(t + 0.95);
  [880, 1320].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t + 0.1);
    og.gain.exponentialRampToValueAtTime(0.12 - i * 0.04, t + 0.25);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    o.connect(og); og.connect(ctx.destination); o.start(t + 0.1); o.stop(t + 1.0);
  });
}

/* 翻书页：纸页掀动的「fwip + 沙沙 + 落定轻响」——全 Web Audio 合成，离线可用，无需外部音频文件。
   声学构成：① bandpass 白噪做快速 fwip 扫频（纸页掀动的气流）；② 高通白噪做细碎沙沙（纸张摩擦）；
   ③ 一枚短促低正弦做「啪」落定轻响（书页合上的实感）。三者叠加 ≈ 真实翻书声。 */
function playPageFlipSound(ctx) {
  const t = ctx.currentTime;

  // ① 纸页掀动 fwip（带通噪声，350→1500Hz 快速上扫，约 0.5s）
  const fwip = ctx.createBufferSource(); fwip.buffer = makeNoise(ctx, 0.55);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(1500, t + 0.42);
  const fwipG = ctx.createGain();
  fwipG.gain.setValueAtTime(0.0001, t);
  fwipG.gain.exponentialRampToValueAtTime(0.34, t + 0.06);
  fwipG.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  fwip.connect(bp); bp.connect(fwipG); fwipG.connect(ctx.destination);
  fwip.start(t); fwip.stop(t + 0.55);

  // ② 纸张摩擦沙沙（高通白噪，贯穿翻动全程约 0.68s，音量更低更碎）
  const rustle = ctx.createBufferSource(); rustle.buffer = makeNoise(ctx, 0.7);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
  const rustleG = ctx.createGain();
  rustleG.gain.setValueAtTime(0.0001, t + 0.02);
  rustleG.gain.exponentialRampToValueAtTime(0.10, t + 0.14);
  rustleG.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);
  rustle.connect(hp); hp.connect(rustleG); rustleG.connect(ctx.destination);
  rustle.start(t + 0.02); rustle.stop(t + 0.7);

  // ③ 落定轻响「啪」（低正弦短促脉冲，约 0.09s，落在翻动末段）
  const thud = ctx.createOscillator(); thud.type = 'sine';
  thud.frequency.setValueAtTime(150, t + 0.6); thud.frequency.exponentialRampToValueAtTime(90, t + 0.66);
  const thudG = ctx.createGain();
  thudG.gain.setValueAtTime(0.0001, t + 0.6);
  thudG.gain.exponentialRampToValueAtTime(0.22, t + 0.63);
  thudG.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  thud.connect(thudG); thudG.connect(ctx.destination);
  thud.start(t + 0.6); thud.stop(t + 0.72);
}

function onMapClick(params) {
  if (!params.name) return;
  if (S.mapScope === 'china' && S.mapLevel === 'national') {
    const prov = IDX.provByName[params.name];
    if (prov) showProvince(prov.adcode);
    return;
  }
  if (S.mapScope === 'china' && S.mapLevel === 'province') {
    const prov = IDX.provByAdcode[S.curProv];
    if (!prov) return;
    const city = prov.cities.length > 1
      ? prov.cities.find(c => c.name === params.name)
      : prov.cities[0];
    if (city) openSheet(city.id);
    return;
  }
  if (S.mapScope === 'world') {
    if (params.name === 'China') { toast('国内城市请在「中国」地图记录'); return; }
    const country = IDX.countryByEn[params.name];
    if (country) openCountrySheet(country);
    else toast('该地区暂不支持记录');
  }
}

/* ================= 记录弹层 ================= */
function openSheet(destId) {
  S.sheetDest = destId;
  const rec = S.records[destId];
  const info = IDX.cityById[destId];
  $('#sheet-title').textContent = IDX.destName[destId] || '';
  $('#sheet-sub').textContent = info?.prov ? `${info.prov.name} · 中国` : (info?.country ? `${info.country.cn}` : '');
  const on = !!rec;
  setToggle(on);
  setWishStar($('#sheet-wish'), isWished(destId));
  $('#fld-date').value = rec?.first || today();
  $('#times-num').textContent = rec?.times || 1;
  $('#fld-note').value = rec?.note || '';
  renderSheetPhotos();
  // 先把任何挂起的"延迟弹层"计时器清掉，避免快速连续点击出现旧内容冒出来
  clearTimeout(openSheet._t);
  // 云波雾散 / 拨云见日：开云雾散后再露出记录层
  // （reveal-fx 在弹层之上，但 pointer-events:none，不挡点击；云散后自然显出记录层）
  reveal('boot');
  $('#sheet-mask').classList.remove('hidden');
  $('#sheet').classList.remove('hidden');
}
function setWishStar(el, wished) {
  if (!el) return;
  el.textContent = wished ? '★' : '☆';
  el.classList.toggle('on', wished);
  el.setAttribute('aria-checked', String(wished));
}
function closeSheets() {
  // 清掉 openSheet 的"延迟弹层"计时器，防止用户中途关闭后旧内容延迟出现
  clearTimeout(openSheet._t); openSheet._t = null;
  // 退出城市/国家记录层：云闭上（close），合拢后露出上一级底图
  reveal('close');
  $('#sheet-mask').classList.add('hidden');
  $('#sheet').classList.add('hidden');
  $('#country-sheet').classList.add('hidden');
  S.sheetDest = null;
}
function setToggle(on) {
  const t = $('#sheet-toggle');
  t.classList.toggle('on', on);
  t.setAttribute('aria-checked', String(on));
  $('#sheet-body').classList.toggle('disabled', !on);
}
function curRecord() {
  const id = S.sheetDest;
  if (!S.records[id]) S.records[id] = { first: today(), times: 1, note: '', photos: [] };
  return S.records[id];
}
function refreshCurrentMap() {
  if (S.mapScope === 'china' && S.mapLevel === 'province' && S.curProv) {
    renderProvData(IDX.provByAdcode[S.curProv], false);
  } else if (S.mapScope === 'china') {
    const opt = { series: [{ data: S.dest.china.map(p => ({ name: p.name, itemStyle: provItemStyle(p) })) }] };
    S.chart.setOption(opt);
  } else {
    renderWorldData(false);
  }
}
function afterRecordChange() {
  saveRecords();
  refreshCurrentMap();
  markListDirty();
}

function bindSheet() {
  $('#sheet-mask').addEventListener('click', closeSheets);
  $('#sheet-wish').addEventListener('click', () => {
    if (!S.sheetDest) return;
    toggleWish(S.sheetDest);
    setWishStar($('#sheet-wish'), isWished(S.sheetDest));
    refreshCurrentMap(); markListDirty();
    toast(isWished(S.sheetDest) ? '已加入「想去」' : '已移出「想去」');
  });
  $('#country-wish').addEventListener('click', () => {
    const c = S.sheetCountry;
    if (!c) return;
    const any = c.cities.some(ci => isWished(ci.id) && !isVisited(ci.id));
    for (const ci of c.cities) {
      if (any) delete S.wish[ci.id];
      else if (!isVisited(ci.id)) S.wish[ci.id] = true;
    }
    saveWish();
    setWishStar($('#country-wish'), !any);
    refreshCurrentMap(); markListDirty();
    toast(any ? '已移出「想去」' : '已加入「想去」');
  });
  $('#sheet-toggle').addEventListener('click', async () => {
    const id = S.sheetDest;
    if (isVisited(id)) {
      if (!confirm('取消「去过」将清除该地的日期、次数、笔记和照片，确定吗？')) return;
      const rec = S.records[id];
      for (const pid of rec.photos || []) await idb.del(pid);
      delete S.records[id];
      setToggle(false);
    } else {
      curRecord();
      setToggle(true);
    }
    afterRecordChange();
  });
  $('#fld-date').addEventListener('change', (e) => { curRecord().first = e.target.value; afterRecordChange(); });
  $('#fld-note').addEventListener('input', (e) => { curRecord().note = e.target.value; saveRecords(); });
  $('#times-minus').addEventListener('click', () => {
    const r = curRecord(); r.times = Math.max(1, (r.times || 1) - 1);
    $('#times-num').textContent = r.times; afterRecordChange();
  });
  $('#times-plus').addEventListener('click', () => {
    const r = curRecord(); r.times = (r.times || 1) + 1;
    $('#times-num').textContent = r.times; afterRecordChange();
  });
  $('#btn-add-photo').addEventListener('click', () => $('#file-photo').click());
  $('#file-photo').addEventListener('change', onPhotoPick);
  $('#photo-close').addEventListener('click', () => $('#photo-viewer').classList.add('hidden'));
}

async function onPhotoPick(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const rec = curRecord();
  for (const f of files) {
    try {
      const blob = await compressImage(f, 1600, 0.82);
      const pid = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      await idb.put({ id: pid, blob, ts: Date.now() });
      rec.photos.push(pid);
    } catch (err) {
      console.error(err);
      toast('照片保存失败');
    }
  }
  saveRecords();
  renderSheetPhotos();
  toast('已添加照片');
}

function compressImage(file, maxDim, quality) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (Math.max(width, height) > maxDim) {
        const k = maxDim / Math.max(width, height);
        width = Math.round(width * k); height = Math.round(height * k);
      }
      const cv = document.createElement('canvas');
      cv.width = width; cv.height = height;
      cv.getContext('2d').drawImage(img, 0, 0, width, height);
      cv.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', quality);
    };
    img.onerror = rej;
    img.src = url;
  });
}

async function renderSheetPhotos() {
  const box = $('#photos');
  box.innerHTML = '';
  const rec = S.records[S.sheetDest];
  if (!rec) return;
  for (const pid of rec.photos || []) {
    const url = await photoURL(pid);
    if (!url) continue;
    const div = document.createElement('div');
    div.className = 'ph';
    div.innerHTML = `<img src="${url}" alt=""><button class="del">✕</button>`;
    div.querySelector('img').addEventListener('click', () => {
      $('#photo-full').src = url;
      $('#photo-viewer').classList.remove('hidden');
    });
    div.querySelector('.del').addEventListener('click', async () => {
      await idb.del(pid);
      rec.photos = rec.photos.filter(x => x !== pid);
      delete S.photoURLs[pid];
      saveRecords();
      renderSheetPhotos();
    });
    box.appendChild(div);
  }
}

/* ================= 国家弹层 ================= */
function openCountrySheet(country) {
  reveal('boot');   // 云波雾散 / 拨云见日
  S.sheetCountry = country;
  $('#country-title').textContent = country.cn;
  const any = country.cities.some(ci => isWished(ci.id) && !isVisited(ci.id));
  setWishStar($('#country-wish'), any);
  const box = $('#country-cities');
  box.innerHTML = '';
  for (const city of country.cities) {
    const row = document.createElement('div');
    row.className = 'city-row' + (isVisited(city.id) ? ' visited' : '');
    const rec = S.records[city.id];
    row.innerHTML = `<span class="dot"></span>${city.name}<span class="meta">${rec ? (rec.first || '') : ''}</span>`;
    row.addEventListener('click', () => { closeSheets(); openSheet(city.id); });
    box.appendChild(row);
  }
  $('#sheet-mask').classList.remove('hidden');
  $('#country-sheet').classList.remove('hidden');
}

/* ================= 清单视图 ================= */
let listDirty = true;
function markListDirty() { listDirty = true; }

function renderList(filter = '') {
  const box = $('#list');
  box.innerHTML = '';
  const kw = filter.trim();

  // 想去的地方（愿望清单）专区
  if (!kw) {
    const wished = Object.keys(S.wish).map(id => ({ id, name: IDX.destName[id] || id }));
    if (wished.length) {
      const g = document.createElement('div');
      g.className = 'group open wish-group';
      g.innerHTML = `<div class="group-head">⭐ 想去的地方 <span class="badge wish-badge">${wished.length}</span><span class="arrow">▶</span></div><div class="group-items"></div>`;
      const items = g.querySelector('.group-items');
      for (const w of wished) {
        const row = document.createElement('div');
        row.className = 'city-row wish-row';
        const info = IDX.cityById[w.id];
        const sub = info?.prov ? info.prov.short : (info?.country ? info.country.cn : '');
        row.innerHTML = `<span class="dot dot-wish">☆</span>${w.name}<span class="meta">${sub}</span>`;
        row.addEventListener('click', () => {
          closeSheets();
          const inf = IDX.cityById[w.id];
          if (inf?.country) openCountrySheet(inf.country); else openSheet(w.id);
        });
        items.appendChild(row);
      }
      box.appendChild(g);
    }
  }
  const mkGroup = (name, badgeV, badgeN, cities) => {
    if (kw && !cities.length) return;
    const g = document.createElement('div');
    g.className = 'group' + (kw ? ' open' : '');
    const doneCls = badgeV === badgeN && badgeN > 0 ? ' done' : '';
    g.innerHTML = `<div class="group-head">${name}
      <span class="badge${doneCls}">${badgeV}/${badgeN}</span><span class="arrow">▶</span></div>
      <div class="group-items"></div>`;
    const items = g.querySelector('.group-items');
    for (const c of cities) {
      const row = document.createElement('div');
      row.className = 'city-row' + (isVisited(c.id) ? ' visited' : '');
      const rec = S.records[c.id];
      row.innerHTML = `<span class="dot"></span>${c.name}<span class="meta">${rec ? (rec.first || '') : ''}</span>`;
      row.addEventListener('click', () => openSheet(c.id));
      items.appendChild(row);
    }
    g.querySelector('.group-head').addEventListener('click', () => g.classList.toggle('open'));
    box.appendChild(g);
  };
  const match = (name) => !kw || name.toLowerCase().includes(kw.toLowerCase());

  for (const p of S.dest.china) {
    const cities = p.cities.filter(c => match(c.name) || match(p.short) || match(p.name));
    if (kw && (match(p.short) || match(p.name))) cities.splice(0, cities.length, ...p.cities);
    const { v, n } = provStats(p);
    mkGroup(p.short, v, n, kw ? cities : p.cities.filter(c => match(c.name)));
  }
  const worldCities = [];
  for (const c of S.dest.world) {
    if (c.en === 'China') continue;
    const cities = c.cities.filter(ct => match(ct.name) || match(c.cn));
    worldCities.push({ c, cities });
  }
  for (const { c, cities } of worldCities) {
    const { v, n } = countryStats(c);
    mkGroup(c.cn, v, n, kw ? cities : c.cities.filter(ct => match(ct.name)));
  }
  if (!box.children.length) box.innerHTML = '<p class="empty-tip">没有匹配的城市</p>';
  listDirty = false;
}

/* ================= 统计视图 ================= */
function renderStats() {
  let cnV = 0, cnN = 0, provV = 0;
  for (const p of S.dest.china) {
    const { v, n } = provStats(p);
    cnV += v; cnN += n;
    if (v > 0) provV++;
  }
  let intlV = 0, ctyV = 0, ctyN = 0;
  for (const en in IDX.countryByEn) {
    const c = IDX.countryByEn[en];
    const { v, n } = countryStats(c);
    intlV += v; ctyN++;
    if (v > 0) ctyV++;
  }
  let times = 0;
  for (const id in S.records) times += S.records[id].times || 1;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const ring = (p, accent) => `<div class="ring" style="--p:${p};--ring:${accent}"><span>${p}%</span></div>`;

  $('#stats-cards').innerHTML = `
    <div class="stat-card"><span class="ico">🏙️</span><div class="num">${cnV + intlV}<small> 座</small></div><div class="lbl">去过的城市</div></div>
    <div class="stat-card"><span class="ico">✈️</span><div class="num">${times}<small> 次</small></div><div class="lbl">累计旅行次数</div></div>
    <div class="stat-card stat-wide">
      <div class="stat-wide-main">
        <span class="ico">🇨🇳</span>
        <div>
          <div class="num">${provV}<small> / ${S.dest.stats.cnProvinces} 省级</small></div>
          <div class="lbl">中国足迹 · 城市 ${cnV}/${cnN}</div>
        </div>
      </div>
      ${ring(pct(cnV, cnN), '#FF7043')}
      <div class="progress"><i style="width:${pct(cnV, cnN)}%"></i></div>
      <div class="progress-lbl">
        <span>探索中国进程</span>
        <span class="progress-pct">${pct(cnV, cnN)}% · ${cnV}/${cnN} 城市</span>
      </div>
    </div>
    <div class="stat-card stat-wide">
      <div class="stat-wide-main">
        <span class="ico">🌍</span>
        <div>
          <div class="num">${ctyV}<small> / ${ctyN} 国</small></div>
          <div class="lbl">世界足迹 · 城市 ${intlV}</div>
        </div>
      </div>
      ${ring(pct(ctyV, ctyN), '#1E88E5')}
      <div class="progress world"><i style="width:${pct(ctyV, ctyN)}%"></i></div>
      <div class="progress-lbl">
        <span>探索世界进程</span>
        <span class="progress-pct">${pct(ctyV, ctyN)}% · ${ctyV}/${ctyN} 国家</span>
      </div>
    </div>`;

  renderTimeline();
  renderWishStats();

  const recent = Object.entries(S.records)
    .filter(([, r]) => r.first)
    .sort((a, b) => (b[1].first > a[1].first ? 1 : -1))
    .slice(0, 8);
  $('#stats-recent').innerHTML = '<h3>最近到访</h3>' + (recent.length
    ? recent.map(([id, r]) => `<div class="recent-row">📍 ${IDX.destName[id] || id}
        <span class="meta">${r.first} · 第${r.times || 1}次</span></div>`).join('')
    : '<p class="empty-tip">还没有记录，去地图上点亮第一座城市吧</p>');
}

/* 年度时间轴：按首次到访年份聚合 */
function renderTimeline() {
  const byYear = {};
  for (const id in S.records) {
    const y = (S.records[id].first || '').slice(0, 4);
    if (!y) continue;
    byYear[y] = (byYear[y] || 0) + 1;
  }
  const years = Object.keys(byYear).sort();
  const box = $('#stats-timeline');
  if (!years.length) { box.innerHTML = ''; return; }
  const max = Math.max(...years.map(y => byYear[y]));
  box.innerHTML = '<h3>年度足迹</h3>' + years.map(y => `
    <div class="tl-row">
      <div class="tl-year">${y}</div>
      <div class="tl-bar"><i style="width:${(byYear[y] / max * 100).toFixed(0)}%"></i></div>
      <div class="tl-count">${byYear[y]} 城</div>
    </div>`).join('');
}

/* 想去的地方统计条 */
function renderWishStats() {
  const n = Object.keys(S.wish).filter(id => !isVisited(id)).length;
  const box = $('#stats-wish');
  if (!box) return;
  box.innerHTML = n
    ? `<div class="recent-row wish-row">⭐ 想去的地方 <span class="meta">${n} 个 · 点击「我的」或清单查看</span></div>`
    : '';
}

/* 生成足迹分享图（返回 dataURL；turkeyvisited 思路：地图+统计合成为可分享卡片） */
async function shareCard() {
  toast('正在生成分享图…');
  const pal = { off: '#E8ECF3', border: '#FFFFFF', label: '#5A6270', emphasis: '#90CAF9' };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;height:500px;';
  document.body.appendChild(host);
  const ec = echarts.init(host, null, { renderer: 'canvas' });
  const data = S.dest.china.map(p => ({ name: p.name, itemStyle: provItemStyle(p) }));
  ec.setOption({
    animation: false, backgroundColor: 'transparent',
    series: [{ type: 'map', map: 'china', roam: false, selectedMode: false,
      itemStyle: { areaColor: pal.off, borderColor: pal.border, borderWidth: 0.6 },
      label: { show: false }, data }],
  });
  const mapURL = ec.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: 'transparent' });
  ec.dispose(); host.remove();

  // 统计
  let cnV = 0, cnN = 0, provV = 0;
  for (const p of S.dest.china) { const { v, n } = provStats(p); cnV += v; cnN += n; if (v > 0) provV++; }
  let intlV = 0, ctyV = 0, ctyN = 0, times = 0;
  for (const en in IDX.countryByEn) { const c = IDX.countryByEn[en]; const { v } = countryStats(c); intlV += v; ctyN++; if (v > 0) ctyV++; }
  for (const id in S.records) times += S.records[id].times || 1;
  const wishN = Object.keys(S.wish).filter(id => !isVisited(id)).length;

  const W = 1080, H = 1620;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1A5FB4'); g.addColorStop(0.55, '#1E88C7'); g.addColorStop(1, '#00A5B5');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // 卡片
  x.fillStyle = 'rgba(255,255,255,.96)';
  roundRect(x, 60, 200, W - 120, H - 320, 36); x.fill();
  // 标题
  x.fillStyle = '#fff'; x.textAlign = 'center';
  x.font = '700 64px -apple-system, "PingFang SC", sans-serif';
  x.fillText('我的城市足迹', W / 2, 130);
  x.font = '400 28px -apple-system, sans-serif'; x.globalAlpha = .85;
  x.fillText('CITY FOOTPRINT · ' + today(), W / 2, 175); x.globalAlpha = 1;
  // 地图
  const img = new Image();
  await new Promise(res => { img.onload = res; img.src = mapURL; });
  const mw = W - 200, mh = mw * img.height / img.width;
  x.drawImage(img, 100, 250, mw, mh);
  // 统计数字
  const statsY = 250 + mh + 60;
  const items = [
    [cnV + intlV, '座城市'], [provV, '个省份'], [ctyV, '个国家'], [times, '次出行'], [wishN, '想去'],
  ];
  const colW = (W - 120) / items.length;
  x.textAlign = 'center';
  items.forEach((it, i) => {
    const cx = 60 + colW * i + colW / 2;
    x.fillStyle = '#E64A19'; x.font = '800 56px -apple-system, sans-serif';
    x.fillText(it[0], cx, statsY);
    x.fillStyle = '#7A8291'; x.font = '400 24px -apple-system, sans-serif';
    x.fillText(it[1], cx, statsY + 36);
  });
  // 页脚
  x.fillStyle = 'rgba(255,255,255,.9)'; x.textAlign = 'center'; x.font = '400 24px -apple-system, sans-serif';
  x.fillText('城市足迹 App · 数据仅存本机', W / 2, H - 60);

  const url = cv.toDataURL('image/png');
  S._shareURL = url;
  return url;
}
function roundRect(x, rx, ry, w, h, r) {
  x.beginPath();
  x.moveTo(rx + r, ry);
  x.arcTo(rx + w, ry, rx + w, ry + h, r);
  x.arcTo(rx + w, ry + h, rx, ry + h, r);
  x.arcTo(rx, ry + h, rx, ry, r);
  x.arcTo(rx, ry, rx + w, ry, r);
  x.closePath();
}

/* ================= 我的视图 ================= */
function bindMe() {
  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', importBackup);
  $('#btn-share').addEventListener('click', onShareClick);
  $('#theme-toggle').addEventListener('click', () => {
    S.theme = S.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, S.theme);
    applyTheme();
    refreshCurrentMap();
    toast(S.theme === 'dark' ? '已切换深色模式' : '已切换浅色模式');
  });
  $('#btn-replay-boot').addEventListener('click', () => {
    replayBoot();
    toast('重看开云雾散');
  });
  $('#btn-force-refresh').addEventListener('click', () => {
    forceRefresh();
  });
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(est => {
      const mb = (est.usage / 1048576).toFixed(1);
      $('#storage-info').textContent = `本机已用存储约 ${mb} MB`;
    });
  }
}
async function onShareClick() {
  try {
    const url = await shareCard();
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], `城市足迹_${today().replaceAll('-', '')}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '我的城市足迹', text: '我的城市足迹' });
      return;
    }
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.click();
    toast('分享图已保存到相册/下载');
  } catch (e) {
    console.error(e);
    if (S._shareURL) {
      const a = document.createElement('a');
      a.href = S._shareURL; a.download = `城市足迹_${today().replaceAll('-', '')}.png`; a.click();
      toast('分享图已保存');
    } else toast('生成失败');
  }
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

async function exportBackup() {
  toast('正在打包备份…');
  const photos = {};
  for (const p of await idb.all()) photos[p.id] = await blobToBase64(p.blob);
  const data = { app: 'city-footprint', version: 2, exportedAt: new Date().toISOString(), records: S.records, wish: S.wish, photos };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `城市足迹备份_${today().replaceAll('-', '')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('备份已导出');
}

async function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'city-footprint' || !data.records) throw new Error('bad file');
    if (!confirm('导入将覆盖当前全部记录和照片，确定继续吗？')) return;
    S.records = data.records;
    S.wish = data.wish || {};
    saveRecords(); saveWish();
    for (const pid in (data.photos || {})) {
      await idb.put({ id: pid, blob: base64ToBlob(data.photos[pid]), ts: Date.now() });
    }
    S.photoURLs = {};
    markListDirty();
    if (S.mapScope === 'china' && S.mapLevel === 'national') showChina();
    else if (S.mapScope === 'world') showWorld();
    else if (S.curProv) renderProvData(IDX.provByAdcode[S.curProv], false);
    if (S.tab === 'stats') renderStats();
    toast('导入完成');
  } catch {
    toast('备份文件无法识别');
  }
}

/* ================= Tab 切换 ================= */
const _TAB_ORDER = ['map', 'list', 'stats', 'me'];
function switchTab(tab) {
  const prev = S.tab;
  S.tab = tab;
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.add('hidden'));
  const incoming = $('#view-' + tab);
  incoming.classList.remove('hidden');
  // 书页翻动：与 Tab 顺序一致。向右切（新 tab 顺序更靠后）→ 新页从左边书脊掀入；
  // 向左切 → 从右边书脊掀入。强制 reflow 后重加 class，保证连续点击同一 tab 也能重播动画。
  const dir = _TAB_ORDER.indexOf(tab) >= _TAB_ORDER.indexOf(prev) ? 'from-left' : 'from-right';
  incoming.classList.remove('flip-in', 'from-left', 'from-right');
  void incoming.offsetWidth;
  incoming.classList.add('flip-in', dir);
  // 翻书页音效：仅当真实切换（非重复点同一 tab）且 AudioContext 已 running（用户手势内已 resume）
  if (tab !== prev) {
    const actx = getAudioCtx();
    if (actx && actx.state === 'running') playPageFlipSound(actx);
  }
  if (tab === 'map') {
    setTopbar(S.mapLevel === 'province' ? IDX.provByAdcode[S.curProv].name : (S.mapScope === 'china' ? '城市足迹' : '世界足迹'),
      S.mapLevel === 'province', true);
    requestAnimationFrame(() => S.chart.resize());
  } else if (tab === 'list') {
    setTopbar('城市清单', false, false);
    if (listDirty) renderList($('#search').value);
  } else if (tab === 'stats') {
    setTopbar('足迹统计', false, false);
    renderStats();
  } else {
    setTopbar('我的', false, false);
  }
}

/* ================= 周边发现（村级点位 · 云南试点） =================
   数据：assets/data/village/52.json（13,554 个村的中心点，已统一为 GCJ-02）
   原则：点位只用于「算距离」，不用于「画地图」——底图合规性由现有地图负责。
   坐标红线：浏览器定位返回 WGS84，必须转 GCJ-02 再与村点比较，否则偏移数百米。 */
const NR = {
  data: null,
  loading: null,
  radius: 10,
  pickMode: false,
  origin: null,
  results: [],
};

const NR_DATA_URL = 'assets/data/village/52.json';

function haversineKm(aLng, aLat, bLng, bLat) {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const la1 = aLat * toRad;
  const la2 = bLat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* WGS84 → GCJ-02 */
function wgs2gcj(lng, lat) {
  const A = 6378245.0;
  const EE = 0.00669342162296594323;
  if (!(lng > 72.004 && lng < 137.8347 && lat > 0.8293 && lat < 55.8271)) return [lng, lat];
  const tLat = (x, y) => {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  };
  const tLng = (x, y) => {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  };
  let dLat = tLat(lng - 105, lat - 35);
  let dLng = tLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (A / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}

function nrStatus(msg) {
  const el = $('#nearby-status');
  if (el) el.textContent = msg;
}

function loadVillages() {
  if (NR.data) return Promise.resolve(NR.data);
  if (!NR.loading) {
    NR.loading = fetchJSON(NR_DATA_URL).then((d) => {
      NR.data = d;
      return d;
    });
  }
  return NR.loading;
}

function openNearby() {
  $('#nearby-mask').classList.remove('hidden');
  $('#nearby-sheet').classList.remove('hidden');
  nrStatus('正在载入村级数据…');
  loadVillages()
    .then((d) => {
      nrStatus(`已载入${d.provName} ${d.count.toLocaleString()} 个村 · 选一种方式定位起点`);
      if (NR.origin) queryNearby(NR.origin.lng, NR.origin.lat, NR.origin.label);
    })
    .catch(() => nrStatus('村级数据载入失败，请检查网络后重试'));
}

function closeNearby() {
  $('#nearby-mask').classList.add('hidden');
  $('#nearby-sheet').classList.add('hidden');
  setPickMode(false);
}

function setPickMode(on) {
  NR.pickMode = on;
  const fab = $('#nearby-fab');
  if (fab) {
    fab.classList.toggle('picking', on);
    fab.textContent = on ? '✕' : '📍';
  }
  const pickBtn = $('#nearby-pick');
  if (pickBtn) pickBtn.classList.toggle('on', on);
}

function enterPick() {
  // 点选时先收起弹层，把地图让出来
  if (NR.pickMode) { setPickMode(false); openNearby(); return; }
  $('#nearby-mask').classList.add('hidden');
  $('#nearby-sheet').classList.add('hidden');
  setPickMode(true);
  toast('点地图上任意位置，查看周边村落');
}

function queryNearby(lng, lat, label) {
  if (!NR.data) return;
  NR.origin = { lng, lat, label: label || '选定位置' };
  const rows = [];
  for (const p of NR.data.points) {
    const d = haversineKm(lng, lat, p[3], p[4]);
    if (d <= NR.radius) rows.push({ pac: p[0], name: p[1], town: p[2], dist: d });
  }
  rows.sort((a, b) => a.dist - b.dist);
  NR.results = rows;
  renderNearby();
}

function renderNearby() {
  const list = $('#nearby-list');
  if (!list) return;
  const rows = NR.results;
  const label = NR.origin ? NR.origin.label : '';
  if (!rows.length) {
    // 半径内没有村：给出最近若干条，避免空结果
    const near = [];
    for (const p of NR.data.points) {
      near.push({ pac: p[0], name: p[1], town: p[2], dist: haversineKm(NR.origin.lng, NR.origin.lat, p[3], p[4]) });
    }
    near.sort((a, b) => a.dist - b.dist);
    const top = near.slice(0, 8);
    nrStatus(`${label} · ${NR.radius} km 内没有村落，下面是最近的 ${top.length} 个`);
    list.innerHTML = top.map(nrRowHTML).join('');
    return;
  }
  nrStatus(`${label} · ${NR.radius} km 内共 ${rows.length} 个村，列出最近 ${Math.min(rows.length, 40)} 个`);
  list.innerHTML = rows.slice(0, 40).map(nrRowHTML).join('');
}

function nrRowHTML(r) {
  const dist = r.dist < 1 ? `${Math.round(r.dist * 1000)} m` : `${r.dist.toFixed(1)} km`;
  return `<div class="nr-row" data-pac="${r.pac}">
    <span class="nr-name">${r.name}<span class="nr-town"> · ${r.town || '—'}</span></span>
    <span class="nr-dist">${dist}</span>
  </div>`;
}

function geoLocate() {
  if (!navigator.geolocation) { nrStatus('当前环境不支持定位'); return; }
  nrStatus('正在获取定位…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const [lng, lat] = wgs2gcj(pos.coords.longitude, pos.coords.latitude);
      queryNearby(lng, lat, '我的位置');
    },
    (err) => nrStatus(`定位失败：${err && err.message ? err.message : '未授权或超时'}`),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function searchVillage(q) {
  const kw = (q || '').trim();
  if (kw.length < 1) { renderNearby(); return; }
  if (!NR.data) return;
  const hits = [];
  for (const p of NR.data.points) {
    if (p[1].includes(kw) || (p[2] && p[2].includes(kw))) {
      hits.push({ pac: p[0], name: p[1], town: p[2], lng: p[3], lat: p[4] });
      if (hits.length >= 30) break;
    }
  }
  const list = $('#nearby-list');
  if (!hits.length) { nrStatus(`没有匹配「${kw}」的村`); list.innerHTML = ''; return; }
  nrStatus(`「${kw}」匹配 ${hits.length} 条，点一条查看它周边的村`);
  list.innerHTML = hits
    .map((h) => `<div class="nr-row" data-lng="${h.lng}" data-lat="${h.lat}" data-label="${h.name}">
      <span class="nr-name">${h.name}<span class="nr-town"> · ${h.town || '—'}</span></span>
      <span class="nr-dist">查看周边 ›</span></div>`)
    .join('');
}

/* 地图像素 → 经纬度（ECharts map 系列） */
function onMapZrClick(e) {
  if (!NR.pickMode) return;
  const pt = [e.offsetX, e.offsetY];
  let lngLat = null;
  for (const opt of [{ seriesIndex: 0 }, { geoIndex: 0 }]) {
    try {
      const v = S.chart.convertFromPixel(opt, pt);
      if (Array.isArray(v) && isFinite(v[0]) && isFinite(v[1])) { lngLat = v; break; }
    } catch (_) { /* 尝试下一种坐标系 */ }
  }
  if (!lngLat || !(lngLat[0] > 70 && lngLat[0] < 140 && lngLat[1] > 0 && lngLat[1] < 56)) {
    toast('没取到坐标，请点在地图范围内部');
    return;
  }
  setPickMode(false);
  loadVillages().then(() => {
    openNearby();
    queryNearby(lngLat[0], lngLat[1], '地图点选');
  });
}

function bindNearby() {
  const fab = $('#nearby-fab');
  if (!fab) return;
  fab.addEventListener('click', () => {
    if (NR.pickMode) { setPickMode(false); toast('已取消点选'); return; }
    openNearby();
  });
  $('#nearby-close').addEventListener('click', closeNearby);
  $('#nearby-mask').addEventListener('click', closeNearby);
  $('#nearby-geo').addEventListener('click', geoLocate);
  $('#nearby-pick').addEventListener('click', enterPick);

  $$('#nearby-radius button').forEach((b) => {
    b.addEventListener('click', () => {
      $$('#nearby-radius button').forEach((x) => x.classList.toggle('on', x === b));
      NR.radius = Number(b.dataset.km) || 10;
      if (NR.origin) queryNearby(NR.origin.lng, NR.origin.lat, NR.origin.label);
      else nrStatus(`半径已设为 ${NR.radius} km，请先定位起点`);
    });
  });

  const si = $('#nearby-search');
  si.addEventListener('input', (e) => searchVillage(e.target.value));

  $('#nearby-list').addEventListener('click', (e) => {
    const row = e.target.closest('.nr-row');
    if (!row) return;
    if (row.dataset.lng) {
      const lng = Number(row.dataset.lng);
      const lat = Number(row.dataset.lat);
      si.value = '';
      queryNearby(lng, lat, row.dataset.label || '该村');
    }
  });
}

/* 测试钩子：供自动化验证直接驱动周边发现，不影响正常使用 */
window.__nr = {
  state: NR,
  load: loadVillages,
  open: openNearby,
  query(lng, lat, label) {
    return loadVillages().then(() => {
      openNearby();
      queryNearby(lng, lat, label);
      return NR.results.length;
    });
  },
  wgs2gcj,
  haversineKm,
};

/* ================= 启动 ================= */
async function boot() {
  loadRecords();
  loadWish();
  loadTheme();
  await idb.open();
  const [dest, china, world] = await Promise.all([
    fetchJSON('assets/data/destinations.json'),
    fetchJSON('assets/geo/china.json'),
    fetchJSON('assets/geo/world.json'),
  ]);
  S.dest = dest;
  buildIndex();
  echarts.registerMap('china', china);
  echarts.registerMap('world', world);

  S.chart = echarts.init($('#map'));
  S.chart.on('click', onMapClick);
  S.chart.getZr().on('click', onMapZrClick);   // 周边发现：地图点选取坐标
  window.addEventListener('resize', () => S.chart.resize());

  $$('#tabbar button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $$('#map-switch button').forEach(b => b.addEventListener('click', () => {
    $$('#map-switch button').forEach(x => x.classList.toggle('on', x === b));
    b.dataset.scope === 'china' ? showChina() : showWorld();
  }));
  $('#btn-back').addEventListener('click', () => {
    // 返回上一级：云闭上（close）。从省份/世界返回全国都走闭合动画
    if (S.mapScope === 'china') showChina({ fxMode: 'close' });
    else showWorld({ fxMode: 'close' });
  });
  $('#search').addEventListener('input', (e) => renderList(e.target.value));

  bindSheet();
  bindMe();
  bindNearby();
  applyTheme();
  applyInstallGuide();
  // 首次用户手势内恢复 AudioContext，使后续特效音效可正常播放
  document.addEventListener('pointerdown', () => {
    const c = getAudioCtx();
    if (c && c.state !== 'running') c.resume();
  }, { passive: true });
  await showChina({ silent: true });

  // 关闭启动屏后播放开云雾散：splash z-index:200、reveal-fx z-index:250，云朵在 splash 之上独立展开；
  // 一旦 splash 完全消失，留下的 cream 天空 + 拨云见日自然过渡到下方已 setOption 好的中国地图。
  const splash = $('#splash');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('fade');   // 渐变 0.5s 后 visibility:hidden
      reveal('boot');                  // 同步触发，c-piece 在 splash 上方独立拨开
      setTimeout(() => splash.remove(), 600);
    }, 350);
  } else {
    reveal('boot');                    // 没有 splash 时直接播放
  }

  // SW 自更新：每次启动主动 update()，并监听 controllerchange 让新 SW 立即接管当前页。
  // 解决 iOS PWA（桌面图标进程）拿不到 Safari 标签页里激活的新 SW 这一长期坑。
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      try { reg.update(); } catch (_) {}
      if (!reg.active && !navigator.serviceWorker.controller) return;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // 新 SW 接管后自动 reload 一次（一次性，后续不打扰）
        location.reload();
      });
    }).catch(() => {});
  }
}

/* 「我的」面板里的「重看入场特效」会调这个，在已渲染的中国地图上叠加云雾散 */
function replayBoot() {
  reveal('boot');
}

/* 「我的」面板里的「强制刷新缓存」会调这个：强制 SW 走 update()，等新 SW 进入 waiting 后
   让它 skipWaiting 并接管，然后 reload 当前页。一次完整流程。 */
async function forceRefresh() {
  if (!('serviceWorker' in navigator)) { toast('当前环境不支持 SW，正在硬刷…'); location.reload(); return; }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { toast('未注册 SW，正在硬刷…'); location.reload(); return; }
  toast('正在检查更新…');
  try {
    await reg.update();
  } catch (e) { toast('检查更新失败，正在硬刷…'); setTimeout(() => location.reload(), 600); return; }
  // reg.update() 会等到有结果（新的 waiting / installed / 没新版本）
  if (navigator.serviceWorker.controller) {
    // 已经有 SW 在控；controllerchange 已经监听，新 SW 接管会自动 reload；若没新版本，仍主动 reload 一次
    setTimeout(() => {
      toast('已是最新，正在强制刷新…');
      location.reload();
    }, 900);
  } else {
    // 第一次安装 SW：等它激活后 reload 一次
    const sw = reg.installing || reg.waiting || reg.active;
    if (sw) {
      sw.addEventListener('statechange', () => {
        if (sw.state === 'activated') location.reload();
      });
    } else {
      location.reload();
    }
  }
}

function applyInstallGuide() {
  // 平台自适应：「我的 → 安装到主屏幕」文案按 UA 切换 iOS / Android / 其他，避免安卓用户看到 Safari 步骤。
  // 默认 iOS 已在 HTML 显式展示（hidden 属性仅在 JS 匹配时移除），关闭 JS 也能看到一条可用提示。
  const guide = $('#install-guide');
  if (!guide) return;
  const ua = (navigator.userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/.test(ua);
  const target = isIOS ? 'ios' : (isAndroid ? 'android' : 'other');
  guide.querySelectorAll('[data-os]').forEach(el => {
    el.hidden = el.dataset.os !== target;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch(err => {
    console.error(err);
    document.body.innerHTML = '<p style="padding:40px 20px;text-align:center;color:#7A8291">数据加载失败，请检查网络后刷新重试</p>';
  });
});
