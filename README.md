# 字灵 · Zì Líng

> 一只由「字」排成栅格、会呼吸变形的小生灵；日程词与 AI 建议可融入躯体。

一个移动端友好的电子宠物模块。纯前端实现（HTML + CSS + JS，零依赖、零打包），
可以通过 **WebView** 直接嵌入任何安卓 App（原生、Flutter、React Native、uni-app、Hybrid 皆可），
也可以独立部署为网页。

## 如何查看效果

### 在线演示（GitHub Pages）

若仓库已启用 **GitHub Pages** 且 **Source** 选为 **GitHub Actions**（本仓库提供 `.github/workflows/pages.yml`，在 `main` 推送后自动部署），站点一般为：

**https://reaor.github.io/virtualpet/**

若打不开或仍是旧版：在 GitHub 打开 **Settings → Pages**，确认 **Build and deployment** 的 **Source** 为 **GitHub Actions**，并确认 **最新改动已合并到 `main`**（合并后等待 Actions 绿勾再刷新）。

### 本地

**最简单：**
1. 用浏览器打开 `index.html` 即可（双击文件，或拖进 Chrome/Edge/Safari）

**推荐（移动端预览）：**
1. 在 `index.html` 所在目录启动一个本地服务：
   ```bash
   python3 -m http.server 8765
   # 或 Node: npx serve .
   ```
2. 在电脑/手机浏览器打开 `http://<你的局域网 IP>:8765/index.html`

### 活字栅（规整排版）

字灵目标点吸附在隐形格上；`gridUnity` 开启时（默认）为 **统一字号阶梯 + 约 4° 一档的离散倾角 + 绘制像素对齐**，整体位移仍由弹簧完成，换形瞬间有短促「落格」收紧弹簧。可在 `new Pet(canvas, { gridUnity: false })` 关闭对比。

排版气质上接近 **等宽字阵 / 活字盘**（与 FIGlet、cool-retro-term、各类 terminal ASCII art 的「格对齐」思路同向）；本项目仍是自研 Canvas 弹簧，未捆绑某一第三方排版库。

## 文件结构

```
├─ index.html     页面结构（可按需裁剪）
├─ styles.css     夜雾界面、卡片、工具栏等样式
├─ pet.js         字灵本体（粒子物理、形态、渲染引擎）
└─ app.js         应用层（交互、喂食、UI 集成）
```

## 核心玩法

| 交互 | 表现 |
|---|---|
| 戳一戳 | 画面涟漪，字灵会害羞或惊讶 |
| 拖拽 | 按住字灵可以把它拖到任意位置 |
| 双击 | 字灵"化蛇"进入**觅食模式**，在画布里蜿蜒游走吞食"字" |
| 点击下方诗笺里的任意字 | 该字飞入字灵身体，并且**持久保留**在它的"字池"里 |
| "变"按钮 | 手动切换形态 |
| "觅"按钮 | 触发觅食 |
| "眠"按钮 | 小憩（闭眼） |
| "抖"按钮 | 抖擞（粒子炸开） |
| 无操作自动 | 每 8 秒随机换形 / 偶尔眨眼 |

## 形态库（10 种，可自由扩展）

软团 / 猫 / 狐 / 兔 / 锦鲤 / 蝶 / 花 / 心 / 月 / 龙

添加新形态：打开 `pet.js`，在 `FORMS` 对象里加一项。形态有两种定义方式：

1. **画轮廓 + 采样填充（推荐）**：在一个离屏 canvas 上画出剪影，字灵会自动在不透明区域均匀铺满字。
   ```js
   mything: {
     label: "云",
     build(n, S) {
       const targets = sampleSilhouette((ctx, s) => {
         ctx.fillStyle = "#000";
         // 你的剪影绘制...
       }, S, n);
       return { targets, eyes: [{x:-10,y:0},{x:10,y:0}], eyeSize: 1.4 };
     }
   }
   ```

2. **数学曲线（更光滑）**：提供参数化函数 `t => [x, y]`，用 `parametricPoints` + `fillFromOutline` 铺字。
   蝶、花、心的定义就是这样做的，可参考。

加完之后在 `FORM_ORDER` 数组里加上这个 key 就会进入轮播。

## 字池（核心亮点）

- 默认带 40+ 个诗意字符（云月风雨雪露霜霞星辰烟岚山川…）
- 用户在页面上点字、或字灵觅食时吞的字，会**持久加入** `pet.eatenChars`
- 下一次换形时，它身上会带着你喂过的字 → 字灵会越来越"像你"
- 如果接入了服务端：可以每日从服务端拉一份"今日字集"，做成**每天有不同字灵**的效果

## 嵌入你们的安卓 App（给开发同事看的）

### 方案 A：WebView 嵌入（最简单，改动最少）

把 `index.html + styles.css + pet.js + app.js` 四个文件放进 app 的 `assets/` 目录，用 `WebView` 加载：

```java
// Android 原生 Java 示例
WebView webView = findViewById(R.id.pet_web_view);
webView.getSettings().setJavaScriptEnabled(true);
webView.setBackgroundColor(Color.TRANSPARENT); // 让宣纸底与宿主背景融合
webView.loadUrl("file:///android_asset/pet/index.html");
```

### 方案 B：只要宠物画布，不要示例 UI（嵌入更轻）

只保留画布，移除诗笺卡片和工具栏：

1. 在 `index.html` 里把 `.feed-panel`、`.toolbar`、`.app-bar` 几块删除
2. 仅保留 `.stage > #petCanvas`
3. 通过 JS 暴露控制接口（已经预留）：
   ```js
   window._pet.setForm('cat')        // 变形
   window._pet.sleep(true)           // 休息
   window._pet.shake()               // 抖擞
   window._pet.addPoolChars(['朋','友'])  // 往字池塞字
   window._pet.flyInChar('爱', x, y) // 让一个字从 (x,y) 飞入字灵
   ```

### 方案 C：把字灵画在 app 的原生页面上（更贴合）

把 `pet.js` 里的 `Pet` 类抽出来，在你们的 WebView 透明浮层（或者 React Native `react-native-canvas`、Flutter `CustomPaint`）里运行。
`Pet` 类只依赖一个 2D Canvas context，移植性很好。

## 自定义点

| 想改什么 | 去哪改 |
|---|---|
| 底色/纸本/印章颜色 | `styles.css` 顶部的 CSS 变量 |
| 粒子数量（性能/密度） | `app.js` 里 `new Pet(canvas, { particleCount: 140 })` |
| 默认字池 | `pet.js` 里的 `DEFAULT_POOL` |
| 换形时间间隔 | `app.js` 最后 `setInterval(..., 8000)` |
| 新增形态 | `pet.js` 的 `FORMS` |
| 新增表情 | `pet.js` 的 `EXPRESSIONS` 及渲染分支 |
| 觅食路径 | `app.js` 的 `triggerFeeding` |

## 性能

- 默认 140 粒子，Canvas 2D，在中低端安卓机 WebView 里也能稳 60fps
- 若想更繁盛：`particleCount: 240`
- 若机型羸弱：`particleCount: 80`

## 字体

默认使用 [霞鹜文楷 LXGW WenKai](https://github.com/lxgw/LxgwWenKai)（SIL OFL 开源许可，商用无忧），
通过 jsDelivr CDN 引入。离线部署可自行下载字体文件改为本地路径。
