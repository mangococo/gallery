# Gallery Theme System

> 状态：规范（normative）。改主题相关代码前先读这篇；本文与
> `tests/theme.test.ts` 契约测试共同构成主题系统的唯一真相。

Gallery 的主题系统参考 Cherry Studio 的分层思想（foundation → runtime 输入 →
公开语义层 → Tailwind 适配器），但视觉身份完全属于 Gallery 自己：
**旅行 × 摄影 × 手账 × 纸张 × 暖光**。内置五套主题（每套都含完整的亮/暗映射）：

| id | 名称 | 气质 |
| --- | --- | --- |
| `default` | 暖纸 | 米白暖棕，明亮手账 |
| `candle` | 烛光 | 蜜色琥珀，烛光暗房 |
| `yuebai` | 月白 | 素白青灰，低饱和冷白 |
| `dailan` | 黛蓝 | 黛蓝靛青，蓝调信笺 |
| `qingci` | 青瓷 | 青瓷釉色，低饱和青绿 |

## 1. 架构总览

```text
Primitive Tokens (--p-*)          基础材料：纸张/琥珀/陶土/暖灰墨/夜色
        ↓  仅语义层与 Runtime 输入可引用
Runtime Theme Inputs (--gt-*)     品牌驱动旋钮：accent / accent-ink / accent-soft
        ↓  palette 在这里覆盖；未来「自定义主题色」也只写这里
Semantic Tokens (--*)             公开 Theme API：background/surface/ink/primary/…
        ↓  data-palette × data-mode 双属性解析矩阵
Tailwind Adapter (@theme inline)  --color-* → 语义工具类（bg-surface / text-ink …）
        ↓
Components / Pages                只表达 surface / content / interactive / danger …
```

文件布局（`src/renderer/src/`）：

```text
theme/
├── index.ts            公共出口（useTheme 等）
├── types.ts            ThemeMode / ThemePaletteId / ThemeDefinition
├── registry.ts         Theme Registry（default 暖纸 / candle 烛光）
├── mode.ts             resolveMode 纯函数（node --test 直接可测）
├── runtime.ts          applyTheme + localStorage 首帧缓存
├── provider.tsx        ThemeProvider + useTheme()
└── tokens/
    ├── primitive.css       --p-*   原材料
    ├── runtime-inputs.css  --gt-*  品牌驱动输入
    ├── semantic.css        --*     基础语义层（画布/文字/品牌/状态）
    └── gallery.css         --*     产品语义层（viewer/scrim/tape/polaroid）
```

`index.css` 负责 `@import` 上述 token 文件（顺序即级联顺序）、
`@theme inline` 适配器与全局元素样式（手账签名类 `.washi-label`、
`.polaroid-frame`、`.stitch-line`、DatePicker、Leaflet 等）。

## 2. Primitive Tokens（`--p-*`）

只描述「原材料」，不含页面语义。业务组件**禁止**直接消费（Tailwind 也不会
为它们生成工具类）：

| 材料 | 变量族 | 说明 |
| --- | --- | --- |
| 纸 | `--p-paper-50/100/200`、`--p-milk`、`--p-cream` | 米白纸张系（画布/衬纸/线） |
| 琥珀 | `--p-amber-200/300/500` | 品牌暖色（primary 系） |
| 陶土 | `--p-clay-200/400` | 赭红（danger 系） |
| 苔/麦 | `--p-moss-*`、`--p-wheat-*` | success / warning |
| 暖灰墨 | `--p-umber-100…700` | ink 文字系（按对比度定档） |
| 夜 | `--p-night-700…950` | 暗色表面（暖褐，非冷黑） |
| 橡木 | `--p-oak`、`--p-oak-dark` | 翻阅室二阶表面 |
| 烟黑 | `--p-soot` | 照片上的中性遮罩基底 |

## 3. Runtime Theme Inputs（`--gt-*`）

极小的品牌驱动层，只有三个旋钮：

```css
--gt-accent        品牌强调色（琥珀）
--gt-accent-ink    强调色之上的墨色（对比度达标）
--gt-accent-soft   强调色的柔和洗染（胶带/软底）
```

规则：

1. `:root` 必须给出合法 fallback（当前 = default palette）。
2. 只允许被语义层引用，组件不允许直接写 `var(--gt-*)`。
3. 未来「用户自定义主题色」= 在 `<html>` 上内联覆盖这三个变量，语义层自动
   跟随——不需要动任何组件。

## 4. Semantic Tokens（公开 API）

分两块，均按 `data-palette × data-mode` 解析（`:root` 兜底 = default × light）：

### 基础语义（semantic.css）

```text
background  surface  surface-2  line
primary     primary-soft   primary-ink   primary-soft-ink
ink  ink-2  ink-3          （正文/次要/ tertiary 墨色，三级对比度层级）
danger  danger-ink         success  warning
overlay                     （弹层遮罩，暖黑）
```

