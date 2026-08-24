# 城市足迹（city-footprint）

## 概述

装在 iPhone 上的「城市足迹」PWA：在地图点亮去过的城市，记录到访日期、次数、笔记和照片，数据全部保存在本机。

**安装方式**：用 iPhone Safari 打开部署链接 → 分享 → 添加到主屏幕。无需 Mac、无需苹果开发者账号。

## 版本

- **v2.8（2026-08-23）**：按反馈让 Tab 书页翻动**更慢**并**加上翻书页声音**。① 动画时长 460ms → **720ms**（`pageTurn`/`pageTurnR` 与 `.flip-in::after` 阴影同步延长），缓动不变，`prefers-reduced-motion` 仍降级。② 新增 `playPageFlipSound(ctx)`：**全 Web Audio 合成**（与现有云特效 `playCloudSound` 同架构、离线可用、无需外部音频文件），声学由三段叠加 ≈ 真实翻书——带通白噪快速上扫做「fwip」掀页气流（350→1500Hz/0.5s）、高通白噪做「沙沙」纸张摩擦（2.6kHz/0.68s）、一枚短促低正弦做「啪」落定轻响（150→90Hz/0.09s，落在翻动末段）。③ `switchTab()` 仅在**真实切换**（`tab !== prev`）且 `AudioContext.state === 'running'`（首次用户手势内已 `resume()`）时调用，重复点同一 tab 不重播、不打扰。SW 升级 `fp-v20`，About 升 v2.8；`verify22` 8/8 全过（时长 720ms、声音函数存在且能正常合成不报错、四个方向切换均触发 flip-in、云 reveal 仍正常、零 console 报错），视觉证据 `tests/v28_flip_slow_mid.png`、`v28_flip_right_mid.png`。
- **v2.7（2026-08-23）**：应需求——在「地图 / 清单 / 统计 / 我的」四个底部 Tab 切换时加一个**书页翻动**特效，且保持丝滑、不动其他任何特效的位置。实现：① `#main` 加 `perspective:1400px`，`.view` 加 `transform-origin:left center` + `backface-visibility:hidden`；② 新增 `.view.flip-in`（关键帧 `pageTurn`：0% `rotateY(-72deg)` + 微暗 → 100% `rotateY(0)`）与镜像 `pageTurnR`（`from-right` 向左切时方向一致）；③ `switchTab()` 按 Tab 顺序（map<list<stats<me）决定方向——向右切新页从左边书脊掀入（`from-left`）、向左切从右边书脊掀入（`from-right`），强制 reflow 后重加 class 保证同一 tab 连点也重播；④ `.flip-in::after` 弧线阴影随翻动渐隐，制造纸张厚度感，`pointer-events:none` 不挡点击；⑤ `prefers-reduced-motion` 自动降级为无动画。该层与 `#reveal-fx` 云特效完全独立（云在 fixed 覆盖层 z-index:250，翻页只在 `#main` 内部），互不影响、位置不变。SW 升级 `fp-v19`，About 更新 v2.7；`verify21` 13/13 全过（四个方向切换均触发 flip-in + 正确方向、云 reveal 仍正常、零控制台报错），视觉证据 `tests/v27_flip_list_mid.png`、`v27_flip_map_right.png`、`v27_reveal_still_ok.png`。
- **v2.3（2026-08-23）**：应反馈「再改一下这个云波雾散特效，还要再点开每个省份，每个城市的时候也要有」——把**开云雾散 / 拨云见日（云波雾散）**从「仅启动 & 返回全国」升级为**所有导航与记录层统一播放**：点开省份（`showProvince`）、点开城市记录层（`openSheet`）、世界模式（`showWorld`）、国家弹层（`openCountrySheet`）、返回全国（`showChina`）均触发 `reveal('boot')`；移除 `reveal('dive')` 的调用点与 `openSheet({dive:true})` 800ms 延迟分支（直接 reveal + 弹层立即显示，`reveal-fx` z-index 250 在弹层 160 之上，pointer-events:none 不挡点击，云散后自然显出记录层）。穿云俯冲（`dive`）的 CSS / 关键帧 / DOM 保留在 `#reveal-fx .fx-haze/.fx-cloud/.fx-blob` 与 `@keyframes droneDive*`/`hazeDive` 中，`reveal(mode)` 仍支持 `'dive'`，便于后续按需重新启用。SW 升级 `fp-v14`；`verify16` 7/7 全过（province / city sheet / world / country / back-to-national 全部断言 `show.boot && !show.dive`，零控制台报错），视觉证据 `tests/v23_prov_boot.png`、`v23_city_boot.png` 清楚显示两片写实积云从中央拨向两侧、中央太阳破出。
- **v2.1（2026-08-23）**：用户反馈「那个开云雾散特效怎么不见了」——v2.0 把启动特效也换成了穿云俯冲，导致丢失了原 v1.8 的「拨云见日」。恢复启动 & 返回全国为**开云雾散 / 拨云见日**（写实云 PNG 从中央拨开 + 太阳破出 + 天空淡出），点省份/城市/世界/国家保持**穿云俯冲**。两套共享 `#reveal-fx` 容器，按 `reveal('boot')` / `reveal('dive')` 模式切换；`#reveal-fx .fx-sky/.fx-boot` 与 `.fx-haze/.fx-cloud` 互斥 `display:none` 显隐，避免串场。`reveal()` 接受 `mode` 参数（`'dive'` = 俯冲；缺省 = boot）；调用点：showChina → `'boot'`，showProvince/showWorld/openSheet/openCountrySheet → `'dive'`。SW 升级 `fp-v12`，双特效视觉帧在 `tests/v21_*.png`；verify14（14 项）全过。
- **v2.0（2026-08-23）**：应反馈「不是拨云，是无人机俯冲」，重新看用户视频——画面是**无人机从云层中俯冲而下**：前期完全被白蒙蒙的云包住（柔白雾充满屏幕），中段云团从镜头前冲过去、放大、冲过镜头并淡出，下方渐渐显出地形（视频里是海面+货船+小船+远岸）。把 v1.9 的「左右拨开 + 中央见日」整套废弃，重写为**穿云俯冲（drone dive through clouds）**：① 容器 `#reveal-fx` 加 `perspective: 800px` 提供真实近大远小，内层 `.fx-cloud` 用 `transform-style: preserve-3d`；② 三团实心软云 `.fx-blob`（`border-radius:50%` + `filter:blur(50px)`，**实心** cream 色而非带 alpha 的径向——保证峰值时屏幕真正被云包住、不露地图），用 `translate3d(0,0,Z) scale(S)` 从 Z=0/S=0.35（小、远）冲到 Z=620/S=2.6（大、已过镜头），opacity 0→.95→0；错峰 .04/.06s 营造连续穿层；缓动 `cubic-bezier(.25,.7,.3,1)`。③ `.fx-haze` 改为**实心** linear-gradient（去掉带 alpha 的径向）做全屏 cream 雾底，配合 `hazeDive`（opacity 1→0 + scale 1→1.18）在 0~100% 同步淡出，保证 1.4s 时屏幕**干净透明**露出地图（v1.9 残留的 `.fx-sky` 静态色已在容器去背景 + haze 接管后解决）。④ 居中效果，不再需要落点定位（视频也是居中穿过云层）；删掉 `--dive-x`、`.dive` 模式、`onMapClick` 的 `tapX` 计算；`showProvince`/`openSheet` 不再传 tapX。⑤ 弹层仍 800ms 延迟升起（city 点开时与云散同步）。⑥ 资源体积骤降：v1.9 用的写实云贴图 `cloud_l.png`/`cloud_r.png` 不再需要，可清理。验收（Playwright headless iPhone 390×844，verify13，13/13 全过）：t0 fx `.show` + b1 存在 + fx opacity≈1；t=400ms b1 opacity .989 + rect 646×646（远超 351 基础尺寸，证明 perspective+scale 让云真实「冲到镜头前」）；t=900ms b1 .221 + haze .340（视觉云雾已大幅散去）；t=1500ms fx `.show` 已移除（定时器清理）；`showProvince(330000)` 完成且 reveal 收尾；`openSheet('CN330100',{dive:true})` 200ms sheet hidden、1100ms 显示；零控制台报错。视觉证据 `tests/v20_*.png` 10 张：60ms 一团云从中央淡入、480ms 整屏被 cream 云实心包住（顶栏/底栏只剩影子）、900ms 云散露出浙江地图、1200ms 城市弹层「我去过这里」同步升起。SW 缓存升级 fp-v11。
- **v1.9（2026-08-23）**：应需求「再点开每一个省份和每个城市中，加上这个俯冲特效」，将拨云见日从单一启动/返回播放升级为**两套动画**——(A) 普通 reveal：居中拨开，保留 v1.8 的写实云贴图与音效；(B) **dive 俯冲**：点开每个省份/城市时触发，云朵从落点向四周**冲过镜头**（同时 translateX ±132% + scale 0.88→1.85 = 擦过镜头的速度感），天空独立推进（scale 1→1.16 = 纵深前推），太阳从落点破出（更大爆发 `sunBurstDive` 1.15→1.9）。落点定位：`#reveal-fx` 暴露 CSS 变量 `--dive-x`，`.fx-cloud` 用 `calc((--dive-x - .5) * 100%)` 把拨开中心平移到指尖；JS 通过 echarts 透传的 `params.event.clientX / innerWidth` 写入。城市点击的弹层改为**延迟 800ms 升起**，刚好与云朵拨开同步（云在 1.1s 拨开，弹层 0.8s 起 rise），先「飞入」再「落定」。列表/收藏点击仍走普通 reveal（保持转场）。实现要点：背景渐迁到独立 `.fx-sky`（可独立缩放），`.fx-cloud` 容器用 CSS 变量平移（不影响子元素动画），boot reveal 完全保留（verify11 仍 PASS）。验收（Playwright headless iPhone 390×844，verify12，共 23 项全过）：① `reveal('dive',0.3)` 后 `.show.dive` 存在、`--dive-x≈0.3`、`.fx-cloud` 平移 -78px；② 中段 c-left 矩阵 `matrix(1.43, …, -203.7)` 同时具有 translateX<-150 与 scale>1.4、c-right 对称 +203.7、`.fx-sky` 缩放 1.10、`.sun` opacity 0.99；③ 末段 c-left 完全离屏 ±360.4（>250 阈值）、fx opacity 0.28（已淡出）；④ `showProvince('330000',0.3)` 完成后 `S.curProv=330000`、`chartMap=prov_330000`；⑤ `openSheet(id,{dive:true,tapX:0.6})`：200ms 时 sheet 仍 hidden、`.dive` 生效、`--dive-x≈0.6`；1000ms 时 sheet 显示且标题「杭州市」已写入；⑥ 零控制台报错。视觉证据：`tests/v19_prov_dive_mid/end.png`、`tests/v19_city_dive_mid/end.png`。SW 缓存升级 fp-v10。
- **v1.8（2026-08-23）**：按用户提供的 AI 生成云景视频（568×320 写实云景：两侧大块蓬松积云+金色受光花椰菜顶部+蓝灰阴影+中央见日），将拨云见日从 CSS 渐变云升级为**写实云贴图**：① 用 ImageGen 生成单团积云（带金色受光右侧），用 Python+PIL+scipy 通过连通域洪水填充抠去背景蓝天（只去与图片边缘相连的蓝天，云体内部蓝灰阴影保留）、高斯羽化边缘、自动裁到包围盒；② 水平镜像得右云（金边朝左）；③ 旋转 90° 变横构图（912×720），cover 进竖向 piece 时裁上下保留中间最蓬松的水平带，金色受光花椰菜顶部自然落在屏幕上半部——这是参考视频风的关键；④ 片宽 70%，配合柔化天空背景（去掉深棕端）与圆形太阳辉光（消除竖向延伸），中央形成自然的窄光缝透日。保留柔和 whoosh+shimmer 音效与 v1.7 的「云完全滑出 + 整层淡出」动效（拨开 1.1s + 天空淡出 1.3s）。验收（Playwright headless iPhone 390×844，verify11）：写实云贴图 `backgroundImage` 加载成功、中段云拨开 ±270px、末段完全离屏 ±322px、天空淡出至 0.37、AudioContext 创建并 `running`（音效无异常）、零控制台报错。SW 缓存升级 fp-v9；新增资源 `assets/fx/cloud_l.png`、`cloud_r.png`（去背景 PNG，约 1MB/张）。
- **v1.5（2026-08-22）**：应需求将入场特效做成「两版可切换 + 各自音效」。① 云朵展开：两团蓬松云贴（SVG data-uri 云朵造型 + 白色渐变）从屏幕中央向两侧散开（±120%，0.92s），背后柔光云带淡出、中央金色见日光晕扩散后淡出——解决旧版「没有云朵展开感」的反馈；② 撕纸：两半纸（羊皮纸质感 + `clip-path` 锯齿缝）从中间向两侧旋转分离（±120% 且各旋转 ±9°，0.85s）。两者由 `#reveal-fx[data-fx]` 切换，仅激活模式可见并播放动画。音效用 **Web Audio 合成**（无需外部音频文件、离线可用）：云朵=带通噪声扫频 whoosh + 两枚轻柔正弦 shimmer；撕纸=高通噪声爆破 rip + 5 段细碎纤维 crackle。设置项「我的 → 入场特效」分段切换并实时预览，写入 `localStorage(fp_reveal_fx_v1)`；首次用户手势内 `resume()` AudioContext 以符合自动播放策略。验收（Playwright headless iPhone 390×844）：双模式 `#reveal-fx.show` 即时生效、激活层中非单位矩阵位移+旋转、非激活层 `display:none`、AudioContext 创建并 `running`（音效代码执行无异常）、控制台零报错。SW 缓存升级 fp-v6。
- **v1.7（2026-08-22）**：修复拨云见日「拨到一半被硬切」的问题——原动画只平移 ±40%（两侧仍各盖 25%/屏宽），最后靠 `display:none` 突变露出地图。改为：① 两片云**完全滑出屏幕**（±118% × 宽 65% ≈ ±77%vw，彻底离开视口），真正全部拨开；② 新增整层天空+太阳的 `fxSkyFade` 淡出关键帧（云拨开后约 0.75s 起整体由不透明渐隐至 0），**由淡出平滑露出底图地图**，不再硬切；③ 定时器延长到 1500ms（淡出完成后才移除容器）。验收（Playwright headless iPhone 390×844，verify10）：云末端完全离屏（|translateX|≥254px）、天空淡出至 opacity 0 且此刻 `show` 仍为真（淡出承担揭示）、定时器最终移除 `show` 时已全透明（不可见跳变）、零控制台报错。SW 缓存升级 fp-v8。
- **v1.6（2026-08-22）**：按用户提供的参考图（体积感大块积云 + 暖金内缘 + 冷蓝灰外缘 + 中央金色见日光晕 + 底部云海）重做拨云见日特效：每片云 12 层径向渐变堆叠做体积与受光；移除撕纸模式与「我的」切换（只保留云朵展开）；保留柔和 whoosh+shimmer 音效。SW 缓存升级 fp-v7。
- **v2.2（2026-08-23）**：找回「开云雾散 / 拨云见日」启动特效——诊断两个被忽视的 bug：① `#splash` z-index:200 高于 `#reveal-fx` z-index:150 导致启动屏完全遮住 reveal 动画（用户看 splash 1.1s，淡出后只剩云尾段可见）；② `sw.js` 的 CORE 数组未列 `assets/fx/cloud_*.png`，卸载重装 PWA 时云图根本没预缓存——只看到蓝天 + 太阳，没有"两片云"。修复：reveal-fx z-index 提至 250；`showChina({silent:true})` 启动时跳过 reveal，由 boot() 在 splash fade 同帧 350ms 后触发 reveal('boot')（云在 z=250 上独立展开，splash 移除后云继续拨开自然过渡到地图）；cloud PNG 加入 SW CORE 升 fp-v13；新增「我的 → 重看入场特效」按钮随时复看；`verify15` 18/18 全过。
- **v1.3（2026-08-21）**：拨云见日入场特效——进入省份、进入城市（记录弹层）、世界模式、返回全国地图时，两片白云从屏幕中央向左右两侧散开（0.85s，cubic-bezier 缓出），露出下方地图/弹层；实现为 `#cloud-fx` 覆盖层 + CSS 关键帧 + `cloudReveal()` 函数。z-index 层级：`#splash:200` > `#sheet 等:160` > `#cloud-fx:150` > 地图/顶栏，启动屏与弹层在云之上，初始打开不出现云、进入时云遮地图 0.85s 后散去。SW 缓存升级 fp-v4。
- **v1.2（2026-08-21）**：借鉴 GitHub 开源项目完善——① 一键生成「足迹分享图」（地图+统计合成 PNG，可保存/系统分享，思路来自 ozanyerli/turkeyvisited）；② 年度时间轴（按首次到访年份聚合，柱状可视化）；③ 深色模式（来自 tomi5/visited-countries-map、rbardini/countryquest）；④「想去的地方」愿望清单（地图蓝色虚线描边+清单专区，来自 countryquest「where to go next」）；⑤ 统计页环形覆盖率进度条。备份含愿望清单（version 2）；SW 缓存升级 fp-v3。
- **v1.1（2026-08-15）**：省份点亮从分桶改为按比例的连续色阶（去 1 城不再整省点亮，足迹越密颜色越饱满）；视觉全面升级（启动屏、渐变顶栏、卡片化、统计大数字、弹层副标题、毛玻璃质感）；SW 缓存升级 fp-v2。
- v1.0（2026-08-15）：首版发布。

