# 改进速览（检阅用）

> 按构建号倒序；细节以 `DESIGN.md` 变更表与 git log 为准。嵌入宿主可只看本页 + `AGENTS.md`。

| 构建 | 主题 | 要点 |
|------|------|------|
| **3.35.28** | 渐进换形 → 巨字 mask | **`_finishMorph`** 尾帧 **`rasterizeMask` + `_rebuildMatteLayerCanvas`**（与 `setForm` 对齐）；**`_computeMorphGridTargets('mega')`** 临时同步呈现 **`gridCell`** 并传入 **`resolveMegaLayoutInput`**，**`morphFinalMeta.megaResolved`** 供 mask 尺度。 |
| **3.35.27** | 巨字呈现流畅 / 辨形 | 呈现剪影 **叠分遍数大降**（解耦拖 16→8、开/关内动 12/15→7）；格迈 **每帧 cap 1～2 格** + **`presMarchAccMul`** 压低累积；`GRID_MARCH_CELLS_PER_SEC` **5.05**；生命周期后叠分 **maxPasses 开内动 2**；体内 **`silStyleHarmMul`** 略收、**`_silDrawOx` 收敛**略快；贴边 **`clayMul`** 回调。 |
| **3.35.26** | 上下文档案 | 新增 **`docs/CONTEXT_ARCHIVE.md`**：用户声音、多轮会话归纳、开放题、PR 线索；**`AI_CONTINUITY` / `HANDOFF` / `AGENTS` / `ZILING_LAYOUT`** 互链；接手阅读顺序 **以档案为首**。 |
| **3.35.25** | 呈现格迈 / 拖 / 贴边 | 呈现剪影格迈与待机 **共用分数累积**（去「停多帧再齐跳」）；略抬 **`GRID_MARCH_CELLS_PER_SEC`**、关内静 **`accMul`**；**解耦拖**时恢复叠分 **第二遍**；贴边 **橡皮泥**略加强 + **`_wallRegroupK`** 更快；剪影拖 **残差略减**、`app.js` **拖动阈值**略降。 |
| **3.35.24** | 剪影叠字 / 闪现 | `_separateOverlappingGridGlyphs(opts?)` 支持 `maxPasses`；渐进换形 **`_finishMorph`** 尾部 `_resolveUniqueLocalGrid` + 叠分 + `_enforceMaskBackedGlyphWalkable` + 再叠分；呈现生命周期后 **补跑轻量叠分**；生命周期 **α 步幅收紧**、重生 **从更低 α 起步**；`glyphMotionSpeed` 在生命周期内改用 **`FIXED_GLYPH_MOTION_SPEED`**；换形中叠分遍数上限 **6**。 |
| **3.35.23** | 连点性能 | `scheduleStabilizeAfterControl` 合并尾部 stabilize；`scatterTapBurst` 大 N 采样。 |
| **3.35.22** | 匀速纵横 | `_gridMarchFrameAcc` + `GRID_MARCH_CELLS_PER_SEC`；格移时关格间 ease；换形减负。 |
| **3.35.21** | 低速常量 | 移除侧栏速/徙；固定 `FIXED_*` 迈格参数。 |

## 如何一眼对照代码

- **叠分**：`pet.js` → `_separateOverlappingGridGlyphs`
- **呈现剪影淡出/重生**：`pet.js` → `_updatePresentationSilhouetteGlyphLifecycle`
- **换形落地**：`pet.js` → `_finishMorph`
- **侧栏尾部对齐**：`app.js` 左栏 `finally` → `scheduleStabilizeAfterControl`
