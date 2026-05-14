# 字灵（Zì Líng）产品计划书

> 对照需求逐项落地；完成项打勾，未做或部分完成写明阻塞与下一步。  
> **当前构建**：见 `index.html` 中 `ziling-build`（与页头 `buildStamp` 一致；近期为 **3.32.2** 起）。  
> **产品设计书**：`DESIGN.md`（自上而下原则与矛盾处理规则；后续指示应写入该文件）。

## 0. 如何确认你看到的是「本计划对应的构建」

| 检查项 | 预期 |
|--------|------|
| 页头小字 | **build ×.×.×** 与 `meta ziling-build` 一致 |
| 脚本 / 样式 URL | `./pet.js?v=…` / `./app.js?v=…` / `./styles.css?v=…`（强刷缓存） |
| 页面 | 浅色 App 风；**无**整段「AI 建议」面板（协议仍可在代码 `ingestAiSuggestionBlock` 使用） |

若不符：多为 **CDN/浏览器缓存**。请无痕窗口或核对 Network 里 `pet.js` 响应内容首行附近版本。

**GitHub Pages 源若选「Deploy from a branch」且分支为 `gh-pages`**：须将 **`gh-pages` 与 `main` 同步**（`main` 上的 Actions 部署不会更新该分支）。本仓库已用推送合并保持 `gh-pages` ≈ `main`。

---

## 1. 需求对照（含你最近一次大反馈）

### 1.9 表情用「字」拼轮廓 · 大字倒计时 · 全身动物剪影 · 去月 · 龙可见 · 换形不挤左上角 · 运动更紧凑

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 表情 / 情绪 | **已完成（3.4.0 改版）** | **颜文字轮廓**（`kao_*`）替代旧汉字拼圆脸；冲击感仍可用「冲击：字」等指令；实现见 `buildTextSilhouetteLayout` + `kao` 字体栈 |
| 字组成的倒计时（清晰可见） | **已完成（2.8.0）** | `clock` 形态点阵 **`cell` 加大**（约 `S*0.042`）；`?form=clock` 直接看；idle 下每分钟刷新 |
| 猫 / 狐 / 兔 / 鹤：要全身轮廓不要「只有一个头」 | **已完成（2.8.0）** | 四类形态改为 **全身剪影**（躯干、肢、尾/翅/耳等） |
| 月形态去掉 | **已完成（2.8.0）** | 删除 `moon`；`FORM_ORDER` 与 `CHAR_FORM_BIAS` 中 **月 → 星** |
| 容易切到龙 / 龙形态可见 | **已移除（3.6.0）** | 动物类形态下线；`CHAR_FORM_BIAS` 中 **龙→傅里叶形** 等已重映射 |
| 变形跑左上角 | **已完成（2.8.0）** | **根因**：渐进换形目标曾用**局部格**与 **世界格 `mgx/mgy`** 混比。现 `_computeMorphGridTargets` 输出 **`twx/twy` 世界格心**，步进与完成判定一致；`_finishMorph` 反算局部 `tx/ty` 并同步 `mgx/mgy` |
| 字灵/文稿整体贴画布左上（非中心） | **已完成（3.4.0）** | `_resize` 中补写 **`center = (width/2,height/2)`**；`script`/`pet` 模式下将 **`pos`/`anchor` 拉回中心**（此前 `center` 未随画布更新，恒为 0,0） |
| 运动美感、凑成形体的紧凑感 | **部分完成** | 已 **降低** `fluidStrength` 默认、**减小**巡逻 `pAmp`，减轻「散」；**3.30.0**：mask 内游走带 **方向惯性**；**未做**：轮廓内二次聚类、速度场、B-spline 格路径等 |

### 1.1～1.8 历史条目（摘要）

- **栅格曼哈顿走位、一格一字、渐进换形、躯体字队列、日程词反馈、浅色 UI** 等：已在前序版本落地；细节仍以代码为准。  
- **蛇形**：已移除。  
- **觅食**：沿路径巡游 + 面板吸字；与拖拽解耦防卡死。  
- **AI 面板 UI**：已按产品决策移除；`ingestAiSuggestionBlock` 等 **API 仍保留** 供日后接后端。

