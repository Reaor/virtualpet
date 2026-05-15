# 字灵（Zì Líng）产品设计书

> **维护规则**：本文件为自上而下产品与设计真源。后续对话中的新指示应**追加**到对应章节或「变更记录」；若与上文矛盾，**以时间上更晚的指示为准**（后覆盖前）。实现细节以代码为准，但行为应以本设计书为验收参照。

---

## 1. 产品定位与愿景

- **一句话**：由汉字粒子组成的「活字」电子宠物，与日程、文稿、情绪反馈结合，面向日后接入日程管理应用。
- **气质**：现代、耐看；UI 参考 **Apple Human Interface**（清晰层级、毛玻璃分组、易点按的控件、浅色系统感），**不**走宣纸古风主视觉。
- **技术意象**：字在不可见格子上流动，如编队舞蹈；运动宜**顺滑、液态**，避免刺眼闪烁与杂乱随机。

---

## 2. 体验结构（自上而下）

### 2.1 单一主舞台（画布占满中间，控件在两侧与下方）

- **原则**：**呈现**后的字与**字灵**均在**同一画布**上绘制。为扩大活动与阅读面积：**互动与快捷换形在左右窄栏**，**日程长文本在舞台下方的输入区**；画布在 `playfield` 中间**纵向拉满**。
- **后覆盖前**：若与早期「底栏一体卡」描述冲突，以**侧栏 + 下方输入区**为准。

### 2.2 模式状态机

| 模式 | 画布表现 | 用户操作 |
|------|----------|----------|
| **intro** | 空场 + 涟漪等轻反馈 | 在停靠条输入 → 「呈现文稿」或等价 |
| **script** | 多行字粒子整齐排列（`script` 形） | 「化为字灵」/ 双击文稿区 |
| **pet** | 字灵形态与动态 | **回稿**：在字灵核心区 **长按约 0.58s** 武装，**松手**（未进入拖拽、位移 ≤8px）还原文稿；或点 **「回」**；字灵模式下编辑带标记行可触发已完成吞食 |

### 2.3 关键交互（按最新约定）

- **呈现**：输入 → **呈现文稿** → 字显示在**画布上**（非仅输入框）。
- **化灵**：**化为字灵**（或双击文稿区）→ `pet`。
- **回稿**：**长按**字灵核心区蓄满 → 提示后 **松手** 还原文稿（移动超过约 **8px** 视为拖拽并取消回稿）；或 **「回」** 按钮。
- **日程语义**（字灵模式下编辑）：**【已完成】** / `[已完成]` / 行首 ✓ → 可**吞入躯体**；**【未完成】** / `[待办]` 等 → **不贴躯体**（穿透），可保留文案反馈。
- **觅食 / 换形 / 快捷形态**：左栏（**层**·变·觅·墨·颜·浮·速·眠·抖）。**层** 切换 **待机 / 呈现** 两套层级：待机栏仅数学曲线与软团；呈现栏为计时、颜文字与巨字输入行；**色 / 速 / 墨 / 浮** 在两层间 **分套记忆**。「变」仅在 **当前层级** 的形态序列内循环。
- **字序与密度**：「呈现」时画布为**每字一格、按输入行序**，**禁止**在同一坐标堆叠多粒（旧版 `i % L` 叠字已废除）；`script` 模式粒子数与**字符格子数**一致。化灵后粒子数可多于字数，字序按文稿**循环**填充躯体；非眉眼粒子严格按行序赋字。
- **文稿清晰**：`script` 形态关闭赛璐璐描边叠层、减弱呼吸与液体波；浅色背景下**隐藏背景格线**减轻糊感；字号取整像素、提高边缘 alpha；设备像素比上限放宽以锐化。
- **页面滚动**：鼠标在画布区域滚轮时**显式滚动整页**（`wheel` + `scrollBy`），与触摸拖拽互不冲突。

### 2.4 动态与视觉

