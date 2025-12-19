# 画廊 - 旅行照片管理应用

一个用于管理旅游照片的 Web 应用，以时间线的形式展示你的旅行记忆。

## 功能特性

- 📅 **时间线视图** - 按时间倒序展示所有旅行
- 📸 **照片堆叠效果** - 鼠标悬停时照片散开展示（最多9张）
- 🎨 **照片墙** - 瀑布流布局，带有风吹动画效果
- ✏️ **编辑功能** - 编辑旅行标题、描述、日期和标签
- 💾 **本地存储** - 数据保存在浏览器本地
- 🎭 **流畅动画** - 基于 Framer Motion 的精美动画效果

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

## 技术栈

- React 18
- TypeScript
- Vite
- TailwindCSS
- Framer Motion
- React Router

## 项目结构

```
src/
├── components/        # 组件
│   ├── PhotoStack.tsx       # 照片堆叠组件
│   ├── PhotoWall.tsx        # 照片墙组件
│   ├── TimelineItem.tsx     # 时间线项组件
│   └── AddTripModal.tsx     # 添加旅行模态框
├── pages/            # 页面
│   ├── HomePage.tsx         # 主页
│   └── TripPage.tsx         # 旅行详情页
├── types.ts          # 类型定义
├── storage.ts        # 本地存储服务
├── App.tsx           # 应用入口
├── main.tsx          # React 入口
└── index.css         # 全局样式
```

## 使用说明

1. **查看旅行** - 主页展示所有旅行的时间线
2. **添加旅行** - 点击时间线上的 "+" 按钮添加新旅行
3. **编辑旅行** - 点击旅行进入详情页，点击"编辑"按钮修改信息
4. **查看照片** - 在详情页点击照片可全屏查看

## 设计特色

- 温暖复古的配色方案
- 流畅自然的动画过渡
- 直观的时间线导航
- 响应式布局设计
