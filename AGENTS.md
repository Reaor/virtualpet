# AGENTS.md

## Cursor Cloud specific instructions

This is a **zero-dependency, zero-build, pure front-end** project (vanilla HTML + CSS + JS). There is no package manager, no bundler, no test framework, and no linter.

### Running the application

Serve the project root with any static HTTP server:

```bash
python3 -m http.server 8765 --directory /workspace
```

Then open `http://localhost:8765/index.html` in a browser.

### Key files

| File | Purpose |
|---|---|
| `index.html` | Entry point, `ziling-build`, `#helpDialog` quick start |
| `styles.css` | 浅色 Apple 系布局与控件样式（`DESIGN.md` 主视觉）；毛玻璃、圆角、侧栏与舞台栅格 |
| `pet.js` | Pet engine: particle physics, 10 morphable forms, rendering |
| `app.js` | Application layer: interaction handlers, feeding, UI |

### Notes

- 产品交互与视觉真源见根目录 **`DESIGN.md`**（与早期「宣纸主视觉」类描述矛盾时，以 **DESIGN** 为准：`AGENTS.md` 仅描述工程形态）。**按构建检阅改进**：`docs/IMPROVEMENTS.md`。  
- **后续 AI**：**`docs/CONTEXT_ARCHIVE.md`**（用户声音与会话档案）→ **`docs/AI_CONTINUITY.md`**（原则与阅读顺序）→ **`HANDOFF.md`**。
- The page loads the **LXGW WenKai** web font from `cdn.jsdelivr.net`. Internet access is required for the intended look; without it, the browser falls back to system serif fonts (still functional).
- `?dev=1`：活动区虚线（pet）；画布**右上**显示 **上一帧** `_loop` 的 `frame` 总耗时（指数平滑 **~ms**）、`_update` / `_render` 分段时间、最近一次 **`_resize`**（ms），以及换形后的 **`setForm`** 分段与 `suggestMemo` 条数。
- **嵌入 WebView / 手机**：`pet.js` 在 **粗指针、窄视口、常见移动 UA、`prefers-reduced-motion`** 下自动启用 **`_embeddedMobilePerf`**（略降 DPR 上限、叠分遍数、粒子规模、装饰栅格与暗色斜线底纹）。`new Pet(canvas, { embeddedMobilePerf: true|false })` 可强制覆盖；URL **`?mobilePerf=1`** / **`?mobilePerf=0`** 或 **`?embedded=1`** 传给 `app.js` 中的 `Pet` 构造选项。若在宿主里**连点**改偏好，请用 **`pet.scheduleStabilizeAfterControl({ layoutHard })`**（合并为尾部一次 `snapshot→apply→_applyGridTypography`），勿在循环里直接多次调用 `stabilizeAfterControl`。
- There are **no automated tests, no linter, and no build step**. Validation is done by opening the page in a browser and interacting with the pet.
- 巨字呈现辨形与排版启发：仓库保持 **零依赖**，不引入 npm；可参考业界纯 JS 排版思路（例如 [chenglou/pretext](https://github.com/chenglou/pretext) 的测量与折行哲学、Canvas 文本度量）与常见 **mask 内 Poisson / 蓝噪声撒点** 论文/实现，将合适片段以自研函数形式写入 `pet.js`（见 `buildTextSilhouetteLayout` / `suggestMegaGlyphParticleCount` / `getMacroMeasureContext2d` / `segmentStringGraphemes` 等）。`setForm('mega')` 内对 `resolveMegaLayoutInput` 的结果会传入 `buildFormLayoutData` 复用，并对 `suggestMegaGlyphParticleCount` 做轻量 Map 缓存，避免同一次换形中重复栅格统计卡死主线程。**研究映射与字体统一说明**：`docs/research-pretext-typography.md`。