### 1.11 开场空白 → 文稿 → 字灵 · 轮廓内游走 · 拖拽分流（3.0.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 初始画布空白 | **已完成** | `viewMode=intro`：仅背景 + 涟漪；`Pet` 不绘制字粒子 |
| 预设字段整齐呈现 | **已完成** | 形态 **`script`** + `buildScriptLayout`；textarea「呈现文稿」→ `enterScriptMode` |
| 化为字灵 / 回空白 | **已完成** | 「化为字灵」→ `awakenPet`（默认 `?form=` 或软团）；「空白」→ `enterIntroMode` |
| 轮廓内游走 | **部分完成（3.30.0）** | `maskDraw` + `rasterizeMask`；曼哈顿 `wgx/wgy`；`_worldCellWalkable`；**游走目标**约 **36%** 优先延续上一合法方向，路径更顺 |
| 拖拽非整块平移 | **部分完成（3.30.0）** | `lagX/lagY` 弹簧；**拖拽**时收敛率略升（更跟手） |

URL：`?skipIntro=1` 或 `?pet=1` 跳过开场；`?form=lissajous` 等仍指定初始字灵形态。

### 1.12 在线风格参考 + 输入流 + cel 层次 + 旋迹（3.1.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 视频/动画中的轮廓与层次（设计记录） | **设计记录** | 赛璐璐/描边常见做法：顶光 + 硬分阶阴影 + **外轮廓**（inverted hull / 壳层挤出），如 [Cel 描边教程](https://danielilett.com/2019-06-15-tut2-4-edge-outline/)、[轮廓与笔压感](https://mooatoon.com/en/docs/TutorialLegacy/5.0-5.3/AddAdvancedRenderingFeaturesToCharacters/ControlOutline-5.3)。字灵侧用 `celRgbFromGlyph` 做明度分带 + 边缘部首字加描。 |
| 持续输入、双击文稿化字灵 | **已完成** | `textarea` 的 `input/change` 同步 `setScriptLines`；**双击** 与「化为字灵」同效 |
| 长按后拖回文稿 | **改版（3.7.0）** | **inner** 区 **长按约 500ms** 直接 `revertToScript`（无需再拖）；拖拽松手不再单独触发「拖回」 |
| 连续轻点画布 | **已完成** | `tapInteractionBurst`：涟漪与闪光随链长增强；**第三次轻点** 触发觅食 |
| 抽象几何 | **已完成** | **`spiro`（旋迹）**：内旋轮线 + `maskDraw` |

### 1.17 画布最大化 + 快捷形态 + 文稿清晰 + 字序密度（3.2.5）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 活动区小 | **已完成** | `playfield`：左互动栏 + 满幅 `stage-main` + 右文稿键；下方仅 textarea |
| 换形按钮 | **已完成** | 左栏「变觅眠抖」+ **团猫龙钟线** 快捷形态 |
| 字糊 | **已完成** | `script`：`cel` 关闭、停波、停巡逻抖动、`breath=1`、略抬 `gridCell`/字号 |
| 化灵=同一段字 | **已完成** | `awakenPet` 前 `_resizeGlyphsForScriptLines`；躯体 `_syncGlyphsFromScriptLines`（非 emoji 形） |
| 密度 | **已完成** | 粒子数 `clamp(字数×2.5, 72, 480)` |

### 1.16 脚本错误修复 + 舞台合一布局 + 设计书（3.2.4）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| `pet.js` 白屏 | **已完成** | 删除同一代码块内重复 `const mT`（SyntaxError） |
| 呈现与字灵同区 | **已完成** | `#stage` = `.stage-main`（画布）+ `.stage-dock`（文稿+工具栏）；呈现仍在画布上 |
| 底栏可点 | **已完成** | 画布事件绑定在 `#stageMain`，不绑整段 `#stage` |
| 设计书 | **已完成** | 新增 `DESIGN.md`，矛盾规则：**后指示覆盖前** |

### 1.15 UI 重构：画布独占舞台 + Apple 风格控件条（3.2.3）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 活动空间 | **已完成** | 文稿移出 `#stage`；舞台 `flex` 增高 + `_motionPad` 约 **8% 半宽**；idle 摆动再加大 |
| 按钮点不动 | **已完成** | 文稿与 `toolbar` 同属 `.controls-strip`，`z-index` 叠在内容之上，**不再浮在画布内** |
| 视觉 | **已完成** | 毛玻璃分组、44pt 级按钮、`toolbar` 内嵌四格、字灵模式 **docked** 压缩文稿高度 |

