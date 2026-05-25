# 字灵（Zì Líng）项目解任 / 接手说明书

> **用途**：供后续 AI 或工程师在 **少试错** 的前提下理解仓库、产品意图、技术债与已知坑。  
> **用户声音、多轮会话归纳、开放题**：见 **`docs/CONTEXT_ARCHIVE.md`**（建议新会话 **最先**读）。  
> **产品原则与接手顺序（美观 / 流畅 / 创新）**：见 **`docs/AI_CONTINUITY.md`**。  
> **局限**：完整人类对话记录不在本仓库；下文 **需求要点** 来自 `PLAN.md` / `DESIGN.md`、代码注释、以及迭代中反复出现的用户反馈的 **归纳**（非逐字「提示词」存档）。若与主分支行为不一致，以 **`index.html` 的 `ziling-build`** 与 `pet.js` 为准。

---

## 1. 产品一句话

**字灵**：以汉字粒子为「躯体」的 living character，可与日程/文稿交互；核心审美是 **辨形优先**——巨字/颜文字等 **mask 剪影** 上，小字需 **沿可走格规整运动**、少重叠、少混沌颤动；**呈现层**与**待机层**应有清晰不同的运动与 UI 语义。

---

## 2. 仓库与入口

| 路径 | 角色 |
|------|------|
| `index.html` | 页面结构、侧栏 `data-action`、**各控件 `title`（悬停说明）**、分区 `rail-section` / `control-block`、`meta ziling-build`、**`#helpDialog` 入门说明（与 DESIGN 对齐）** |
| `styles.css` | 布局：`playfield`、左右 `rail`、`stage`、`#petCanvas` |
| `app.js` | 绑定 UI、URL 参数、Toast、`new Pet(canvas, opts)`；**必须语法有效**，否则整页无 Pet、无版本号、按钮全失效（曾发生误删 `syncRailUiArcClass` 函数头） |
| `pet.js` | **主体**：形态布局、栅格、物理/渲染、呈现层逻辑、`_arcPrefs` |
| `js/ziling/shape-field.js` | 可走格 / 壳层 / 形场（AI 矩阵伏笔） |
| `js/ziling/shape-consumer.js` | 外部 walk 消费 |
| `js/ziling/matrix-bridge.js` | 矩阵桥占位 |
| `PLAN.md` | 需求对照、版本摘要 |
| `DESIGN.md` | 设计原则、矛盾处理、变更记录 |
| `docs/ZILING_LAYOUT.txt` | 文件职责速览 |

**本地打开**：静态文件即可；注意 **带 `?v=` 缓存** 强刷。

### 2.0 GitHub 与拉取请求（便于人类核对）

- 本仓库远程一般为 **`https://github.com/Reaor/virtualpet`**（以 `git remote -v` 为准）。
- 功能分支示例：`cursor/mega-present-readability-e208`。在 GitHub 上可用 **Compare** 查看相对 `main` 的完整 diff：  
  `https://github.com/Reaor/virtualpet/compare/main...cursor/mega-present-readability-e208`
- Cloud Agent 可能创建或更新 **Draft PR**；若 PR 已合并/关闭，历史上仍可在 **Pull requests → Closed** 或上述 Compare 链接中看到改动。
- **页眉构建号**（`buildStamp` / `ziling-build`）应与当前 `index.html` 一致，作为「线上是否已吃到最新静态文件」的一眼校验。

---

## 3. 核心状态机（必读）

### 3.1 `Pet.uiArcMode`（侧栏「层」）

- **`standby`**：待机曲线/软团等；运动内核 **`STANDBY_MOTION_KERNELS`**（全 1 倍率）。
- **`presentation`**：计时 / 巨字 `mega` / 颜 `kao_*` 等；内核 **`DISPLAY_MOTION_KERNELS`**（整体压低 time/amp）。

**关键**：内核选择 **只看 `uiArcMode`，不看形态名**（`getMotionProfileKernelsForPet`），避免「计时与曲线错位」类历史 bug。

### 3.2 呈现层剪影（巨字 / 颜）

`isPresentationSilhouetteHarm(self)` **定义为**：

```text
uiArcMode === "presentation" && isMaskBackedMegaKao(self)
```

凡文档写「呈现剪影」「presSilHarm」，均指此交叉条件。

### 3.3 分层视觉偏好 `_arcPrefs`