### 产品语义（gallery.css）——Gallery 独有且全部有真实消费者

| Token | 语义 | 消费者 |
| --- | --- | --- |
| `viewer` `viewer-2` `viewer-ink` `viewer-ink-2` | 灯箱「翻阅室」暖褐房间 | Lightbox |
| `scrim` `scrim-ink` | 照片之上的悬浮层（恒黑/恒白，**不随主题翻转**——照片内容不可预测） | PhotoWall 角标/悬浮按钮、Lightbox 控件、视频底 |
| `tape` `tape-ink` | 和纸胶带面/墨 | `.washi-label`、日期贴 |
| `polaroid` | 相纸白边 | `.polaroid-frame`、`.viewer-polaroid`、地图标记 |

配对墨色的来源关系（单一真相，避免双处维护）：

```css
--primary: var(--gt-accent);          --primary-ink: var(--gt-accent-ink);
--primary-soft-ink: …                 --tape-ink: var(--primary-soft-ink);
```

### 对比度契约（WCAG 2.x，自动校验）

- 正文小字（< 18px）：前景/背景 ≥ **4.5:1**。
- 展示大字/加粗标题（`font-display` 大号）：≥ **3:1**（如 `text-primary` 标题）。
- 豁免：hover/active 瞬态强调色、照片上的遮罩白字（scrim 恒白对恒黑底 21:1）。
- 校验入口：
  - `npm test`（tests/theme.test.ts，全部组合 × 全部配对，CI 级）
  - `node scripts/contrast-report.mjs`（人工阅读用逐项报告）

为满足契约做过的取舍（后续改色值前先看这里）：

- 亮色 `ink-2/ink-3` 重定档（`#6f6357`/`#786a5c`）——原 `#a89b8d` 只有 2.6:1；
  三级层级改由「对比度 + 字号/字重」共同表达。
- 亮色品牌琥珀微调 `#c08a52 → #ba844b`（3.05:1 过大字 AA；肉眼几乎无差）。
- 主按钮白字废弃：白 on 琥珀只有 2.2~3.0:1。现在用 `text-primary-ink`
  （琥珀上盖深棕墨，5~8:1，像盖在牛皮胶带上的印章，更贴手账气质）。
- danger-ink 在暗色下是深暖褐（`#2b160f`）而非白字（白 on 赭红 3.3:1 不达标）。

## 5. Light / Dark / System + Theme Registry

- **Mode**：`light | dark | system`。`system` 跟随 OS（主进程 `nativeTheme`
  推送 `pushThemeSystemChanged`），解析成 resolved mode 后落到
  `<html data-mode>`。
- **Theme（palette）**：五套（见文首表格），落到
  `<html data-palette>`。二者正交：任一 palette 都有完整的亮/暗两套映射。
  暗色身份由契约测试分别守护：暖系（default/candle）必须暖褐，冷系
  （yuebai/dailan/qingci）必须保留色相、不允许漂成中性黑。
- Registry：`theme/registry.ts`。新增主题的步骤见 §10。

运行时 API：

```ts
const { mode, theme, resolvedMode, systemDark, themes, setMode, setTheme } = useTheme()
```

- `setMode()` → `api.setTheme()` → 主进程 `settings.theme_mode` +
  `nativeTheme.themeSource`（让 OS 级 API、窗口底色都跟随）。
- `setTheme()` → `api.setThemePalette()` → 主进程 `settings.theme_palette`。
- **持久化的真相在主进程 settings 表**；渲染层 `localStorage`
  （`gallery:theme-mode` / `gallery:theme-palette`）只是同步镜像，用于 JS
  生效前的首帧：`ThemeProvider` 在 `useLayoutEffect`（绘制前）落地
  `data-mode/data-palette`，IPC 返回后再校准。窗口创建时主进程也会按
  palette+mode 设置 `backgroundColor`（main/index.ts 的 PAPER 表，与
  semantic.css 保持同步）防首帧闪烁。
- 组件里**零** `dark:` 前缀、**零**原始色值——切换即全局生效，无需重载。

## 6. 自定义 CSS（用户覆盖）

设置 → 外观 → 「编辑 theme.css」：打开（不存在则先创建模板）
`<userData>/theme.css`。**保存即热更新**——主进程 fs.watch 监听（300ms 防抖），
经 `pushThemeCustomCssChanged` 推送全文，渲染层注入
`<style id="gallery-custom-css">`（位于所有 token 样式之后，同特异性下后者胜出）。

可覆盖任意语义 token，支持按主题/明暗组合选择器：

```css
/* 所有主题 */
:root { --primary: #5a7d9a; --primary-ink: #ffffff; }
/* 只改暗色画布 */
[data-mode='dark'] { --background: #14181c; }
/* 只改烛光主题的暗色 */
[data-palette='candle'][data-mode='dark'] { --viewer: #14100b; }
```

注意：

