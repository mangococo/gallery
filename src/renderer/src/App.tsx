import React from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppProvider, useApp } from './lib/store'
import Sidebar from './components/Sidebar'
import HomePage from './pages/HomePage'
import TripPage from './pages/TripPage'
import TrashPage from './pages/TrashPage'
import CommandPalette from './components/CommandPalette'
import DropImportLayer from './components/DropImport'
import { FeedbackHost } from './components/feedback'
import ContextMenuHost from './components/ContextMenu'

/** 应用外壳：左侧常驻侧栏 + 右侧内容区（方案 §5.1） */
function Shell() {
  const { ready } = useApp()

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <span className="font-display text-2xl text-primary animate-pulse">画廊</span>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/trip/:id" element={<TripPage />} />
          <Route path="/trash" element={<TrashPage />} />
        </Routes>
      </main>
      {/* 窗口级拖拽导入（TripPage 内部拖拽会 stopPropagation） */}
      <DropImportLayer />
      {/* ⌘K 搜索面板 */}
      <CommandPalette />
      {/* toast / 确认弹窗宿主 */}
      <FeedbackHost />
      {/* 右键上下文菜单宿主（在反馈层之下、页面内容之上） */}
      <ContextMenuHost />
    </div>
  )
}

const App: React.FC = () => {
  return (
    <AppProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </AppProvider>
  )
}

export default App