- 键：`standby` / `presentation`，各自存 **色、墨、浮、波、粒、走格、颤、紊、整块灰底、淡影、字内动、macroFitMode、megaLayoutScale** 等（侧栏易读名；代码字段仍为 `bodyMotionStyle` / `silhouetteMatteUnderlay` / `outlineContourFirst` / `presentationGlyphDynamics`）。**`glyphMotionSpeed` / `gridMarchSpeed`** 字段仍存在于对象中，但 **`snapshotArcVisualPrefs` / `applyArcVisualPrefsToPet` 覆写为全模态统一常量**（见 `pet.js` `FIXED_*`）。
- 切换「层」时 `applyArcVisualPrefsToPet` / `snapshotArcVisualPrefs` 读写当前套。  
- **连点 / 嵌入**：`app.js` 左栏 `finally` 调 **`Pet.scheduleStabilizeAfterControl`**（合并同一 tick 内多次调用，尾部只跑一次 `stabilizeAfterControl`；`layoutHard` 按 OR 合并）。

### 3.4 「动」`presentationGlyphDynamics`

- 仅存 **`_arcPrefs.presentation`**（待机层无此概念）。
- **`presGlyphSleep`**：`isPresentationSilhouetteHarm && !presentationGlyphDynamics`  
  → 关「动」时体内谐波/流体等大幅压低，**先静后动**。
- **与「整块灰底」**：**呈现层巨字/颜**不调用 **`_drawSilhouetteMatteUnderlay`**（轮廓由小字拼形）；开「字内动」时亦不叠底。待机层可按「整块灰底」叠显式垫底；关内动且开「淡影」、未开整块灰底时 **待机** 可叠极弱整 mask（**3.33.4** 链；**3.34.2** 起呈现层彻底不叠）。

---

## 4. 运动与栅格（易混点）

| 概念 | 说明 |
|------|------|
| `gridMarch` / `gridSnapping` | 格点迁移开关与吸附 |
| `silhouetteStrictHarmonicGrid` | 谐波 + 无蛇/无游走 + **关颤** → 严格格点曼哈顿 |
| `bodyMotionStyle` | `harmonic` / `snake_stream` / `contour_drift`（mask 躯体轨） |
| `textureMotionMode` | `spring_flow` / `adjacent_swap`（与轨正交的纹理体动） |
| `_silDrawOx/_silDrawOy` | 亚格绘制偏移；由「颤」`silhouetteGlyphJitter` 控制 |
| `motionTimeBlend` | 固定低速基 `gms0` 与层内核 `timeScale` 的凸组合，避免呈现层节拍被压到「几乎不动」 |
| `mergePresentationSilhouetteMotion` | **仅** `isPresentationSilhouetteHarm` 时在 DISPLAY 内核上再压低 |

### 4.1 呈现层剪影格移

- `stepBudget`：**3.35.25** 起呈现剪影与待机 **同一套** `_gridMarchFrameAcc` 累积、`floor` 扣减；**3.35.27** 起呈现 mask 巨字/颜另设 **每帧 cap 1～2 格** + **`presMarchAccMul`**，避免与待机同用 **3 格/帧** 时叠分+march 双峰值。**3.35.25**：解耦拖仍跑剪影叠分第二遍。
- **3.35.29**：渐进换形 **`morphFinalMeta.morphGridCell`** 与布局吸附步长一致；**`startMorphTo`** 起重绑 **`mgx/mgy`**；march / 完成检测 / **`g.x`** 用同一 morph 格距；换形中 **不跑叠分与剪影空位拉粒**。
- **3.35.28**：渐进换形 **`_finishMorph`** 须 **`rasterizeMask`**（与 `setForm` 同）；**`_computeMorphGridTargets(mega)`** 临时 **`gridCell` + `megaResolved`**。
- **3.35.27**：呈现剪影 `_separateOverlappingGridGlyphs` **遍数大降**；格迈 **cap 1～2** + `presMarchAccMul`；生命周期后叠分 **开内动 maxPasses 2**；`silStyleHarmMul` / `_silDrawOx` / `clayMul` 微调。
- **3.35.25**：格迈分数与待机对齐；解耦拖恢复叠分第二遍；贴边 **`clayMul` / `_wallRegroupK`**；`DRAG_THRESHOLD` 5。
- **3.35.24**：`_separateOverlappingGridGlyphs({ maxPasses })` 供生命周期后 / 换形尾 **轻量补跑**；`_finishMorph` 末尾 **解共格 + enforce**；减轻叠字与 α 闪现。
- `_separateOverlappingGridGlyphs`：呈现剪影下优先 **正交邻格** 疏散；**3.35.27** 起 `presDense` 默认遍数约 **7**（解耦拖 **8**；曾 12～16），`_embeddedMobilePerf` 下再 **×0.68**。

