# 画廊 · 旅行照片管理桌面应用

macOS 桌面应用（Electron），以手账风时间线管理你的旅行照片与视频。照片文件原地保存在自己的目录中，元数据存于独立的 SQLite 数据库，目录自包含、可迁移。

![技术栈](https://img.shields.io/badge/Electron-44-47848F) ![React](https://img.shields.io/badge/React-18-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6) ![Tailwind](https://img.shields.io/badge/Tailwind-v4-38BDF8)

## 功能特性

- 📅 **时间线视图** — 按开始日期倒序的手账时间线：缝线书脊、和纸胶带日期贴、拍立得照片堆叠（悬停散开，最多 9 张）
- 🗂 **多相册** — 注册多个照片根目录，一次激活一个，快速切换；外置卷拔出时灰显、插回即恢复
- 🌗 **主题** — 亮 / 暗 / 跟随系统三态，暗色为暖褐「烛光」调，跟随系统深色模式联动
- 🏷 **标签 / 收藏 / 年份** — 三类筛选可叠加
- 🖼 **照片墙 + 灯箱** — 瀑布流缩略图（sharp 生成 400px webp），灯箱看原图，视频可拖进度条（`gallery-media://` 协议支持 Range）
- 🎬 **视频海报帧** — 视频自动截帧生成海报；解码失败自动落暖色占位图
- ✏️ **编辑** — 标题、日期、描述、标签行内编辑；自选封面照片
- 📥 **导入** — 表单上传、拖拽照片/视频进窗口即导入；一键导入旧版 `.settings.json` 数据目录（保留旧时间戳 id 与图注）
- 👁 **实时同步** — 监听相册目录，Finder 中增删照片实时反映；亦可手动重新扫描
- 🗑 **安全删除** — 照片与旅行目录一律移入废纸篓，可反悔
- ⌨️ **键盘导航** — 灯箱 ←/→ 切换、ESC 退出；标准 macOS 中文菜单（⌘C/⌘V 可用）

## 数据与文件

| 内容 | 位置 |
|---|---|
| 应用数据库 | `~/Library/Application Support/画廊/gallery.db` |
| 缩略图缓存 | `~/Library/Application Support/画廊/thumbnails/` |
| 照片文件 | **原地不动**，仅在注册的相册目录内 |

移除相册 / 清除应用数据都不会删除照片文件。

## 开发

```bash
npm install     # 安装依赖（better-sqlite3 / sharp 为 NAPI 预编译，无需手动 rebuild）
npm run dev     # 启动开发模式（HMR）
npm run typecheck
npm run build:mac   # 产出 release/画廊-<版本>-arm64.dmg
```

## 验收截图工具

```bash
# GALLERY_E2E=1 时按步骤文件驱动 UI 并截图到指定目录，最后自动退出
GALLERY_E2E=1 \
GALLERY_E2E_DIR=/tmp/gallery-e2e \
GALLERY_E2E_STEPS=steps.json \
GALLERY_E2E_ALBUM="/path/to/相册目录" \
npx electron .
```

## 架构

```
src/
├── main/          # 主进程：SQLite、扫描器、缩略图队列、协议、watcher
│   └── services/  # scanner / thumbnails / watcher
├── preload/       # contextBridge 类型化 window.api
├── renderer/      # React 18 + Tailwind v4（语义 token，零 dark: 前缀）
└── shared/        # 领域类型与 IPC 通道定义
```

渲染进程不直接触碰文件系统与数据库，一切经类型化 IPC；安全边界由 contextIsolation + 路径越界校验保证。

## License

MIT