- 覆盖后**没有自动对比度保护**——自定义值由使用者负责可读性；
- 文件删除后自动回到主题预设（无需重启）；
- 该文件即持久化本身，不进 settings 表。

## 7. Tailwind 用法

`@theme inline` 把语义变量暴露为工具类（Tailwind v4）：

```css
@theme inline {
  --color-background: var(--background);
  --color-scrim: var(--scrim);
  /* … */
}
```

组件里写语义工具类 + 透明度修饰符（alpha 走 color-mix，任意 token 可用）：

```tsx
<button className="bg-primary text-primary-ink">        {/* 主按钮 */}
<div className="fixed inset-0 bg-overlay" />            {/* 弹层遮罩 */}
<div className="absolute inset-0 bg-scrim/45 text-scrim-ink" />  {/* 照片悬浮层 */}
<span className="text-ink-3">2026 · 42 张</span>        {/* meta 文字 */}
```

## 8. 组件消费准则

页面/组件只表达**角色**，颜色决策全部在 Theme：

| 语义 | 工具类 |
| --- | --- |
| 画布 / 面板 / 次级面板 | `bg-background` / `bg-surface` / `bg-surface-2` |
| 正文 / 次要 / meta 文字 | `text-ink` / `text-ink-2` / `text-ink-3` |
| 主操作按钮 | `bg-primary text-primary-ink` |
| 软底操作（标签胶囊） | `bg-primary-soft text-primary-soft-ink` |
| 危险操作 | `bg-danger text-danger-ink`（文字引用用 `text-danger`） |
| 成功 / 警告 | `text-success` / `text-warning` |
| 弹层遮罩 | `bg-overlay` |
| 照片上的角标/按钮 | `bg-scrim/NN text-scrim-ink` |
| 灯箱翻阅室 | `bg-viewer text-viewer-ink`（二阶 `viewer-2`/`viewer-ink-2`） |
| 边框 / 分隔 | `border-line`（强调边框 `border-primary/NN`） |

## 9. 禁止事项

1. **禁止新增原始色值**：`bg-[#fff]`、`text-white`、`bg-black/40`、CSS 里的
   `color: #xxx` 一律进 token。既有豁免（不要「顺手修复」它们）：
   - `src/main/services/journal.ts`——手账导出产物是印刷品，固定纸色；
   - `src/main/services/thumbnails.ts`——视频占位 SVG 属于插画素材；
   - `scripts/contrast-report.mjs` 等工具脚本。
2. **禁止 `dark:` 前缀**：语义 token 自动随 `data-mode` 切换。
3. **禁止直接消费 `--p-*` / `--gt-*`**：组件只允许语义工具类。
4. **禁止为单个组件造 token**：token 必须表达稳定视觉角色且有 ≥1 个真实
   消费者；`hover:text-primary` 这类瞬态强调不算违例但新 token 不为它而生。
5. **不要引入** CSS-in-JS / 状态管理库 / Theme Engine——Context + CSS 变量 +
   Tailwind v4 就是全部。

## 10. 如何新增主题（例：Midnight）

1. `tokens/runtime-inputs.css`：加 `[data-palette='midnight']`（及暗色差异块）
   覆盖三个 `--gt-*`。
2. `tokens/semantic.css` + `tokens/gallery.css`：加
   `[data-palette='midnight'][data-mode='light'|'dark']` 块，**完整映射**全部
   语义 token（缺失会被契约测试抓住）。
3. `theme/registry.ts`：注册 `{ id: 'midnight', name: …, description: … }`；
   同步 `@shared/types` 的 `ThemePaletteId`。
4. `main/index.ts` 的 PAPER 表加窗口底色镜像。
5. 设置页主题卡、持久化、组件、页面：**零改动**。

## 11. 测试与验收

| 层 | 入口 | 覆盖 |
| --- | --- | --- |
| 契约/对比度/运行时 | `npm test`（tests/theme.test.ts） | 四组合 token 全量、foreground 成对、引用图闭合、WCAG 配对、resolveMode 矩阵、registry 一致性、缓存容错 |
| 人工对比度报告 | `node scripts/contrast-report.mjs` | 逐对数值 |
| E2E 功能链路 | `GALLERY_E2E_STEPS=scripts/e2e/steps/17-theme.json` | 亮→暗→烛光切换、overlay/相纸/菜单 token、灯箱、侧栏切换 |
| E2E 持久化 | `scripts/e2e/theme-persistence.sh` | 真重启后 mode+palette 恢复（两阶段共用 userData） |
| E2E System | `GALLERY_E2E_STEPS=scripts/e2e/steps/18-theme-system.json` + `GALLERY_E2E_FLIP_THEME` | system 按 OS 解析 + themeSource 翻转后免重载跟随 |
| E2E 自定义 CSS | `scripts/e2e/custom-css.sh` | theme.css 注入生效 + 保存即热更新 |