### 4.2 待机层 mask（巨字 / 颜）

历史上曾误把 **呈现专用** 逻辑套到待机：

- **`contourStatic`** 若包含「辨 + 任意 silMaskPet」，会把 **待机** 巨字也折进「轮廓静态」通道 → 与全速 `STANDBY_MOTION_KERNELS` 打架，观感 **慢、拖、不沿格**。
- **`_updatePresentationSilhouetteGlyphLifecycle`** 若对 **所有** `silMaskPet` 调用，会在待机层做 **淡出 / 重生 / 换字** → 严重打乱待机规整轨迹。

**修复方向（3.33.2）**：`contourStatic` 仅等于 `presGlyphSleep`；生命周期与 `fillCount` 粒子上限 **绑定呈现层**（见提交说明）。

---

## 5. Mask 与粒子数

- `rasterizeMask` → `_maskPack.grid` + **`fillCount`**（可走像素计数）。
- **呈现层** `mega`/`kao_*`：用 `fillCount` 与 `gridCell` 估 **上限 `capG`**，防止 **N > 可走位数** 导致结构性重叠（蛇轨/华容无解）。
- **待机层**：是否截断需产品确认；若截断会表现为 **「字变少」**。

---

## 6. 用户反复提出的需求（归纳）

以下不是原文存档，而是 **多次出现、应视为约束** 的意图：

1. **辨形优先**：巨字/颜轮廓可读；复杂形 **先静后动**；可选垫底与亚格颤。
2. **规整格移**：相邻格、匀速、曼哈顿；避免随机对角漂移画出 mask 外（`gridCellMotionEase` 对 mask 禁用）。
3. **少重叠**：叠分多遍、正交邻优先；结构性上限 `fillCount`（呈现截断约 **0.82×** 可走格估计，**3.33.4**）。
4. **少双轮廓**：字粒 + 整块灰 mask 不要叠（动/廓 分工）。
5. **呈现层稳定**：不要被 idle 自动换形拉回待机；`pickBiasedForm` 必须尊重 `uiArcMode`。
6. **层级分套记忆**：色、走格、颤、紊、灰底、淡影、字内动、波、粒、字比、容纳等分待机/呈现（体内节拍与沿格追赶为 **全模态常量**，见 `pet.js`）。
7. **性能**：离屏 canvas、`willReadFrequently`、重载时跳过装饰格线、减少无效 `separate` 调用等。
8. **巨字排版**：缩放下限与 `gridCell` 关联；容纳 `shrink/truncate/wrap2`；**呈现层**不叠整块灰轮廓底；**待机**「整块灰底」强垫底与「淡影」弱垫底二选一链（**3.34.2** 起灰底/淡影控件仅待机侧栏）。

---

## 7. 版本与演进（简表）

细节以 `DESIGN.md` / `PLAN.md` 为准；此处只列 **架构级里程碑**：

