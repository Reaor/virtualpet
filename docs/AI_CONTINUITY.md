# 字灵 · 后续 AI 接手延续说明

> **读者**：后续接手的 AI 或工程师。  
> **与 `HANDOFF.md` 的关系**：`HANDOFF.md` 偏 **机制与坑位**（状态机、字段、易混点）；本文偏 **产品原则、当前局面、优先级语言**，并与人类已确认的表述对齐。

---

## 1. 人类已确认的三条原则（决策时用）

以下三条 **同等重要**，具体实现上常需要取舍，接手时应 **显式权衡**，不要只优化其中一条而 silent 伤害另一条。

| 原则 | 含义（人类语言） | 工程上通常对应 |
|------|------------------|----------------|
| **美观** | 水墨/浅色 UI、巨字与颜文字的 **辨形**、轮廓可读、节律有「字」感而非噪声 | 渲染质量、mask 剪影、谐波/流体幅度、垫底与淡影策略、字号与 `macroFit` |
| **流畅** | 自己 **检阅**（桌面浏览器）时交互跟手、少顿卡；未来 **嵌入 App（WebView）** 时仍要尽量顺 | 主线程每帧工作量、叠分遍数、移动降载 `_embeddedMobilePerf`、`?dev=1` 帧耗时、`GRID_MARCH_*` |
| **创新性** | 汉字即躯体、层与呈现语义、格移与橡皮泥贴边等 **差异化体验** | 不简单退化成普通粒子壁纸；新功能需与「辨形 + 栅格」叙事一致 |

**嵌入场景特别提醒**：换用 React/Vue **不会自动**让 Canvas/粒子模拟更流畅；流畅依赖 **帧预算与算法**。嵌入时宿主应开硬件加速，并善用已有 **`embeddedMobilePerf`** / URL **`?mobilePerf=`**（见 `AGENTS.md`）。

---

## 2. 当前工程形态（事实摘要）

- **技术栈**：零依赖、无构建、无 npm、**纯静态** `index.html` + `styles.css` + `app.js` + `pet.js` + `js/ziling/*.js`。无自动化测试与 linter。
- **权威版本号**：`index.html` 中 **`meta ziling-build`** 与资源 **`?v=`**（与页眉 `buildStamp` 一致）。撰写本文时主文档构建为 **3.35.25**；若不一致，以仓库内 `index.html` 为准。
- **检阅改进索引**：`docs/IMPROVEMENTS.md`（按构建倒序，便于 diff 行为）。
- **产品设计真源**：`DESIGN.md`（与早期描述冲突时以 DESIGN 为准）。
- **需求对照**：`PLAN.md`。

---

## 3. 产品核心一句话（不要丢）

**字灵**：以汉字粒子为躯体的 living character；巨字/颜 **mask 剪影** 上小字须 **沿可走格**、少重叠、少混沌；**待机层**与**呈现层**（侧栏「层」）语义与运动内核分离。

关键条件 **`isPresentationSilhouetteHarm`**：`uiArcMode === "presentation"` 且 `isMaskBackedMegaKao`（详见 `HANDOFF.md` §3）。

---

## 4. 当前技术局面（接手后优先知道的）

### 4.1 性能与体验张力

- **重逻辑集中在 `pet.js` 的 `_update`**：格迈累积器、多遍 `_separateOverlappingGridGlyphs`、mask 可走格、呈现生命周期、拖曳贴边物理等，**全部在主线程**。
- **近期版本在「叠字 / 闪现 / 贴边体感」与「每帧成本」之间做过多轮平衡**（见 `IMPROVEMENTS` 3.35.22–3.35.25）。若用户反馈 **卡**，优先 **量**（`?dev=1` 已有分段时间）再 **减频或加条件**，而不是先讨论换框架。
- **`_embeddedMobilePerf`**：窄视口 / 移动 UA / 粗指针等自动略降载；嵌入 App 时可强制 `embeddedMobilePerf: true` 或 URL 参数（见 `AGENTS.md`）。

### 4.2 侧栏与分层

- **`_arcPrefs`**：`standby` / `presentation` 两套快照；连点尾部对齐用 **`Pet.scheduleStabilizeAfterControl`**（`app.js` 左栏 `finally`），避免 `layoutHard` 与快照漂移。
- **`presentationGlyphDynamics`**（字内动）仅存呈现套；与 `presGlyphSleep`、叠分第二遍频率等强相关（见 `HANDOFF.md` §3–4）。

### 4.3 格迈与叠分（易改易炸）

- **`_gridMarchFrameAcc` + `GRID_MARCH_CELLS_PER_SEC`**：全字共享 `stepBudget`；呈现剪影与待机 **同一套扣减逻辑**（3.35.25 起，避免积压后齐跳）。
- **解耦拖**（` _dragShellDecoupled`）：剪影跟手、松手落锚；叠分第二遍 **不可**在解耦拖时误关（3.35.25 已修条件）。
- **改常数前**：读 `HANDOFF.md` §4.1 与 `IMPROVEMENTS` 对应行，避免回归「闪现 / 叠字 / 待机被呈现逻辑误伤」类历史问题。

---

## 5. 建议的接手顺序（新会话第一步）

1. 读 **`AGENTS.md`**（如何跑、缓存、`?dev=1`、嵌入参数）。  
2. 读 **`HANDOFF.md` §1–6**（状态机、呈现条件、运动表）。  
3. 扫 **`docs/IMPROVEMENTS.md`** 顶部数行（当前构建最近在改什么）。  
4. 若改行为或视觉，核对 **`DESIGN.md`** 变更表是否需追加一行。  
5. 改侧栏：同步 **`index.html` 的 `title` / 分区文案** 与 `HANDOFF.md` §12（若有控件映射表）。

---

## 6. 与人类目标对齐的后续工作方向（非承诺 backlog）

以下由原则导出，**实施顺序应由人类拍板**：

- **检阅路径**：桌面默认完整美观；可选 **「流畅优先」** 一键/URL，便于人类检阅逻辑时不被特效拖慢（实现方式待定，原则已确认）。  
- **嵌入路径**：默认偏流畅（降载策略 + 宿主 WebView 配置）；需要演示完整视觉时再开满。  
- **性能可观测性**：保持并善用 **`?dev=1`**；必要时再加轻量 overlay（仅开发向，默认关闭）。  
- **框架**：无短期强制迁移；若未来仅外壳需要组件化，可采用 **壳框架 + 核心 `pet.js` 模块** 的 hybrid，不替代「帧预算第一」。

---

## 7. 文档索引（复制给新会话）

```text
AGENTS.md              运行、缓存、嵌入、?dev=1
HANDOFF.md             状态机、坑、格迈/叠分细节、侧栏映射
DESIGN.md              产品原则与变更摘要
PLAN.md                需求与版本
docs/IMPROVEMENTS.md    按构建检阅
docs/AI_CONTINUITY.md   本文：原则 + 局面 + 接手顺序
```

修改行为或用户可见说明后：** bump `ziling-build` 与 `?v=`**（`index.html`），并在 `IMPROVEMENTS.md` / `DESIGN.md` 按惯例补一行，便于人类检阅与回滚对比。