- **形态**：已**移除动物剪影**（猫狐兔鹤鲤龙蝶等）；保留软象、纹·时与花、几何、巨字、颜文字等。字灵默认**不启用眉眼字层与朱砂叠绘**（躯体仅用户字；`faceLayerMode` / `spotAccent` 可显式打开）。**不再对躯体做水平翻面**，避免文稿/巨字与阅读方向左右镜像。
- **清晰度管线（可演进）**：`canvas` **buffer 与 CSS 整数像素对齐 DPR**；绘制前 `_snapLogicalToDevice` 对齐物理栅格；**浅色主题**躯体字默认 **单层实色**（关闭 cel 渐变与四向描边叠字），**深色**保留 cel 与缩距描边；`gridUnity` 下整像素字号与字重 600；眉眼等小元素可保留轻阴影。
- **活动范围**：字灵整体可在画布内大范围移动，边距仅保留必要安全值，避免「框在中间一小块」。

### 2.5 呈现剪影（巨字 / 颜文字）· 和谐场、空缺补位与淡出重生

> **问题意识**：仅靠「各字独立频率的游离、华容道、强流体」维持动感时，**剪影轮廓**与**可读性**常被内部乱流破坏；多频叠加还会导致 **速率不均、闪烁感**，与侧栏「速」的心理模型脱节。

#### 2.5.1 产品原则（后覆盖前）

1. **轮廓优先**：在 **呈现层** 下，`mega` 与 `kao_*`（有 mask 的剪影类）以 **可辨识形体** 为第一目标；动感是 **次要、可控** 的。  
1b. **先静后动（弱垫底链，仅待机层）**：关「字内动」且开「淡影垫底」（`outlineContourFirst`）、未开「整块灰底」（`silhouetteMatteUnderlay`）时，在**待机层**巨字/颜下可叠 **极低 α 的整张 mask** 作弱锚；**呈现层不叠整张 mask 大字底**，轮廓以**小字粒**拼出；开「整块灰底」则改用 **显式垫底强度**；开「字内动」时 **不叠整张 mask**（避免双轮廓与合成开销）。  
2. **统一节拍**：体内位移以 **全队共享相位** `_ensemblePhase` 为主驱动；**「速」** 统一缩放时间尺度，避免「有的字快、有的字慢」的失控对比。  
2b. **格目标吸附（辨形硬约束）**：谐波/流体推算的 **march 目标格** 若落在 mask 外，则 **吸附到最近可走格**（`_nearestWalkableMarchCell`），优先避免小字长期占在剪影外；**淡出 / 内向补步 / 壳上重生** 仍作兜底与语义空缺处理。**有 mask 的 `mega` / `kao_*`** 在待机层亦 **停用格子游走**，与呈现层共用 **同一套和谐体内波相位**（`isMaskBackedMegaKao`）；呈现层另叠 `mergePresentationSilhouetteMotion` 再压低幅速。**严格格点（谐波默认）**：`harmonic` 且 **关** 侧栏「颤」时，`silhouetteStrictHarmonicGrid` 为真——**不在连续坐标上叠谐波/流体**，而以 **离散格偏移**（`_ensemblePhase` 驱动 ±1 曼哈顿步候选）+ 曼哈顿 march 表现 **横竖匀速换格**；**亚格绘制位移** `_silDrawOx/_silDrawOy` 与谐波 **连续微振** 仅在 **「颤」开**（`silhouetteGlyphJitter`，`_arcPrefs.glyphsJitter` 分套）时启用，避免默认「颤抖」观感。  
3. **淡出即语义空缺**：粒子落在 **mask 不可走** 格上视为 **离轮廓 / 破坏形态**，**alpha 淡出至消失**（不强行把字拽回剪影内乱撞）。  
4. **空缺如何补上**（一脉相承两条路径，可同时存在）：  
   - **内向补步**：淡出瞬间登记锚点格 `(anchorGx, anchorGy)`，在短窗口内由 **内部非外缘粒子** 沿曼哈顿格 **向锚点迈一步**，形成「**邻字挪入、密度内聚**」的观感；  
   - **壳上重生 + 新字**：同一粒子在笔画邻域 **合法格重生**，并 **换新字**（字池/文稿），形成「**生灭**」循环，维持粒子数与信息熵。  