## 产品定义

- **做什么（goal）**：中国城市（地级）+ 世界国家/热门城市的到访记录；地图点亮可视化（中国省级→城市级钻取、世界国家级）；每城日期/次数/笔记/照片；统计面板；本地备份导出导入。
- **不做什么（non-goal）**：无后端、无账号、无云同步、无社交分享、不做行程规划、不调用定位。
- **数据边界**：记录存 localStorage，照片存 IndexedDB，均为本机私有存储（符合个人信息保护要求，不上传任何服务器）。
- **已知取舍**：台湾省/香港/澳门/直辖市按整体作为一个目的地（DataV 无台湾县级数据）；国外冷门地区（无中文名映射）不可记录。

## 技术栈

- 纯静态 PWA：原生 HTML/CSS/JS + ECharts 5.6.0（本地打包，无 CDN 依赖）
- 地图数据：DataV GeoAtlas（高德数据源，中国，含南海诸岛）、echarts4 内置 world.json（Natural Earth 数据，世界）
- PWA：manifest + Service Worker（核心预缓存 + 省级地图运行时缓存），全离线可用
- 构建工具：`tools/build_data.py`（数据加工）、`tools/make_icons.py`（图标生成）

## 目录结构

```
workspace-013/city-footprint/
├── src/                    # 源码（本地预览/构建源）
├── dist/                   # 构建产物（src 镜像，部署用，含 SW fp-v20）
│   ├── index.html
│   ├── app.js / styles.css / sw.js / manifest.webmanifest
│   ├── lib/echarts.min.js
│   ├── icons/              # PWA 图标
│   └── assets/
│       ├── geo/china.json / world.json / city/{adcode}.json
│       ├── geo/raw/        # 原始下载数据（不部署）
│       └── data/destinations.json
├── tools/                  # 数据与图标构建脚本
├── tests/                  # 验收证据（截图等）
└── docs/                   # 文档
```

## 本地开发

```bash
# 重新生成数据
python tools/build_data.py
# 本地预览（src 目录起任意静态服务）
cd src && python -m http.server 8080
```

## 验收标准

1. iPhone Safari 打开 → 添加主屏幕 → 独立窗口运行，断网可用
2. 中国地图点击省份 → 城市级地图 → 点击城市 → 弹层记录并点亮
3. 世界地图点击国家 → 城市清单 → 记录并点亮；中国不可在世界图记录
4. 照片压缩入 IndexedDB，缩略图/大图/删除正常
5. 统计数字与记录一致；导出 JSON → 清空 → 导入后数据完整恢复
6. 中国地图完整包含台湾省与南海诸岛（十段线）