- **运动与形态解耦**：`uiArcMode` 决定 kernels。  
- **呈现剪影和谐场**：`_ensemblePhase`、生命周期、淡入淡出（**仅应作用于呈现剪影**）。  
- **「动」门控**：`presentationGlyphDynamics` + `presGlyphSleep`。  
- **fillCount  cap**：缓解 N>L 重叠。  
- **3.33.0**：巨字 matte 仅「廓」；巨字缩放/容纳；侧栏分区。  
- **3.33.1**：`app.js` 语法热修。  
- **3.33.2**：待机/呈现逻辑隔离（`contourStatic`、生命周期、`fillCount` 呈现限定、流体阻尼限定）。  
- **3.33.3**：侧栏 **title** 长文案、control-block；关「动」时 mask 垫底 α 略增；`HANDOFF` §12。  
- **3.33.4**：**先静辨形**（关「动」+「辨」+ 未「廓」→ 极弱整 mask）；**叠分 12**、`fillCount×0.82`、巨字壳 **enforce** 略增；**生命周期 α 限幅**；**待机/巨字 gridCell** 与 **immutable em 混合** 统一字号观感；mask **flash** 再压低。  
- **3.33.5**：**`DESIGN` §2.2/§2.3** 与回稿实现一致；**「动」关→开** `_glyphFlash` 画布确认。  
- **3.34.0**：**入门 `<dialog>`**（页眉 **?**，与 `DESIGN.md` 对齐）；**桌面主容器加宽**（`max-width` 940px）；**`:focus-visible` 键盘焦点环**、**`prefers-reduced-motion`** 下弱化按钮缩放与过渡；诗笺脚注 **URL 示例** 修正（`mega` 与 `macroText` 组合等）；与 **3.33.5** 闪动/文档条目合并发布。  
- **3.34.1**：**巨字可读**：淡影默认关、弱 mask α 再收；粒子 cap 更紧、叠分更勤；呈现巨字/颜字身 **统一 em**；**规整** 一键横竖谐步+全静；侧栏易读名与底部 **待机/呈现** 色条分区。  
- **3.34.2**：**呈现不叠整块 mask 底**（仅小字拼形）；**走格三键**（谐步/廊道/待机漫游）+ **字号** `bodyGlyphEmMul`；**颤** 不关离散谐步；叠分 **第二遍隔帧**；灰底/淡影 **仅待机侧栏**。  
- **3.34.3**：**呈现巨字「排布」**：拼满画布（短串分行、`gridCell` 按画布收、字比迭代缩）↔ **逐字轮换**；**颤幅** `silhouetteJitterAmpMul`；拖曳 **格向残留**；呈现剪影 **华容道** 启用（静帧冷却放慢）。  
- **3.34.4**：**规整**推迟华容道约 **0.9s**；关内动下 **swap 后 α 压低**（已由 **3.34.5** 略柔为 ×0.78）；~~呈现剪影拖曳 `pos` lerp 跟 `_dragTargetPos`~~ → **3.34.5** 改为 **壳锚解耦**。  
- **3.34.5**：**`_dragShellWorld` / `_bodyWorldForShell`**：呈现剪影拖曳 **壳心跟手**、**`pos` 松手对齐**；拖曳中仍 **叠分**；单 grapheme 巨字壳 **spread/enforce** 略增；**关内动**下关 **`strictSilGrid` 离散谐扰**；华容道 swap **α×0.78**；关内动 **`mergePresentation… timeScale` ×0.32**（较 0.22 略抬，「速」更可感）。  
- **3.34.6**：在 **3.34.5** 之上合并静形支线：**`presSleepLock`**（关「内动」锁格真静形）、**`presentationGlyphDynamics`** 呈现套 **snapshot**、待机 **apply**；**`_separateOverlappingGridGlyphs`** 在呈现剪影拖曳或拖曳解耦时仍执行；生命周期 **α maxStep** 关内动 **0.48**；**`docs/typography-forward.md`**。细节见 `DESIGN.md` 变更记录最新行。

---

## 8. 已知未完成 / 高风险方向

- **B-spline / 最少弯折格路径**、**速度场**、**笔画级叠字**：PLAN 中仍为「未做 / 部分」。
- **AI 矩阵**：`shape-field` / `matrix-bridge` / consumer 为伏笔，主流程不依赖。
- **任何 `app.js` 顶层语法错误** → 全站瘫痪；合并后应用 `node --check app.js`（或 CI）防回归。
- **`glyphs.length = cap` 截断**：不调用 `_initGlyphs` 时，仅缩短数组；需保证后续逻辑不假设原长度。

---

## 9. 给接手者的建议流程

1. 读 **`DESIGN.md` §矛盾处理** 与 **`PLAN.md` 当前构建行**。  
2. 在 `pet.js` 内搜 **`isPresentationSilhouetteHarm`**、**`presGlyphSleep`**、**`silMaskPet`**：任何新功能先判定 **是否仅呈现层**，避免再次污染待机。  
3. 改 `_update` 前用 **小画布 + 单形态** 目检：待机 `mega`、呈现 `mega`（动开/关各一）。  
4. 提交前：`node --check app.js`（若环境允许）+ 浏览器硬刷新验证 **build 号** 与侧栏 Toast。

---

## 10. 本助手在迭代中的推测（非真理）

- **「越更新越烂」** 常与 **呈现专用分支未加 `isPresentationSilhouetteHarm` 或 `uiArcMode` 守卫** 有关，待机与呈现共享 `silMaskPet` 极易误伤。  
- **卡顿** 常来自：重复 `separate`、整张 `drawImage` matte、粒子数过大、或 DevTools 开着。  
- **「辨形先静」** 与 **「待机也要活泼」** 在产品上冲突时，应以 **层** 分界写代码，而不是再以「有无 mask」单条件叠乘子。

---

## 11. 若需「推倒重来」

