# 字灵（Zì Líng）产品计划书

> 对照需求逐项落地；完成项打勾，未做或部分完成写明阻塞与下一步。  
> **当前构建**：见 `index.html` 中 `ziling-build`（与页头 `buildStamp` 一致；近期为 **3.2.2** 起）。

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
| 表情：汉字沿剪影，不是 emoji 堆一团 | **已完成（2.8.0）** | `emoji_face_a/b/c` 使用 `charPalette` + 同一套剪影采样；`_applyEmojiPaletteIfNeeded` 改为读 `charPalette` |
| 字组成的倒计时（清晰可见） | **已完成（2.8.0）** | `clock` 形态点阵 **`cell` 加大**（约 `S*0.042`）；`?form=clock` 直接看；idle 下每分钟刷新 |
| 猫 / 狐 / 兔 / 鹤：要全身轮廓不要「只有一个头」 | **已完成（2.8.0）** | 四类形态改为 **全身剪影**（躯干、肢、尾/翅/耳等） |
| 月形态去掉 | **已完成（2.8.0）** | 删除 `moon`；`FORM_ORDER` 与 `CHAR_FORM_BIAS` 中 **月 → 星** |
| 容易切到龙 / 龙形态可见 | **已完成（2.8.0）** | **`dragon` 提前到 `FORM_ORDER` 较前**；仍为西方双翼飞龙剪影 |
| 变形跑左上角 | **已完成（2.8.0）** | **根因**：渐进换形目标曾用**局部格**与 **世界格 `mgx/mgy`** 混比。现 `_computeMorphGridTargets` 输出 **`twx/twy` 世界格心**，步进与完成判定一致；`_finishMorph` 反算局部 `tx/ty` 并同步 `mgx/mgy` |
| 运动美感、凑成形体的紧凑感 | **部分完成** | 已 **降低** `fluidStrength` 默认、**减小**巡逻 `pAmp`，减轻「散」；**未做**：轮廓内二次聚类、速度场、B-spline 格路径等 |

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
| 轮廓内游走 | **部分完成** | `maskDraw` + `rasterizeMask`；曼哈顿累积偏移 `wgx/wgy`；目标格经 `_worldCellWalkable` 筛选 |
| 拖拽非整块平移 | **部分完成** | 每字 `lagX/lagY` 弹簧追 `pos`，`lagK` 差异化 + 指针速度侧向冲量 |

URL：`?skipIntro=1` 或 `?pet=1` 跳过开场；`?form=lissajous` 等仍指定初始字灵形态。

### 1.12 在线风格参考 + 输入流 + cel 层次 + 旋迹（3.1.0）

| 子需求 | 状态 | 说明 |
|--------|------|------|
| 视频/动画中的轮廓与层次（设计记录） | **设计记录** | 赛璐璐/描边常见做法：顶光 + 硬分阶阴影 + **外轮廓**（inverted hull / 壳层挤出），如 [Cel 描边教程](https://danielilett.com/2019-06-15-tut2-4-edge-outline/)、[轮廓与笔压感](https://mooatoon.com/en/docs/TutorialLegacy/5.0-5.3/AddAdvancedRenderingFeaturesToCharacters/ControlOutline-5.3)。字灵侧用 `celRgbFromGlyph` 做明度分带 + 边缘部首字加描。 |
| 持续输入、双击文稿化字灵 | **已完成** | `textarea` 的 `input/change` 同步 `setScriptLines`；**双击** 与「化为字灵」同效 |
| 长按后拖回文稿 | **已完成** | 字灵 **inner** 区：先长按再拖则松手 `revertToScript`；**拖回文稿** 按钮同效 |
| 连续轻点画布 | **已完成** | `tapInteractionBurst`：涟漪与闪光随链长增强；**第三次轻点** 触发觅食 |
| 抽象几何 | **已完成** | **`spiro`（旋迹）**：内旋轮线 + `maskDraw` |

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

---

| 优先级 | 项 | 说明 |
|--------|----|------|
| P1 | **轮廓内更紧** | 对剪影采样点做 **K 均值 / 条带排序**，让字序沿轮廓或填充更「密实」 |
| P1 | **觅食/睡眠「像动物」** | 觅食锚点路径用 **低曲率折线**；睡眠时整体缩放到卧姿剪影或降低 `patrolAmp` |
| P2 | **格路径平滑** | 每段格移动 **ease**（短插值）或 **最少弯折** 分配，减少锯齿感 |
| P2 | **计时形态秒级可选** | 当前为 **分**刷新；可加 `clock_sec` 或 URL 参数控制刷新与显示 |
| P3 | **真 AI** | 需 endpoint / 密钥；前端只接协议 |

---

## 3. 版本号

- 见 `index.html`：`<meta name="ziling-build" content="…" />`  
- 每次对外可见发布前 **递增** `content`，并同步更新 **`pet.js` / `app.js` 的 `?v=`** 以便强刷缓存。
