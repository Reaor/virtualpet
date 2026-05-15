# 字灵（Zì Líng）项目解任 / 接手说明书

> **用途**：供后续 AI 或工程师在 **少试错** 的前提下理解仓库、产品意图、技术债与已知坑。  
> **局限**：完整人类对话记录不在本仓库；下文 **需求要点** 来自 `PLAN.md` / `DESIGN.md`、代码注释、以及迭代中反复出现的用户反馈的 **归纳**（非逐字「提示词」存档）。若与主分支行为不一致，以 **`index.html` 的 `ziling-build`** 与 `pet.js` 为准。

---

## 1. 产品一句话

**字灵**：以汉字粒子为「躯体」的 living character，可与日程/文稿交互；核心审美是 **辨形优先**——巨字/颜文字等 **mask 剪影** 上，小字需 **沿可走格规整运动**、少重叠、少混沌颤动；**呈现层**与**待机层**应有清晰不同的运动与 UI 语义。

---

## 2. 仓库与入口

| 路径 | 角色 |
|------|------|
| `index.html` | 页面结构、侧栏按钮 `data-action`、`meta[name=ziling-build]`（构建号） |
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

- 键：`standby` / `presentation`，各自存 **速、色、墨、浮、波、徙、粒、轨、颤、紊、廓、辨、动、macroFitMode、megaLayoutScale** 等。
- 切换「层」时 `applyArcVisualPrefsToPet` / `snapshotArcVisualPrefs` 读写当前套。

### 3.4 「动」`presentationGlyphDynamics`

- 仅存 **`_arcPrefs.presentation`**（待机层无此概念）。
- **`presGlyphSleep`**：`isPresentationSilhouetteHarm && !presentationGlyphDynamics`  
  → 关「动」时体内谐波/流体等大幅压低，**先静后动**。
- **与「廓」**：开「动」且为呈现剪影时，**不画整张 mask 垫底**（避免双轮廓 + 性能）；关「动」可按「廓」叠弱垫底。

---

## 4. 运动与栅格（易混点）

| 概念 | 说明 |
|------|------|
| `gridMarch` / `gridSnapping` | 格点迁移开关与吸附 |
| `silhouetteStrictHarmonicGrid` | 谐波 + 无蛇/无游走 + **关颤** → 严格格点曼哈顿 |
| `bodyMotionStyle` | `harmonic` / `snake_stream` / `contour_drift`（mask 躯体轨） |
| `textureMotionMode` | `spring_flow` / `adjacent_swap`（与轨正交的纹理体动） |
| `_silDrawOx/_silDrawOy` | 亚格绘制偏移；由「颤」`silhouetteGlyphJitter` 控制 |
| `motionTimeBlend` | 「速」与层内核 `timeScale` 的凸组合，避免呈现层「速」完全失灵 |
| `mergePresentationSilhouetteMotion` | **仅** `isPresentationSilhouetteHarm` 时在 DISPLAY 内核上再压低 |

### 4.1 呈现层剪影格移

- `stepBudget`：在 `presSilHarm` 下固定为 **1**（每帧每字最多一格曼哈顿），减轻叠乱。
- `_separateOverlappingGridGlyphs`：呈现剪影下优先 **正交邻格** 疏散，遍数较高。

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
3. **少重叠**：叠分多遍、正交邻优先；结构性上限 `fillCount`。
4. **少双轮廓**：字粒 + 整块灰 mask 不要叠（动/廓 分工）。
5. **呈现层稳定**：不要被 idle 自动换形拉回待机；`pickBiasedForm` 必须尊重 `uiArcMode`。
6. **层级分套记忆**：色速轨颤紊廓辨动波徙粒字比容纳等分待机/呈现。
7. **性能**：离屏 canvas、`willReadFrequently`、重载时跳过装饰格线、减少无效 `separate` 调用等。
8. **巨字排版**：缩放下限与 `gridCell` 关联；容纳 `shrink/truncate/wrap2`；整块灰轮廓 **默认不画**，仅「廓」显式开启。

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

*文档版本随构建迭代；最后更新意图：与 `ziling-build` 3.33.2 对齐。*
