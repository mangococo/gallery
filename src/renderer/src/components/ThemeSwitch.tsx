import React from 'react'
import { useApp } from '../lib/store'
import type { ThemeMode } from '../types'

const OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '亮' },
  { value: 'dark', label: '暗' },
  { value: 'system', label: '系统' },
]

/** 侧栏底部三态主题分段控件 */
const ThemeSwitch: React.FC = () => {
  const { theme, setTheme } = useApp()

  return (
    <div
      role="radiogroup"
      aria-label="主题"
      className="flex bg-surface-2 rounded-lg p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => void setTheme(opt.value)}
            className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
              active
                ? 'bg-surface text-primary shadow-sm font-medium'
                : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default ThemeSwitch