### 1.14 UI：活动范围 + 工具栏可点（3.2.2）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 字灵活动范围 | **已完成** | `_motionPad()` 约 **0.2×半宽** 边距（原 ~0.38×全尺寸）；idle 锚点摆动幅度加大 |
| 舞台高度 | **已完成** | `aspect-ratio` 略扁、`max-height: 72vh`、`min-height: 260px` |
| 换形/觅食等点不动 | **已完成** | `opening-panel.docked`：`pointer-events: none`，子元素恢复；`toolbar` / `import-row` `z-index: 20` |

### 1.13 字灵 + 输入：已完成吞食、未完成穿透（3.2.0～3.2.1）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 已完成 → 吞入躯体 | **已完成** | 行含 `【已完成】` / `【完成】` 或行首 `✓`：去标记后的正文 `attachBodyChars` + `digestText`；用 `_scriptDigestSeen` 防同一行重复吞 |
| 未完成 → 穿透 | **已完成** | 行含 `【未完成】` / `【待办】`：不 `attachBodyChars`；可合并 `digestText` 做「待办」提示 |
| 回空白 | **已完成** | `enterIntroMode` 清空已吞食指纹 Set |
| 底部「写入」 | **已完成** | 多行按行分类；无标记的纯文本仍走旧「贴外圈」 |

### 1.18 巨字壳层 · 华容道游走 · 全形态点击散开 / 长按回稿（3.7.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 巨字糊、填心、重叠 | **已完成** | `sampleSilhouetteShell` + `noStroke` 巨字绘制；`spreadTargets2D`；格点去重在 **mask 内** 螺旋；`mega` 专用 `gridCell` |
| 凑形后字不走动 | **已完成** | 与 **文稿/计时/数字** 分离：`isMotionLayoutLockedForm` 仅约束后者；巨字/颜文字/曲线允许 `wgx/wgy`、internalMotion |
| 无法拖、点无散开 | **已完成** | `pointerInnerRadius`；`scatterTapBurst`（含 `nuisTap` / `tapInteractionBurst`）；拖拽 `lagK` 冲量略加强 |
| 长按回原本段落 | **已完成** | `app.js` 定时 `revertToScript` + `longPressDidRevert` 防误触连点 |

### 1.19 待机曲线侧栏 · 字色 · 浮光（3.8.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 去掉侧栏数字/巨字 | **已完成** | 巨字/数字走「形」与 `?macroText=`；`digit_*` / `mega` 仍可通过 URL |
| 软团+纹路 → 待机状态 | **已完成** | `STANDBY_MATH_ORDER` **34** 键；侧栏① 起序，悬停看全名 |
| 计时独立 | **已完成** | 「钟」「秒」自成分组 |
| 数十种数学曲线 | **已完成** | `registerStandbyMathForms`：李萨如变体、蔷薇瓣数、旋轮线、心脏线/蝶形/超椭圆等 |
| 颜色色板 | **已完成** | `bodyTintHex` + 弹层色块 + `<input type="color">` |
| 浮光律动 | **已完成** | `glowMode` 0～5，`drawGlyph` 透明度乘子 `_glowAlphaMul` |
| 回稿与拖动混淆 | **已完成（3.8.1）** | 长按蓄满仅 **武装**；**松手**才还原；位移 **>8px** 取消武装并进入拖动 |

### 1.20 侧栏加宽 · 拖拽跟手 · 渐变可见 · 华容道（3.9.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 左侧按钮区向左扩展 | **已完成** | `.rail-left` **108px**；待机 **3 列**网格，紧凑按钮高度统一 |
| 部分字拖拽不跟随 | **已完成** | 格点目标 **始终**用 `bx/by`（`pos`）；`lagX/lagY` 仅用于 **绘制偏移** + 更快拖曳收敛 |
| 颜色/浮光渐变不明显 | **已完成** | `bodyColorMode` 墨色 **跨度加大** + breath 权重；`_glowAlphaMul` **振幅与 clamp** 加宽 |
| 叠字、巨字、内部交换 | **部分加强** | 拖曳中 **不跑** `_separateOverlappingGridGlyphs`；`_tryHuarongAdjacentSwaps` **邻格互换**；巨字 `slotFootprint`↑、`buildScriptLayout` 与 mask **1.42** 对齐 |

