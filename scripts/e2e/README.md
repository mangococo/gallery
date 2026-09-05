# E2E 验收截图（固化 steps）

每个 `steps/*.json` 是一套功能链路的验收脚本，配合 `src/main/e2e.ts` 的
GALLERY_E2E 钩子执行：先等待、再在页面里执行 JS（断言失败即抛错）、最后截图。
每个文件以 `_meta` 步开头说明本链路覆盖点与前置条件（运行时会打印到 stdout）。

## 前置

1. 生成演示数据：`node scripts/gen-demo.mjs`
   （产物在系统临时目录 `gallery-demo/` 下，含 `我的旅行/` 相册与预置 userData 库；
   HEIC 样张步需要 macOS + /usr/bin/sips，其他平台自动跳过）
2. 大相册链路（08）需演示数据带 420 张压测旅行：`GALLERY_DEMO_LARGE=420 node scripts/gen-demo.mjs`
3. 构建：`npm run build`

## 运行方式

推荐一键串跑（自动为每个 steps 文件重置 userData，保证幂等）：

    scripts/e2e/run-all.sh

手动跑单个链路：

    GALLERY_E2E=1 \
    GALLERY_USER_DATA=<临时目录>/userdata \
    GALLERY_E2E_ALBUM=<演示相册目录> \
    GALLERY_E2E_STEPS=scripts/e2e/steps/01-delete-trip.json \
    GALLERY_E2E_DIR=<截图输出目录> \
    npx electron .

导出链路（07）额外需要 `GALLERY_E2E_EXPORT_DIR=<目录>`，跳过系统保存对话框直存。

## 已知边界

- 环境变量钩子只在 `GALLERY_E2E=1` 时生效，正式构建不受影响。
- 窗口级拖拽导入依赖真实文件拖放事件，无法用页面内脚本模拟，未固化（手工验收路径：
  拖照片进窗口 → 选择旅行 → 导入成功 toast）。
- 地图链路（05/06）需要联网加载 OSM 瓦片；离线时断言仍应通过（标记数不依赖瓦片），
  但截图里地图区域为底色属预期降级。
- 暗色链路统一通过侧栏主题切换器（radiogroup）点击切换；
  直接调 `window.api.setTheme` 不会更新 React 状态（时序坑，勿用）。