5. **泛化**：上述 **淡出 + 空位 + 补步/重生** 范式可推广到其他 **难维持的剪影形态**（凡有 `_maskPack` 的呈现层轮廓类）；**待机层曲线 / 软团** 不强制此范式，保留原有灵动与游走。

#### 2.5.2 可参考的技术意象（非实现绑定）

- **连续介质 / 密度场**：将剪影内视为 **可走格上的密度**；外逸粒子 **湮灭**，空缺由 **扩散式内流**（一步格移）近似。  
- **编队 / 音乐节拍**：多体运动共享 **主频 + 整数比谐波**（如 1:2），避免互不相关的无理频比叠加。  
- **形态发生（morphogenesis）**：边界附近 **生成/补位**，内部 **协调流动**，与「轮廓清晰」目标一致。

### 2.6 躯体运动轨（`bodyMotionStyle`，侧栏「轨」）

> **适用范围**：仅 **`mega` / `kao_*` 且存在 `_maskPack.grid`** 的剪影形态；无 mask 的曲线/软团仍走既有 `internalMotion` / 华容道等逻辑（「轨」切换仍写入当前层偏好，切回巨字即生效）。

| 范式 ID | 中文标签 | 设计意图 |
|---------|----------|----------|
| `harmonic` | 谐波格点 | **默认**：`silhouetteStrictHarmonicGrid` — 全队 `_ensemblePhase` 驱动 **离散格目标** + 曼哈顿 march，**关流体/连续谐波位移**；**开侧栏「颤」** 时恢复 **亚格绘制位移** + 连续谐波微振 + 弱流体相位。 |
| `snake_stream` | 流线蛇行 | mask 内可走格排成走廊 `_snakeWalkPath`（默认 **螺旋**：质心 + **切比雪夫环** + 极角，由心向外「挤满」感；可选 **弓字** `snakePathVariant=zigzag`）。每帧对目标路径索引做 **去重**，避免多字抢同一格。字列沿走廊 **递进**；**淡色折线**按 `_snakeSlot` 序连接。 |
| `contour_drift` | 轮廓游走 | 在剪影内 **恢复格子游走**（`allowGridWander`），`marchPref` 按深度交替；与谐波可同时存在，偏 **探索性**，略增叠字风险，由叠分与「徙」兜底。 |

**与速/徙的关系**：`glyphMotionSpeed` 仍调 ensemble 与蛇行相位；`gridMarchSpeed` 调曼哈顿步预算与蛇行 `_snakePhase` 增速。  
**URL**：`?motionStyle=snake_stream` / `?bodyMotion=…`（须为 `BODY_MOTION_STYLES` 之一）；`?snakePath=spiral`（默认）或 `zigzag`；`?glyphsJitter=1`（或 `silhouetteJitter`）预开亚格颤抖。运行时 `setSnakePathVariant` 可切换并强制重建走廊。

### 2.7 迭代审视：负优化风险与创新研究

| 现象 | 可能成因（迭代中） | 当前对策 / 研究方向 |
|------|-------------------|---------------------|
| 「有的字不动」 | 仅按格心 `mgx*cell` 绘制，谐波被 `round` 吃掉 | **开「颤」** 用亚格位移；默认 **离散格目标** 仍迈格可见动 |
| 闪现、硬切 | lifecycle 瞬间满 alpha、`_glyphFlash` 放大字号 | 重生 **低 alpha 渐回**、剪影 **关 flashBoost**、淡出 **更慢**；**3.33.4**：生命周期 **每帧 α 限幅** |
| 叠字 | 同格竞争、分离半径不足 | mask **3～4 遍**分离（较 5～6 遍 **减负防卡顿**）；lifecycle 后再分、蛇行后再分；**3.33.4**：呈现剪影 **12 遍** + `fillCount×0.82` + 布局 **enforce** 略增 |
| 输入形状拟合仍差 | 壳层采样与 `enforceSpacing` 张力（粒子数 × 最小间距 × 宏字笔画复杂度） | **略增** `enforceSpacingPasses`（呈现）；后续：**笔画感知间距**、动态粒子预算 |
| 运动单调或疲劳 | 单一谐波或单一蛇速 | **螺旋走廊** + **索引去重**；后续：Perlin 导向场、真 Hamilton 覆盖 |

