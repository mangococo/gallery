import React from 'react'
import { api } from '../lib/api'
import { TagIcon, XIcon } from './icons'

interface TagInputProps {
  /** 当前旅行已选标签（受控） */
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  inputClassName?: string
  pillClassName?: string
  /** 下拉最多展示的候选数量 */
  maxSuggestions?: number
}

const parseTags = (text: string): string[] => [
  ...new Set(text.split(',').map((t) => t.trim()).filter((t) => t)),
]

const sameTags = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i])

/**
 * 标签输入框：保留逗号分隔的书写习惯，聚焦/输入时下拉列出全部已有标签
 * （排除已选、按当前片段联想、常用在前），点击或回车选中。
 */
const TagInput: React.FC<TagInputProps> = ({
  value,
  onChange,
  placeholder = '输入或选择标签，用逗号分隔',
  inputClassName = 'w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all',
  pillClassName = 'px-3 py-1 bg-primary-soft text-primary-soft-ink text-sm rounded-full',
  maxSuggestions = 8,
}) => {
  const [text, setText] = React.useState(value.join(', '))
  const [known, setKnown] = React.useState<string[]>([])
  const [open, setOpen] = React.useState(false)
  const [highlight, setHighlight] = React.useState(-1)
  const wrapRef = React.useRef<HTMLDivElement>(null)

  // 外部重置（如取消编辑）且与本地文本不一致时，回写文本
  React.useEffect(() => {
    if (!sameTags(parseTags(text), value)) setText(value.join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // 点击组件外关闭下拉
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const selectedSet = React.useMemo(() => new Set(value.map((t) => t.toLowerCase())), [value])

  const activeSegment = text.split(',').pop()?.trim() ?? ''
  const suggestions = React.useMemo(() => {
    const q = activeSegment.toLowerCase()
    return known
      .filter((t) => !selectedSet.has(t.toLowerCase()))
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, maxSuggestions)
  }, [known, activeSegment, selectedSet, maxSuggestions])

  const openDropdown = () => {
    // 每次展开都取最新标签（可能刚在其他旅行里新增）
    api.listTags().then(setKnown).catch(() => {})
    setOpen(true)
    setHighlight(-1)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setText(next)
    setOpen(true)
    setHighlight(next.split(',').pop()?.trim() ? 0 : -1)
    onChange(parseTags(next))
  }

  /** 用候选标签替换当前正在输入的片段，保留前缀便于连续追加 */
  const choose = (tag: string) => {
    const comma = text.lastIndexOf(',')
    const nextText = comma >= 0 ? `${text.slice(0, comma + 1)} ${tag}` : tag
    setText(nextText)
    onChange(parseTags(nextText))
    setHighlight(-1)
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // 只在下拉真正打开时消费 Esc（关下拉）；关着时放行给外层弹层（编辑弹窗整体关闭）
      if (open) {
        e.stopPropagation()
        e.preventDefault()
        setOpen(false)
      }
      return
    }
    if (!open) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlight((h) => Math.min(h + 1, suggestions.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlight((h) => Math.max(h - 1, -1))
        break
      case 'Enter':
        // 下拉展开期间拦截回车，避免误触发表单提交
        e.preventDefault()
        if (highlight >= 0 && suggestions[highlight]) choose(suggestions[highlight])
        else setOpen(false)
        break
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={text}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={openDropdown}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        className={inputClassName}
      />
      {open && suggestions.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-20 mt-1.5 py-1.5 bg-surface border border-line rounded-xl shadow-lg max-h-60 overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((tag, i) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => choose(tag)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full flex items-center gap-2 text-left px-4 py-2 text-sm transition-colors ${
                  i === highlight ? 'bg-primary-soft text-primary-soft-ink' : 'text-ink-2'
                }`}
              >
                <TagIcon size={12} className="shrink-0 opacity-60" />
                <span>#{tag}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {value.map((tag) => (
            <span key={tag} className={`inline-flex items-center gap-1 ${pillClassName}`}>
              <span>#{tag}</span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="opacity-50 hover:opacity-100 transition-opacity"
                title={`移除标签 ${tag}`}
              >
                <XIcon size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default TagInput
