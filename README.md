# 画廊 - 旅行照片管理应用

一个用于管理旅游照片的 Web 应用，以时间线的形式展示你的旅行记忆。

## 功能特性

- 📅 **时间线视图** - 按时间倒序展示所有旅行
- 📸 **照片堆叠效果** - 鼠标悬停时照片散开展示（最多9张）
- 🎨 **照片墙** - 瀑布流布局，带有风吹动画效果
- 🎬 **视频支持** - 支持图片和视频预览播放，左右切换浏览
- ✏️ **编辑功能** - 编辑旅行标题、描述、日期和标签
- 💾 **文件系统存储** - 数据保存在本地文件系统的 `.settings.json` 文件中
- 🎭 **流畅动画** - 基于 Framer Motion 的精美动画效果
- 🔍 **筛选功能** - 支持标签、时间范围和收藏筛选
- ❤️ **收藏功能** - 支持收藏旅行并筛选查看
- ⌨️ **键盘导航** - 支持方向键切换和ESC退出
- 📱 **响应式设计** - 适配不同屏幕尺寸

## 开发

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 构建独立 HTML 文件

构建一个包含所有资源的独立 HTML 文件，可以直接在浏览器中打开运行：

```bash
npm run build
```

构建完成后，在 `dist/index.html` 文件就是完整的独立应用，包含：
- 所有 JavaScript 代码内联
- 所有 CSS 样式内联
- 所有资源文件内联
- 可以直接双击在浏览器中打开

**使用方法：**
1. 运行 `npm run build` 构建应用
2. 将 `dist/index.html` 复制到任意位置
3. 双击文件在浏览器中打开即可使用

## 技术栈

- React 18
- TypeScript
- Vite
- TailwindCSS
- Framer Motion
- React Router
- React DatePicker
- File System Access API
- IndexedDB

## 项目结构

```
src/
├── components/        # 组件
│   ├── PhotoStack.tsx       # 照片堆叠组件
│   ├── PhotoWall.tsx        # 照片墙组件
│   ├── TimelineItem.tsx     # 时间线项组件
│   ├── AddTripModal.tsx     # 添加旅行模态框
│   ├── FilterBar.tsx        # 筛选栏组件
│   └── SettingsModal.tsx    # 设置模态框
├── pages/            # 页面
│   ├── HomePage.tsx         # 主页
│   └── TripPage.tsx         # 旅行详情页
├── types.ts          # 类型定义
├── storage.ts        # 文件系统存储服务
├── App.tsx           # 应用入口
├── main.tsx          # React 入口
└── index.css         # 全局样式
```

## 使用说明

1. **设置存储目录** - 首次使用需要在设置中选择全局存储目录
2. **查看旅行** - 主页展示所有旅行的时间线
3. **添加旅行** - 点击时间线上的 "+" 按钮添加新旅行
4. **编辑旅行** - 点击旅行进入详情页，点击"编辑"按钮修改信息
5. **查看媒体** - 在详情页点击照片/视频可全屏查看，支持键盘切换
6. **筛选功能** - 使用标签、时间范围和收藏状态筛选旅行
7. **收藏旅行** - 点击爱心图标收藏喜欢的旅行

## 数据存储

- **配置信息** - 存储在浏览器 localStorage 和 IndexedDB 中
- **旅行数据** - 存储在选定目录下的各个旅行文件夹中
- **元数据文件** - 每个旅行目录包含 `.settings.json` 配置文件
- **媒体文件** - 照片和视频直接存储在旅行目录中

## 浏览器兼容性

需要支持以下现代浏览器 API：
- File System Access API
- IndexedDB
- ES2020+ 语法

推荐使用：
- Chrome 86+
- Edge 86+
- Safari 15.2+（部分功能受限）

## 设计特色

- 温暖复古的配色方案
- 流畅自然的动画过渡
- 直观的时间线导航
- 响应式布局设计
- 文件系统原生集成