### 1.21 目录拆分 · 轮廓辨识度 · 去拖拽色团 · 全幅边界撞碎（3.10.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 降低后续改动成本 / 省 token | **部分完成** | `docs/ZILING_LAYOUT.txt` 说明加载顺序；`js/ziling/play-bounds.js` 抽离边界逻辑 |
| 计时/巨字辨识度 | **加强** | `clock`/`chrono` **digitRowsMaskDraw** + **gridCell 对齐**；巨字 **shellMax 4**；immutable **统一相位** 体内波（**mask 仅离屏 walk，不画在画布**） |
| 拖拽色团与字灵偏离 | **已处理** | 去掉 `pos` 处 **径向渐变**；去掉 **绘制 lag 偏移**；`beginDrag` 同步 **lag=pos** |
| 活动范围与撞边 | **已完成** | `_playBounds` 近贴边；`_bodyClampRadius`；`PB.resolve` 反弹；`_wallShatter` 碎散 + 涟漪 |

### 1.23 撞墙溃散 · 巨字间距 · 涟漪收敛 · 运动速度 · 开发者标题（3.11.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 限制框架碰撞与溃散 | **加强** | `ZiLingPlayBounds.resolve` 贴边即 hit + **kick**；非拖拽撞墙 `_wallShatter`；**拖拽**顶虚线框也溃散 |
| 巨字重叠 / 自适应 | **加强** | `enforceTargetsMinSpacing`；`suggestMegaGlyphParticleCount` 更保守；spread/gridCell 上调 |
| 形状轮廓漂浮 | **减轻** | 涟漪扩张/透明度/条数上限；绘制时随半径衰减 alpha |
| 每字运动速度调节 | **已完成** | `glyphMotionSpeed` + 侧栏 **速** |
| 网页标题 | **已完成** | `<title>` 与副标题注明 **开发者页控制台** |

### 1.24 贴墙不卡 · 去漂浮线圈 · 巨字再疏 · 速钮修复（3.12.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 撞墙仍像「顶着不动」 | **已修** | `anchor` 夹紧半径与 `_bodyClampRadius` 对齐；撞墙切向速度 + 更强溃散 |
| 形状轮廓在外面漂 | **已修** | pet/script **不绘制**扩张涟漪；活动区虚线 **默认关**，`?dev=1` 开 |
| 巨字仍叠 | **加强** | 与 `gridCell` 联动的 spread/enforce；mega 格分离 **rMax 56 / 3 遍** |
| 「速」无效 / 反效果 | **已修** | 去掉误绑的 **睡眠** 切换；`gms` 扩展到巡逻、整体跟随、流体弹簧、华容道 |

---

### 1.25 巨字可读性 · 计时点阵塑形 · 形内微动（3.13.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 巨字断墨/糊成一团 | **加强** | 壳层 **分层抽样**；**远点 snap 回壳** + 再 `enforceSpacing`；字数+笔画带 **估粒子**（至 240）；长串 **缩小初始字号** |
| 计时/时分秒形塌/不全 | **加强** | `rowsToTargets` **按亮格均分**；n≤M 时 **跨格步进** 铺开；mask 方块略大；`setForm` 按 **亮格数** 自动调 `particleCount`；cellRel 上调 |
| 巨字内单字运动弱 | **加强** | `mega` 在 crisp 分支 **体内波振幅 ×1.42 / 流体微幅 ×1.35**（仍保持可辨字形） |

---

### 1.26 字腔留白 · 规整无衬线 · 计时实时刷新（3.14.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 巨字内部空隙被填满 | **已修** | 距离场仅自 **外连背景白** 播种；壳层 ink **排除邻接封闭字谷** 的像素；壳深默认 3 |
| 字体字腔 | **加强** | 汉字巨字 **无衬线栈** + **font-weight 600** |
| 计时不随时间变 | **已修** | `setForm` 不再把槽位写成 **-1**；`pet` 下非 **idle** 也检查分/秒槽刷新 |

---

### 1.27 巨字面积规划 · 内滑让位 · 外轻内活（3.15.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 字数按形状面积规划 | **已完成** | `suggestMegaGlyphParticleCount`：`fill×scale²×(1−voidFrac)/cellArea`，**传入实际 gridCell**；壳带下限；**250** 上限；**megaParticleMul** 按层调节 |
| 内部华容道向空白 | **已完成** | `_tryMegaSlideIntoVoid` 优先内部字滑入邻空格；`tx/ty` 与格心同步 |
| 边缘轻、内部动 | **已完成** | `_megaEdgeRing` / `_megaDeepInterior`：`wanderRad` 分层；互换/滑步加权；巨字 crisp 波略降 |

