# 深空背景插件 · 核心记忆与防回归规则

> 本文件是**强制**的工程契约。任何修改 `client.js` / `preview.html` / `test/*` 的提交，
> 都必须先读完本文，并在提交前跑通 `npm run verify`。

---

## 零、架构基线（v2.0.0 重构后）

**核心原则：只改主题令牌，不用通配符覆盖。**

| 维度 | v1.x（已废弃） | v2.x（当前） |
|---|---|---|
| 视觉实现 | `[class*="_card"]` 等通配符 + `!important` 暴力清空背景 | 27 个 `--dsw-*` 官方令牌 |
| 深浅主题 | 一套硬编码深色 + 一堆 `:not()` 补丁 | `{ light, dark }` 双值，DSH 自动择一 |
| 文字颜色 | 全局强制 `#FFFFFF !important` | 由 `--dsw-alias-label-*` 令牌控制 |
| 补充 CSS | 400+ 行 | 10 行（只做令牌做不到的事） |
| 细节一致性 | 靠手工补丁，反复出问题 | 继承 DSH 原生圆角/层次/阴影 |

**为什么必须这样**：DSH 用 CSS Modules，类名是 `_card` / `_item` / `_view` 这类短词。
`[class*="xxx"]` 会命中大量无关子元素 —— 历史上已因此炸过两次（菜单三层套框、卡片内部被框）。
任何"再补一个通配符"的方案都会重蹈覆辙。

---

## 一、缺陷登记簿（Bug Registry）

### BUG-001 · 玻璃不透明度滑块"调节没效果"（真因是 normalize 覆盖）
- **现象**：拖动滑块 → 数值瞬间弹回 0，界面无变化。
- **真因**：`SpaceLayer` 的 effect 依赖 `[doc, actions]`，`doc` 每次 store 变化都换新引用
  → effect 重跑 → `actions.normalize()` → 其中 `draft.surfaceOpacity = 0.0` 无条件归零。
  **不是 CSS 问题。** 之前 5 次修改都在改 CSS，全部打偏。
- **现状**：v2.0.0 已彻底移除该滑块（用户决策 2），`surfaceOpacity` 字段与 action 全部删除。
- **铁律**：**绝不允许重新加回"玻璃不透明度"滑块。** 悬浮面板只保留「航行速度」+「星空粒子数量」。
- **通用教训**：`normalize()` 绝不能无条件覆盖用户可调字段。`normalize` 的 effect 必须只依赖 `[actions]`。

### BUG-002 · 拖粒子数滑块导致整屏闪烁卡顿
- **真因**：`createSpaceEngine` 的 effect 依赖 `[enabled, density]`，每拖一格就
  `dispose()` 销毁 canvas + 1.2 万星点 + RAF，然后重建。
- **根治**：引擎新增 `setDensity()` 热更新（只增删 `stars` 数组），effect 依赖只留 `[enabled]`。
- **铁律**：**任何连续可调的视觉参数都必须是热更新，禁止放进会 dispose 引擎的 effect 依赖里。**

### BUG-003 · cleanup 清空样式造成一帧闪白
- **真因**：引擎 effect 的 cleanup 里调 `updateDynamicStyles({ enabled: false })`，
  而该 effect 会因 `density` 变化频繁重跑 → 样式表被清空 → 下一帧才重建。
- **根治**：样式启用/停用只由「样式副作用」负责，引擎 cleanup 绝不清样式。

### BUG-004 · 浅色主题下"部分字体不显示"
- **现象**：切浅色后侧栏、未选中外观卡片、配置按钮文字隐形。
- **真因**：DSH 浅色主题把非标题文字设为深灰（`#4b5563`），而插件当时做了全透明穿透，
  深灰字落在深黑星空底上 → 物理隐形。同时全局强制 `#FFFFFF` 又造成白卡片白字。
- **根治**：v2.0.0 用令牌双值（`light: #0F172A` / `dark: #FFFFFF`），
  浅色主题下背景变为 `rgba(248,250,253,0.74)` 磨砂玻璃，深色文字有足够对比。
- **铁律**：**绝不再用全局 `color: #FFFFFF !important` 覆盖文字色。** 一律走 `--dsw-alias-label-*`。
- **验证**：`test/engine.cjs` 里有 WCAG AA（≥4.5:1）对比度断言，六个组合全部覆盖。

### BUG-005 · 菜单项与卡片内部多重嵌套灰框
- **真因**：`[class*="_item"]` / `[class*="_card"]` 命中 DSH 内部所有子元素
  （`BI5uFG_itemIcon`、`_cardTitle`、`_cardAction`…），每层都被加 `border: 1px solid`。
- **根治**：v2.0.0 彻底删除所有 `[class*="tag"]` / `[class*="badge"]` / `[class*="_item"]` 通配符。
- **铁律**：**禁止新增任何 `[class*="短词"]` 形式的边框/背景规则。**
  需要的话必须用 DSH 的完整类名或 `role` 属性精确定位。
