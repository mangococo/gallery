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
## 链路清单（编号即 steps 文件序号）

- 01/02 删除旅行（亮/暗） · 03/04 照片收藏标签（亮/暗） · 05/06 地图（亮/暗）
- 07 手账导出 · 08 大相册性能（420 张） · 09 HEIC 链路
- 10 灯箱 ⌘K 回归 · 11 右键菜单体系 · 12 移动到旅行 · 13 灯箱翻阅室重做
- **14 回收站**：删照片→扫描不复活→删旅行→回收站页→UI 恢复旅行→API 恢复照片→二次删除+彻底删除→扫描稳定
- **15 首页视图**：时间线默认→照片墙（数量/视频右键/多选批量/灯箱/删除+角标+恢复）→切回时间线
- **16 灯箱真实输入**：sendInputEvent 走完整输入管线——真实点击开灯箱、灯箱 no-drag 断言（顶栏按钮不被
  drag-region 吞掉）、真实点击 X 关闭、真实点击 `...` 出菜单且置于最上层、单击缩放/双击防抖/滚轮/背景关闭
- **17 主题系统**：默认亮色启动→设置弹窗切暗色→切烛光 palette→overlay/相纸/右键菜单 token 断言→
  烛光暗房下灯箱→侧栏切亮色（palette 保持）→收尾留在烛光+暗色；
  **17-theme-verify** + `theme-persistence.sh` 用同一 userData 真重启断言恢复（见 docs/theme.md §10）

## 运行注意

- E2E 驱动时主进程会禁用 backgroundThrottling：窗口被遮挡时 macOS 会把 rAF 降到约 1/10 速度，
  framer-motion 退场动画被拉长会造成「灯箱未关闭」的假阴性。
- 14 链路会真实删除/恢复演示相册里的文件（run-all.sh 每链路重置相册快照，单跑需自行准备干净副本）。
- 暗色链路统一通过侧栏主题切换器（radiogroup）点击切换；
  直接调 `window.api.setTheme` 不会更新 React 状态（时序坑，勿用）。