---

### 1.35 谐波严格格点 · 亚格颤抖分钮 · 叠分减负（3.26.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 默认横竖格移、非连续颤抖 | **已完成** | `silhouetteStrictHarmonicGrid`：谐波 + 关「颤」→ 关连续谐波/流体叠层；**ensemble 离散 ±1** 格目标 + `_nearestWalkableMarchCell` |
| 亚格颤抖可选 | **已完成** | 侧栏 **「颤」** `cycleSilhouetteGlyphJitter`；`_arcPrefs.glyphsJitter`；URL `glyphsJitter=1` |
| 卡顿 | **已缓解** | `_separateOverlappingGridGlyphs` 巨字 **4**、mask **3** 遍（原 6/5） |

---

### 1.34 蛇行螺旋走廊 · 目标格去重 · URL（3.25.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 螺旋 vs 弓字 | **已完成** | `snakePathVariant`：`spiral`（默认）/ `zigzag`；`_rebuildMaskSnakeWalkPath` |
| 同路径索引冲突 | **已完成** | 每帧 `_snakeResolvedIdx` 排序 + 顺延占位 |
| URL / API | **已完成** | `?motionStyle=`、`?bodyMotion=`、`?snakePath=`；`setSnakePathVariant` |

---

### 1.33 运动轨 · 蛇行流线 · 设计对照（3.24.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 侧栏「轨」分套 | **已完成** | `bodyMotionStyle` → `_arcPrefs`；`cycleBodyMotionStyle` |
| 谐波 / 蛇行 / 游走 三范式 | **已完成** | `BODY_MOTION_STYLES`、`usesMaskSnakeStream`、`allowGridWander` |
| 弓字走廊 + 序连线 | **已完成** | `_rebuildMaskSnakeWalkPath`、`_snakePhase`、`_render` 折线 |
| 叠字与闪现缓和 | **部分** | mask 5 遍分离 + 蛇行后再分；lifecycle 更慢（仍待笔画级拟合） |
| 文档：范式 + 负优化表 | **已完成** | `DESIGN.md` §2.6～2.7 |

---

### 1.32 剪影亚格绘制位移 · 全字微动 · 速钮可见性（3.22.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 格对齐导致「有的字不动」 | **已完成** | `_silDrawOx/Oy`：谐波目标与格心差经 lerp，绘制叠加（逻辑仍占格） |
| 统一节奏 + 轻微错位 | **已完成** | 剪影支：倍频/索引微相移 + `ensBoost`×`speedVis`×`marchGms` 让 **速** 明显 |
| 叠字 | **已加强** | mask 分离 **4 遍**；kao 搜索半径 **52**；lifecycle 后再分离一遍 |
| 闪现/闪烁 | **已缓和** | 剪影 **禁用** `flashBoost`；淡出/重生 **更慢**，重生 alpha **渐回** |

---

### 1.31 剪影格吸附 · 待机巨字/颜文字和谐对齐（3.21.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| march 目标格不出 mask | **已完成** | `_nearestWalkableMarchCell`：最近可走格螺旋搜索 |
| 叠分/华容后格仍偶发越界 | **已完成（3.32.1）** | `_enforceMaskBackedGlyphWalkable`：每帧末对 `silMaskPet` 用 `_worldCellWalkable` 校验 `(mgx,mgy)`，越界则 snap 并清 `_silDrawOx/Oy` |
| 待机层关游走 + 同相位体内波 | **已完成** | `isMaskBackedMegaKao`：剪影下跳过格子游走；`presSilHarm` 与 `silMaskPet` 均走 ensemble 体内波支 |
| 淡出/补步/重生兜底到待机 | **已完成** | `silMaskPet` 跑 inpull + lifecycle；重生 `_randomChar()` 仅 `isPresentationSilhouetteHarm` |
| 交互与流体收紧 | **已完成** | `scatterTapBurst` / `_wallShatter` / `flash` / 流体 / `rumble` 按 mask 剪影分级 |

---

### 1.30 剪影淡出 · 空缺补步 · 全队节拍（3.20.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 策划书 2.5 完整条文化 | **已完成** | 原则 / 双路径补位 / 泛化 / 参考意象 |
| 淡出后内向一格补位 | **已完成** | `_silhouetteVacancyPulls` + `_stepSilhouetteVacancyInpull` |
| 重生 + 新字 | **已完成** | `_randomChar()` 于 `_updatePresentationSilhouetteGlyphLifecycle` |
| kao_* 同 mega 和谐场 | **已完成** | `isPresentationSilhouetteHarm` |
| 非剪影：谐和体内波 | **已完成** | `_ensemblePhase` + crisp / soft 分支改写 |