保留 **`PLAN.md` / `DESIGN.md` / 本文件`** 作为规格；代码上可优先冻结：

- `_arcPrefs` 模型、`uiArcMode`、呈现剪影判定、mask 栅格与 `rasterizeMask` 契约、渐进换形与 `mgx/mgy` 世界格一致性。

新实现建议 **把「呈现剪影更新」拆成独立模块文件**，由单测或 headless 截图回归 **待机 mega 与呈现 mega** 两套黄金样例。

---

## 12. 控件映射与维护约定（3.34.6）

### 12.1 左栏四块（`index.html` → `data-action` → `app.js` → `pet.js`）

| 区块标题 | 按钮字 | `data-action` | 行为摘要 |
|----------|--------|---------------|----------|
| ① 层级 · 日常互动 · 墨色光色 | 层 | `arcMode` | `cycleUiArcMode`（待机 ⟷ 呈现，切换 `_arcPrefs` 套） |
| | 变 | `morph` | 当前层内换形 |
| | 觅 | `feed` | 觅食 |
| | 墨 / 颜 / 浮 | `ink` / `tint` / `glow` | 墨色循环 / 色盘 / 浮光循环 |
| | 眠 / 抖 | `sleep` / `shake` | sleep 模式 / 抖擞 |
| ② 格点 · 走格范式 · 躯体字号 | 谐步 / 廊道 / 漫游 | `setMotionStyle` + `data-motion` | `setBodyMotionStyle`；呈现仅 `harmonic`/`snake_stream`，`contour_drift` 回落谐步；**漫游** 按钮 `ui-arc-standby-only` |
| | 字号 / 颤 / 颤幅 / 紊 | `bodyGlyphEm` / `glyphsJitter` / `silhouetteJitterAmp` / `textureMotion` | `cycleBodyGlyphEmMul` → `_applyGridTypography`；颤；**颤幅** `cycleSilhouetteJitterAmpMul`（绘移 cap）；纹理体动 |
| | 波 / 粒 | `fluid` / `megaPack` | 流体强度 / 巨字粒数（**体内节拍与格移** 为 `pet.js` 常量，无侧栏挡位） |
| ③ 巨字/颜 · 垫底（待机）· 动静 | 整块灰底 / 淡影（待机） / 内动 | `silhouetteMatteUnderlay` / `outlineContourFirst` / `presentationDynamics` | **灰底/淡影**：`ui-arc-standby-only`+`display:contents`，仅待机层。**内动**：呈现体内动；关=锁格真静（叠分仍解共格）；**关→开** `_glyphFlash` |
| | 规整 | `silhouetteCalm` | `applyPresentationSilhouetteHarmonicCalm` |
| ④ 呈现层 · 巨字排版 | 字比 / 容纳 / 排布 | `megaScale` / `macroFit` / `megaPresentLayout` | `megaLayoutScale` / `macroFitMode` / **`cyclePresentationMegaLayoutMode`**（拼满画布 ↔ 逐字轮换） |

**维护规则**：新增侧栏键时，必须同时写 **长 `title`**（一句以上，说明层级与副作用）并在本表增行；Toast 文案可在 `app.js` 与 `title` 对齐。

### 12.2 底部与右栏

- **文稿与日程输入**：`textarea#openingPreset`、双击化灵等。  
- **呈现层 · 化身大字**：`#glyphShapeInput` + `#glyphShapeBtn`（`applyGlyphShapeFromInput`）。  
- **躯体字 · 日程 digest**：`#bodyImport` + `#bodyImportBtn`。  
- **诗笺 · 觅食字块**：`feed-panel` 内可点字喂食。  
- **右栏「文稿与画布」**：`btnPresentScript` / `btnAwakenPet` / `btnBackIntro` / `btnRevertScript`。

### 12.3 近期代码向计划（写入 `PLAN.md` 对照）

- [ ] 可选：**自定义悬停层**（比原生 `title` 延迟更短）——需防遮挡画布。  
- [x] 呈现层：「动」从关→开时 **短时弱 `_glyphFlash`**（**3.33.5**；**3.34.0** 与 Toast/入门 dialog 对齐说明；mask 剪影仍压低闪光）。  
- [x] **入门说明**：页眉 **?** 打开原生 `<dialog>`，与 `DESIGN.md` 对齐（**3.34.0**）。  
- [ ] 性能：评估 **双次** `_separateOverlappingGridGlyphs` 可否在待机 mask 路径合并。

---

*文档版本随构建迭代；最后更新意图：与 `ziling-build` **3.34.6** 对齐。*