### 2.7b 外部 walk Consumer（辨形 · 矩阵伏笔，3.28）

- **结构**：`ZiLingShapeFieldConsumer.create()` 持有 **二值密铺** `Uint8Array`，对 Producer 每帧输入用 `MatrixBridge.exponentialHold` 做时间低通，减轻 API 抖动。  
- **对齐**：若外部网格与本地 `packWalkGrid` 宽高不一致，先用 **`MatrixBridge.resampleBinaryPacked`** 最近邻重采样（与经典图像最近邻缩放同构，便于与任意分辨率矩阵对接）。  
- **Pet**：`ingestExternalWalkPacked` / `resetExternalWalkConsumer`；`dumpShapeField().externalWalk`；换形后若本地密铺尺寸变化则 **清空**外部 Consumer，避免轮廓错位。真网络 Producer **尚未**接入。

### 2.8 后续扩展（占位）

- 日程 App 深度接入、真实 AI 接口、视频轮廓驱动等：见 `PLAN.md` 优先级表；**不**在本设计书展开实现细节。

---

## 3. 变更记录（摘要）

| 日期（会话） | 决策 |
|--------------|------|
| 最新 | **3.34.3**：**呈现巨字排布**：`_arcPrefs.presentation.presentationMegaLayoutMode` **`fit_canvas` | `sequential_chars`**；侧栏 **「排布」**（`cyclePresentationMegaLayoutMode`）。**拼满**：`macroTextBalancedWrapShort` 短串分行 + `resolveMegaLayoutInput` 在呈现下按估算粒子数 **迭代略缩 `megaLayoutScale` 等效**；`computePresentationMegaGridCell` 按画布与字数收紧 **`gridCell`**。**逐字**：`_megaSeqIdx` + `_tickPresentationMegaAux` 约 **2.35s** 换一字并 `setForm`。**颤幅**：`silhouetteJitterAmpMul` + **「颤幅」** 键，亚格绘移 **`cap` 乘子**。**拖曳**：`_dragResidualLx/y` + 每字异相偏移，减轻整块剪影平移感。**华容道**：呈现 mask 剪影路径 **不再跳过** `_tryHuarongAdjacentSwaps`；**关内动** 时冷却 **×2.55**，**开内动** **×0.88**。 |
| 先前 | **3.34.2**：**呈现轮廓**：巨字/颜 **不再绘制整张 mask 垫底**，仅小字拼形；**走格 UI**：谐步 / 廊道 /（待机）漫游三键 + 高亮态；呈现层 **禁用壳漫游**（`contour_drift` 自动回落 `harmonic`）。**谐步**：`silhouetteStrictHarmonicGrid` **不再被「颤」关闭**，颤仅亚像素绘移。**躯体字号**：`bodyGlyphEmMul` 侧栏 **「字号」** 挡位，`_applyGridTypography` 末尾统一乘子。**性能**：呈现剪影 **叠分第二遍隔帧**；粒子 cap **×0.68**；蛇行在呈现静帧下 **可视相位略抬**；壳漫游拾取 **半径在呈现略收**（漫游本身已对呈现 mask 关闭）。**待机**：整块灰底 / 淡影按钮 **仅待机层可见**（`display:contents` + `ui-arc-standby-only`）。 |
| 先前 | **3.34.1**：**巨字可读**：呈现层 **「淡影垫底」默认关**（`_arcPrefs.presentation.outlineContourFirst`），弱整 mask α **再压低**；`fillCount` 截断 **0.82→0.72**；叠分 **12→16** 遍；呈现巨字/颜 **字身统一 `em`** 与绘制 **roleMul 拉平**。**运动**：呈现默认 **流体略收**；侧栏 **「规整」** 一键写入呈现层 **横竖格谐步 + 关内动 + 纹理流 + 疏散叠格**（`applyPresentationSilhouetteHarmonicCalm`）。**UI**：按钮易读名 **走格 / 整块灰底 / 淡影 / 内动 / 规整**；底部折叠 **待机·曲线**（绿条）/ **呈现·计时·颜**（蓝条）与 summary 文案，减少与上方通用工具混读。 |
| 先前 | **3.34.0**：**入门说明**：页眉 **?** 打开原生 `<dialog>`，与 §2～§2.5 叙述对齐。**矛盾清理**：`§2.2`/`§2.3` 回稿手势与 `app.js` 实现一致。**UI**：主容器 `max-width` 放宽至 **940px**；侧栏 **`:focus-visible`** 焦点环；**`prefers-reduced-motion`** 下弱化按钮缩放与 `hint`/`toast`/`glyph` 过渡；诗笺脚注 **URL** 示例修正（`form=mega&macroText=` 等）。**「动」关→开**：短时 `_glyphFlash` 确认（mask 路径仍压低）。**`AGENTS.md`/`README` 首段**：去除「宣纸主视觉 / AI 面板」与当前产品不一致的表述。 |
| 先前 | **3.33.5**：**设计书对齐**：`§2.2`/`§2.3` 回稿手势改为与实现一致（长按武装、松手回稿、8px 阈值）。**呈现层「动」**：侧栏 **关→开** 时触发 **短时弱 `_glyphFlash`**，便于在画布上确认体内动已启用（巨字/颜 mask 路径仍压低闪光，以免破坏辨形）。 |
| 先前 | **3.33.4**：**先静辨形**：呈现关「动」、开「辨」、未开「廓」时 **`_drawSilhouetteMatteUnderlay` 极弱整 mask 垫底**（与「廓」强垫底二选一强度链）。**叠乱/叠字**：呈现剪影 **叠分 12 遍**；`fillCount` 截断 **0.86→0.82**；巨字 `buildTextSilhouetteLayout` **spread/enforce/passes** 略增。**闪现**：生命周期 **α 每帧变化限幅**、淡入淡出倍率略收、重生起 α 区间略抬。**字号统一**：待机默认 `gridCell`（`S*0.0345`）；巨字 `S*0.0425`；**immutable mask 体** `em` 用 `gridCell` 与 `size` 参考混合 + 呈现/待机不同 k；非 immutable 待机曲线 **em 0.81**；绘制 crisp cap **×0.93**（仅呈现剪影）；mask **flash** 再压低。**UI**：`辨`/`动` toast 与底栏 hint 对齐行为。 |
| 先前 | **3.33.3**：**UI**：左栏 **四区块**（层级与墨色 / 格轨纹理 / 廓辨动 / 巨字排版）；各按钮 **`title` 长文案**；右栏「文稿与画布」头；底部 **文稿 / 化身大字 / 日程 / 诗笺** 分区标题；`?` 说明。**呈现**：关「动」时 **mask 垫底 α 略增**、**剪影生命周期淡入淡出加强**（仍仅 `isPresentationSilhouetteHarm`）。**文档**：`HANDOFF.md` §12 控件映射与维护约定。 |
| 先前 | **3.33.2**：**待机 / 呈现隔离**：`contourStatic` 不再把「辨」误用到待机 mask；流体阻尼 **`presSilHarm` 限定**；**`fillCount` 截断** 仅呈现层；**生命周期** 仅呈现剪影。`HANDOFF.md` 接手说明。 |
| 先前 | **3.33.1**：**热修**：`app.js` 误删的 **`syncRailUiArcClass`** 导致整页脚本失败。 |
| 先前 | **3.33.0**：**整块巨字灰轮廓**：**仅「廓」**（`silhouetteMatteUnderlay`）开时 `_drawSilhouetteMatteUnderlay`；**辨** 不再单独触发整块 mask；呈现层 **「廓」默认关**。**巨字排版**：`megaLayoutScale`（侧栏 **字比**，与 `gridCell` 推得的下限取 max）、`macroFitMode`（**容纳**：`shrink` / `truncate` / `wrap2`，多行 `createMacroTextDraw`）；URL **`?megaScale=`**、**`?macroFit=`**。**UI**：左栏 **分区标题 + 双列按钮**、主容器加宽。 |
| 先前 | **3.32.4**：**根因收敛**：（1）**粒子数 > 可走格/蛇轨槽位** → 必然共格重叠；现 **`rasterizeMask.fillCount`** 按格距估算 **上限并截断 `glyphs`**。（2）**整张巨字/颜 mask 垫底 + 字粒** → 双轮廓；**呈现层开「体内动」** 时 **跳过 `_drawSilhouetteMatteUnderlay`**。（3）**卡顿**：合并多余 `separate` 调用、**提高单函数内遍数**、重载呈现时 **跳过背景装饰格线**、mask 离屏 **`willReadFrequently:false`**。 |
| 先前 | **3.32.3**：**呈现层剪影格移**：每字 **每帧最多 1 格** 曼哈顿步进（匀速、少叠乱）。**叠字疏散**：`isPresentationSilhouetteHarm` 下 **优先正交邻空位**（随机序）再 Chebyshev 扩环，**6 遍**分离。**双轮廓**：开「体内动」时 **mask 静态垫底 α 乘子压低**（辨开时仍留弱影）。**淡入淡出**：离轮廓/非法格 **更快淡出**、区内 **更慢淡入**、重生 **更低起 α**（减闪现混乱）。**轨** 谐波/蛇行/轮廓 振幅对比略拉开。 |
| 先前 | **3.32.2**：**呈现层不再被 idle 自动换形拖成待机形**：`pickBiasedForm` → `getFormOrderForUiArcMode`；`app.js` 定时换形在 `presentation` 下跳过。**先静后动**：`_arcPrefs.presentation.presentationGlyphDynamics`（侧栏 **动**，默认关）+ `presGlyphSleep` 门控体内波/流体；垫底略加浓、字粒 α 压低；蛇行相位在呈现开「动」时加强以与谐波/轮廓游走区分。 |
| 先前 | **3.32.1**：**`_enforceMaskBackedGlyphWalkable`**：叠分 / 华容 / 滑步后若 `(mgx,mgy)` 仍落在 mask 外，则 **snap 到 `_nearestWalkableMarchCell`** 并清零亚格绘制偏移，与 `_worldCellWalkable` 同源兜底；眼窝斥力 **420→340** 减轻与辨形弹簧对冲。 |
| 先前 | **3.32.0**：**巨字/颜 mask 剪影禁用 `gridCellMotionEase`**，避免格间对角插值把字粒画到笔画轮廓外；**主线合并** `motion-shape-framework`：**辨** `outlineContourFirst`（`_arcPrefs`、弱静态垫底、`motionTimeBlend`、紊 分套）与 **plan-followup**（非 mask 格 ease、`?gridEase=0`、clock 秒、`?outlineFirst=0`、贝塞尔觅食、睡眠压低、游走惯性、拖拽）。 |
| 先前 | **3.31.0**：**廓** 剪影静态垫底；**辨** + `motionTimeBlend` + 紊 `_arcPrefs`；clock 秒、格 ease（曾误作用于 mask）、贝塞尔觅食、睡眠、惯性。 |
| 先前 | **3.28.0**：**形场 Consumer** `shape-consumer.js`（`ZiLingShapeFieldConsumer.create`：指数平滑 + 与本地 packed **最近邻对齐**）；`matrix-bridge.resampleBinaryPacked`。**Pet**：`ingestExternalWalkPacked` / `resetExternalWalkConsumer`；换形若 packed 尺寸变化则清外部态；`dumpShapeField` 含 `externalWalk`；`?shapeDebug=1` 提供 `_ingestDemoWalk()`。 |
| 先前 | **3.27.0**：**形场模块** `shape-field.js`（可走格 `Set` + 拓扑壳层 + `packWalkGrid` / `hashPackedGrid`）；**矩阵桥占位** `matrix-bridge.js`（二值栅格混合、指数持有、置信度门限）。**纹理体动** 侧栏「紊」：`spring_flow` / `adjacent_swap`（关 `gridMarch` 时芯层邻格换位）；换形 **纹理预算** `_textureBudgetMul`；`?textureMotion=`、`?shapeDebug=1` → `_shapeDump()`。 |
| 先前 | **3.26.0**：**谐波默认严格格点**（`silhouetteStrictHarmonicGrid`）：连续谐波/流体 **不** 叠在 march 前坐标上；**ensemble 离散 ±1 格** 驱动曼哈顿步进。**亚格颤抖** 独立为侧栏 **「颤」**（`_arcPrefs.glyphsJitter`）+ URL `glyphsJitter`。**性能**：巨字 / mask 叠分 **6→4**、**5→3** 遍。蛇行亚格微摆随「颤」。 |
| 先前 | **3.25.0**：**流线蛇行** 默认 **螺旋走廊**（切比雪夫环 + 极角）；**弓字** `zigzag` 保留为 `snakePathVariant`。**蛇行目标格去重**（`_snakeResolvedIdx` 每帧贪心顺延）。**URL**：`motionStyle` / `bodyMotion`、`snakePath`。`setSnakePathVariant`。 |
| 先前 | **3.24.0**：侧栏 **「轨」** `bodyMotionStyle`（`_arcPrefs` 分套）：**谐波亚格** / **流线蛇行**（`_rebuildMaskSnakeWalkPath` 弓字走廊 + `_snakePhase` + 序连线）/ **轮廓游走**（mask 内恢复游走）。**叠分** mask **5 遍**；蛇行后 **再分离**；lifecycle **更慢**淡出。**巨字** `enforceSpacingPasses` 略增。`DESIGN` **§2.6～2.7** 记录范式与迭代负优化审视。 |
| 先前 | **3.22.0**：**亚格绘制位移** `_silDrawOx/_silDrawOy`（平滑跟随谐波目标），解决「格点四舍五入后大量字像素静止」。**剪影谐波** 加 **弱倍频 + 索引相移** 使字字有微动且同拍。**`glyphMotionSpeed`** 显式驱动 `ensBoost`、`speedVis`、`marchGms`。**叠分** mask 4 遍 + kao `rMax`。**剪影** 关 `flashBoost`、缓和 lifecycle alpha。 |
| 先前 | **3.21.0**：**剪影格吸附** `_nearestWalkableMarchCell`：目标格出 mask 时迈到最近可走格，辨形优先。**`isMaskBackedMegaKao`**：待机层有 mask 的巨字/颜文字 **关格子游走**、**统一和谐体内波**（与呈现层同相位，待机仍吃待机运动内核）；**弱流体/撞墙/点散/闪光** 与呈现层对齐收紧。**淡出/补步/重生** 扩展到待机剪影作兜底；**仅呈现层和谐** 重生时 `_randomChar()`。`patrolAmpMul`/`lagK` 在剪影换形时收窄。 |
| 先前 | **3.20.0**：**策划书 2.5 落地扩展**：**空缺内向补步** `_stepSilhouetteVacancyInpull` + **重生换新字**；**呈现层剪影** 覆盖 **`mega` 与 `kao_*`**（`isPresentationSilhouetteHarm` / `mergePresentationSilhouetteMotion`）。**全队 `_ensemblePhase`**：非剪影体内波改 **共享节拍 + 整数比谐波**；`patrolAmpMul` / `lagK` **收窄**。**DESIGN 2.5** 写清原则与可推广范式。 |
| 先前 | **3.19.0**：呈现巨字和谐场、淡出重生（仅 mega）。 |
| 先前 | **3.18.0**：**呈现层锁形**；巨字布局/叠分；**波·徙·粒** 分层参数。 |
| 先前 | **3.17.0**：**侧栏层级**（`uiArcMode`）驱动运动内核；互斥形态区；`_arcPrefs` 色速墨浮。 |
| 先前 | **3.16.0**：**双运动模态**（按形态名推导 `getMotionProfileKernels`；已弃用为主路径）。 |
| 先前 | **3.15.0**：**巨字**：面积规划粒子、滑入空格、边缘/内部分层等。 |
| 先前 | **3.14.0**：**巨字字腔**：外连背景距离场 + 去字腔环；无衬线 + 600；计时槽位同步。 |
| 先前 | **3.13.0**：**巨字**：壳层像素 **分层抽样**；spread/enforce 后 **远点拉回壳层** + 再间距整形；**字数/壳面积** 联合估算粒子上限 **240**；多字串 **缩小初始字号**。**计时/时分秒**：点阵目标 **按亮格均分**；`setForm` 按 **亮格数** 自动调 `particleCount`；**格距** 略增。**巨字** immutable 体内波略增。 |
| 先前 | **3.12.0**：**贴墙「卡住」**：锚点夹紧改用与碰撞一致的 **整身半径**（旧版 `0.42×r` 会把目标点拉到墙内带，与 `PB.resolve` 冲突）；撞墙 **切向滑移冲量** + 更强 `_wallShatter`；**漂浮轮廓**：字灵/文稿模式 **不画扩张涟漪线圈**（仅 intro 保留），**虚线活动区**默认隐藏、`?dev=1` 显示。**巨字**：`gridCell` 联动 spread/enforce、更强 `enforceTargetsMinSpacing`、略降粒子上限。**速** 按钮修复（不再误触睡眠）；`gms` 作用于 **巡逻、整体弹簧、流体弹簧、华容道间隔**。 |
| 先前 | **3.11.0**：**撞墙**：`resolve` **贴边即反弹 + kick**（零速度也有反馈）；**拖拽顶虚线框**溃散；画布 **虚线活动区**；**涟漪**限速/限半径/淡出/条数上限（减轻漂浮线圈）；**巨字** `enforceTargetsMinSpacing` + 更保守粒子 + 更强 spread；侧栏 **速** 调 `glyphMotionSpeed`；**标题**「开发者页控制台」。 |
| 先前 | **3.10.1**：移除 mask **剪影叠绘**；减轻叠字（spread/分离双遍等）。 |
| 先前 | **3.9.0**：侧栏 **加宽**（约 108px）+ 待机按钮 **3 列**；**拖拽**时格点目标统一用 `pos`（修复「部分字不跟手」），拖曳滞后仅作 **绘制层** 位移；**拖曳中**跳过叠字分离；**华容道**邻格随机互换（非 script/计时/锁运动形态）；**墨/浮**对比度加大；巨字粒子 **slot** 略增、文稿 mask 行距与布局 **1.42** 对齐。 |
| 先前 | **3.8.1**：**回稿手势**改为「长按蓄满 → 提示 → **松手**才 `revertToScript`」；超过 **8px** 移动视为拖动并取消回稿意图，避免与拖拽混淆。 |
| 先前 | **3.6.0**：去动物、关镜像、墨色场、去重、巨字 stroke 等。 |
| 先前 | **3.3.2**：画布整数 CSS 与 buffer 对齐 DPR。 |
| 先前 | 已完成/未完成行级吞食与穿透；`gh-pages` 与 `main` 同步策略；cel 层次与旋迹形态等。 |

---

## 4. 与 `PLAN.md` 的关系

- **DESIGN.md**：产品意图、交互原则、矛盾处理规则。
- **PLAN.md**：版本对照、需求勾选、工程待办（P1/P2…）。
- **ZI_LING_STAGE_REPORT.md**：阶段性汇报——宠物介绍示意、设计动因、与 App / 后端 / UI 对接建议（嵌入与 API 契约形状）。