---

### 1.29 呈现巨字 · 和谐场与淡出重生（3.19.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 策划真源 | **已完成** | `DESIGN.md` **2.5 节** 与变更记录对齐 |
| 统一体内速率 / 速钮 | **已完成** | `presentation`+`mega`：`phase = t * k * gms`，去多频 per-glyph；`stepBudget` 上限 3 |
| 淡出重生 | **已完成** | `_worldCellWalkable` 失败累加淡出；alpha→0 `_respawnMegaGlyphNearShell` |
| 关游走/华容道/滑步 | **已完成** | `presSilHarm` / `isPresentationSilhouetteHarm` 分支 |
| 弱流体/抖散/撞墙/闪光 | **已完成** | `waveAmpEff`、`rumble`、`_wallShatter`、`scatterTap`、`flash` 衰减 |

---

### 1.28 待机 vs 呈现 · 运动内核分层（3.16.0 → 3.17.0 修订）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 待机态（曲线/抽象） | **保持** | **3.17.0**：由侧栏 **待机层**（`uiArcMode=standby`）驱动 → `STANDBY_MOTION_KERNELS` 全 1；不再按形态名误判 |
| 呈现态（计时/巨字/颜文字轮廓） | **已完成** | **3.17.0**：**呈现层**（`uiArcMode=presentation`）→ `DISPLAY_MOTION_KERNELS`；解决计时因 `layoutLock` 未吃到缩放、曲线却被压慢的错位 |
| 呈现层 idle 误换待机形 | **已完成（3.32.2）** | `pickBiasedForm` 仅用 **`getFormOrderForUiArcMode(uiArcMode)`**；`app.js` 约 11s 自动换形在 **presentation** 下 **整段跳过**，避免「像自动回待机」 |
| 呈现层先静后动 | **已完成（3.32.2）** | **`presentationGlyphDynamics`**（侧栏 **动**，`_arcPrefs.presentation`；默认关）；与 **`presGlyphSleep`** 门控体内谐波/流体；蛇行 `_snakePhase` 在呈现开「动」时 **×1.55** 与谐波/轮廓游走振幅倍率拉开；URL **`?presDyn=1`** |
| 侧栏层级与参数分套 | **已完成** | **层** 切换互斥形态区；`_arcPrefs`：**速 / 颜 / 墨 / 浮** 分套；「变」仅当前层 `getFormOrderForUiArcMode` |
| 可观测 | **已完成** | `pet.uiArcMode`；`ZiLing.getMotionProfileKernelsForPet`（运行时）；`getMotionProfileKernels(form)` 仅兼容/调试 |

---

| 优先级 | 项 | 说明 |
| P1 | **觅食/睡眠「像动物」** | **部分加强（3.29.0）**：觅食锚点路径改为 **三次贝塞尔均匀采样**（低曲率、少折返）；睡眠时 **压低** `_ensemblePhase` / 流体 / 格移 / 蛇行 / 巡逻幅（`sleepMul`≈0.32）并 **略缩** `targetScale`≤0.88；仍可做卧姿剪影等 |
| P2 | **格路径平滑** | **部分完成（3.32.0）**：`gridCellMotionEase` **仅非 mask 形态**；巨字/颜 mask 剪影 **禁用 ease**（修复对角插值字粒画出笔画外）。URL **`?gridEase=0`** 关平滑；**未做**：B-spline 与最少弯折分配 |
| P2 | **计时形态秒级可选** | **已完成（3.29.0）**：`clockGranularity: "sec"`（URL **`?clockGranularity=sec`** 或 **`?clockSec=1`**）在 **`form=clock`** 下复用时分秒点阵与秒级 `setForm` 刷新；独立 **`chrono`** 形态不变 |
| P3 | **真 AI** | 需 endpoint / 密钥；前端只接协议 |

---

## 3. 版本号

- 见 `index.html`：`<meta name="ziling-build" content="…" />`  
- 每次对外可见发布前 **递增** `content`，并同步更新 **`pet.js` / `app.js` 的 `?v=`** 以便强刷缓存。
