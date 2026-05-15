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

- 产品交互与视觉真源见根目录 **`DESIGN.md`**（与早期「宣纸主视觉」类描述矛盾时，以 **DESIGN** 为准：`AGENTS.md` 仅描述工程形态）。
- The page loads the **LXGW WenKai** web font from `cdn.jsdelivr.net`. Internet access is required for the intended look; without it, the browser falls back to system serif fonts (still functional).
- There are **no automated tests, no linter, and no build step**. Validation is done by opening the page in a browser and interacting with the pet.
- To test changes, reload the page in the browser after editing source files. The Python HTTP server does not need restarting for static file changes.
