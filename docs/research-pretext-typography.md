# 研究笔记：Pretext 思路、开源启发与字灵排版/字体统一

> **目的**：把「为什么快」与「是否敷衍」拆开——快来自小步可验证的 diff；**深度**来自可复查的文献映射与代码锚点。本文不引入 npm，只记录**可落地的原则**与仓库内对应位置。

---

## 1. Pretext（chenglou/pretext）在说什么

[Pretext](https://github.com/chenglou/pretext) 一类工具的核心哲学可概括为：

1. **测量少次、口径一致**：热路径里避免反复创建上下文、避免同一字符串用不同 `font` 字符串量宽。
2. **布局与绘制同源**：折行、advance、fallback 链在「算」与「画」之间不漂移。
3. **缓存与惰性**：能 memo 的测量结果不重复算；大改动才失效。

字灵（零构建、纯 Canvas + DOM）的对应关系：

| Pretext 式原则 | 字灵实现锚点 |
|----------------|-------------|
| 单测量上下文 | `getMacroMeasureContext2d()`（`pet.js`），注释已标明借鉴思路 |
| 同口径绘制 | `createMacroTextDraw` 与 `measureMacroLayoutMaxWidth` 共用 `FONT_*` 栈 |
| 少次 resolve | `setForm('mega')` 将 `megaResolvedCache` 传入 `buildFormLayoutData`，避免三重 `resolveMegaLayoutInput` |
| 粒子预算 memo | `suggestMegaGlyphParticleCount` 的 bounded `Map` |

后续可继续深化的方向（未承诺工期，仅架构占位）：

- `document.fonts.ready` / `document.fonts.load` 与巨字首次栅格对齐（见 `docs/typography-forward.md` §2 浏览器原生节）。
- 可选 `js/ziling/text-layout-bridge.js`：仅 `mega`/`kao` setForm 调用，主循环零依赖（见 `typography-forward.md` §3）。

---

## 2. 全页字体统一（DOM）

**决策（3.35.7）**：在 `:root` 引入 **`--font-app`** 作为唯一正文/界面汉字栈；`--font-ui` 与 `--font-serif` 均 **`var(--font-app)`**，避免侧栏、文稿、诗笺、标题各写一套互不引用。

- **等宽**仍独立为 `--font-mono`（代码、部分技术文案），不参与「字气质」统一栈。
- **画布**内 `drawGlyph` 仍使用与 CSS 同序的 LXGW 优先栈（见 `pet.js` `fontMain`）；巨字离屏 mask 的 `FONT_MACRO_CJK_OPEN` 已与 DOM 对齐 LXGW 前置，减轻「屏上粒子字 vs mask 统计字」漂移。

若日后要严格区分「系统 UI 无衬线」与「字灵衬线」，应先在 `DESIGN.md` 改 §2.4 再拆变量，避免 silent 回退。

---

## 3. 巨字形态与单字运动（与 DESIGN §2.5 对齐）

产品真源：`DESIGN.md` §2.5（轮廓优先、统一节拍、亚格颤与谐步、滞回与 ensemble）。

代码真源（迭代入口）：

- 呈现层时间尺度：`mergePresentationSilhouetteMotion` → `DISPLAY_MOTION_KERNELS`。
- 严格格点 / 滞回：`strictSilGrid` 分支与 `g._silHistDgx` / `_silHistDgy`。
- 亚格绘移自适应：`g._silDrawOx` / `_silDrawOy`（开「颤」）。
- 弱去相关：`crispMotion` 与 crisp 流体支路。
- 辨形 alpha：`megaSilPres` 的 `edgeAlpha`。

「创新构架」在本仓库的务实含义是：**layout 输出与 motion 读取解耦**、**测量与绘制同栈**、**层级内核只看 `uiArcMode`**——已在 `typography-forward.md` §3 与 `HANDOFF.md` 状态机章节分层叙述。

---

## 4. 如何自行核对「有没有在推代码 / PR」

- 远程分支：`git fetch origin && git log origin/cursor/mega-present-readability-e208 -5 --oneline`
- GitHub 比较：`https://github.com/Reaor/virtualpet/compare/main...cursor/mega-present-readability-e208`
- 构建号：页面页眉 `build …` 与 `meta ziling-build` 应对齐 `index.html`

若 Cloud Agent 创建的 PR 已合并或关闭，Compare 链接仍可看完整 diff。

---

## 5. 顺滑感与 Pretext：性能与「有序」节拍（3.35.8–3.35.18）

Pretext 类工具的「丝滑」多来自 **少做无效工作** 与 **稳定的时间片语义**；字灵在 **mask 巨字/颜** 下，主线程热点常在 **`_separateOverlappingGridGlyphs`（多 pass × 全量 Map）** 与 **`fillText` 粒子绘制**。

**3.35.8 已落地的工程取舍**（见 `pet.js` 与 `DESIGN` 变更表）：

- 呈现剪影叠分 **第二遍** 与开内动一致改为 **隔帧**（关内动不再每帧双遍），降低持续卡顿；仍保留每帧 **第一遍** 与 passes 内收敛。
- `presDense` 下叠分 **passes** 略减一档，在辨形与算力之间再收一点。
- **mask 剪影** 的 `_ensemblePhase` 增量去掉轻微 `sin(t)` 调制，节拍更恒定；`crispMotion` / crisp 流体 **去相关幅**略收，观感更接近「齐舞」式有序弱变。

验收：肉眼帧时间与 `?dev=1` 画布右上 **upd** 分段；若 `upd` 仍高，下一步应剖 `rasterizeMask` / 粒子上限而非再叠随机谐波。

**3.35.15 补充**：贴边交互用 **持续脉冲 `_tapScatter` + 慢回聚（格目标 lerp→家格）** 表达「撞散—试图合拢」；巨字 mask 不再跳过撞散，只收幅以保辨形。与 §5「少次」张力：脉冲有节流、回聚用低 `alpha`，仍主要靠现有格迈与叠分。

**3.35.16 补充**：**绘图层冲量**与活动区 **外壁光晕** 专管「一眼可见」的碰壁/沙拨反馈，避免仅靠被 `sc` 压弱的 `_tapScatter` 绘移。

**3.35.17 补充**：巨字贴边 **禁高频 `_wallShatter` 脉冲**（改单次 `edgeEntry` + 缓聚），并去掉巨字在 `dragTo` 里 **每 70ms** 的重复触墙，消除「顶边持续乱颤」。

**3.35.18 补充**：用户取向 **非物理碰撞** → 贴边改为 **相干挤压场**（切向摊开），**拖整体顶边**与 **非拖碰壁** 均弱化/去掉 `_wallShatter` 字粒随机撞散。

**3.35.14 补充**：沙拨入口从①区末格迁至 **② 区顶行整宽**并加样式，避免「键多 + 侧栏滚动」导致用户**看不到拨键**；推开除 `wx` 亚格位移外增加 **`tgx/tgy` 整数踢格**，避免效果被 `round(wx/cell)` 吞没。

**3.35.13 补充**：拨开交互若仍要求「起手点必须在字灵体内」则与「沙面任意划」心智冲突；将 **pending 指针会话** 在拨开模式下扩到整画布，并把侧栏激活态与 `pet` 状态同步，避免「看起来没开」。

**3.35.12 补充**：**拨开模式**与沙缘反馈：交互拆成「整体拖」与「体内拨字」两态，避免一次拖移同时驱动壳与字粒目标；缘上行为用 **短冲量 + 冷却** 保持可读节拍，与 §5「少次、一致口径」同向。

**3.35.11 补充**：嵌入 **Android WebView / 移动 Safari** 时自动 **`_embeddedMobilePerf`**：先减 **像素缓冲分辨率（DPR cap）** 与 **每帧叠分/装饰绘制**，再动粒子规模；与 Pretext「少做无效工作」同向。桌面强制对照可 **`?mobilePerf=0`**。

**3.35.10 补充**：侧栏每次点击后在 **同一微任务尾部** 调用 `stabilizeAfterControl`：**`snapshotArcVisualPrefs` → `applyArcVisualPrefsToPet` → `_applyGridTypography`**，必要时再叠分 —— 对应 Pretext 的 **测量/排版与绘制少次、同口径**；避免「只写了桶、忘了写活属性」或反之的双轨漂移。

**3.35.9 补充**：呈现剪影躯体绘制走 **统一 em → 统一 round(px)**，减少「同形下字大小不一」；墨色 / cel / 浮光 在 `megaSilPres` 关内动路径 **压边缘与相位差** 以减「深浅不一、微乱」。叠分在 **关内动** 恢复 **每帧双遍**（开内动仍隔帧第二遍）——用算力换共格稳定；与 `DESIGN.md` 变更表「3.35.9」一致。