- **验证**：`test/visual.cjs` 在真实浏览器里检查菜单项与卡片内嵌边框数必须为 0。

### BUG-006 · `_bottomRow` 被误当 composer 处理
- **真因**：`mP3x-q_bottomRow` 是 **AppFrame 的整个底部行容器**（grid 第二行），
  不只是聊天输入区。给它加 composer 渐变 + `z-index:10` 会污染其它底部 UI。
- **铁律**：composer 相关样式只能命中 `[data-composer-seat]` / `[class*="composerSeat"]` / `[data-conversation-region="composer"]`。

### BUG-007 · 浅色主题星空被多层白底遮挡（v1.2.7 引入，v1.2.8 修）
- **真因**：给 `body` / `_frame` / `_main` / `_centerCol` 各加 `rgba(246,248,252,0.88)`，
  多层嵌套叠加后不透明度累加到 ≈1.0 → 变成实心白 → 星空完全看不见。
- **铁律**：**绝不在嵌套容器上叠加半透明背景。** 半透明只允许出现在「最外层一次」，
  内层要么透明要么用令牌层级（layer-1..4 是同一坐标系，不是叠加）。

---

## 二、渲染验证踩坑记录（preview.html / visual.cjs）

这些坑的共同点是：**单元测试全绿，但肉眼看还是错的。**

### PIT-001 · canvas 没设 CSS 尺寸 → 只画一半
`<canvas>` 的 `width/height` 属性是绘制缓冲尺寸（DPR 缩放后会变大），
如果 CSS 没写 `width:100%;height:100%`，它按属性尺寸显示 → 只盖住面板一部分，
下方露出 `.frame` 半透背景叠在 body 白底上 → 脏灰色带。
**必须**：`.space { position:absolute; inset:0; width:100%; height:100%; display:block; }`

### PIT-002 · `data-theme` 挂错层级 → 选择器失效
`data-theme` 挂在 `.pane` 上，但 CSS 写成 `html[data-theme="light"] .tag` → 永不命中
→ 浅色主题的标签保持深色主题的惨白淡蓝。
**必须**：选择器前缀与属性实际挂载的祖先节点一致。改完用 `visual.cjs` 的「标签色适配」断言兜底。

### PIT-003 · 浮层定位压住待观察元素
菜单 / 审计面板初始放在底部，结果压住 composer 和正文卡片，截图根本看不清。
**必须**：浮层放在面板空旷区，且 `visual.cjs` 截图后人工确认一次。

---

## 三、自动化验证契约（提交前必须全绿）

```bash
npm run verify     # = npm run check && npm run visual
```

| 套件 | 文件 | 项数 | 作用 |
|---|---|---|---|
| 契约测试 | `test/run.cjs` | 74 | 模块形状、槽位、纯函数、store |
| 引擎测试 | `test/engine.cjs` | 45 | setDensity 热更新、令牌完整性、WCAG 对比度、层级单调性、旧架构负向断言 |
| 视觉测试 | `test/visual.cjs` | 浏览器内 | 真实 Chromium 渲染，读 `getComputedStyle` 算实际对比度、检查边框/圆角/画布铺满 |

**为什么需要第三套**：前两套是字符串 `includes()`，无法发现"细节丑"。
v1.x 时代 65 项全绿但用户看到一堆问题的根因就在这里。

### 必须持续成立的关键断言

1. `normalize()` 不重置 `speed` / `density` / `enabled`（BUG-001 回归）
2. 引擎有 `setDensity` 且不抛错（BUG-002 回归）
3. 深浅主题 `bg-base` 必须不同（主题切换有效）
4. 深浅主题 `label-primary` 亮度必须一高一低（BUG-004 回归）
5. 六个文字/背景组合 WCAG AA ≥ 4.5:1（BUG-004 回归）
6. 令牌层级不透明度单调不减（层次感）
7. 菜单项与卡片内嵌边框数 = 0（BUG-005 回归）
8. 画布必须铺满 pane（PIT-001 回归）
9. 旧架构禁用项：`[class*="tag"]` / `[class*="badge"]` / `[class*="_item"]` /
   `[class*="_bottomRow"]` / `color: #FFFFFF !important` / `background: transparent !important` 全部不得出现

---

## 四、修改工作流

1. 读本文 → 确认要改的东西不违反任何一条铁律
2. 改 `client.js`
3. 若改了 PALETTE，**同步更新 `preview.html` 里的内联副本**（file:// 下 fetch 被拦截，无法自动读取）
4. `npm run verify`
5. 看 `_diagnostics/preview-dual-theme.png`，人工确认深浅两个主题都协调
6. 提交，commit message 注明对应的 BUG 编号
