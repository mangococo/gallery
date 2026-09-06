import React from 'react'

/**
 * ESC 处理权栈：多层弹层叠加时（灯箱上开图注编辑、灯箱上弹确认框、
 * 多选态上开右键菜单……），Esc 只应作用于最上层，而不是把底下各层全部穿透关掉。
 *
 * 每个 ESC 消费者挂载时 claim 一个 token、卸载时 release，处理按键前用
 * isEscTop 判断自己是否栈顶。认领顺序 = 打开顺序 = 视觉叠放顺序。
 * （实现放在 effect 里：StrictMode 的卸载重挂会先 release 再重新 claim，token 可重入。）
 */

const stack: symbol[] = []

export function claimEsc(): symbol {
  const token = Symbol('esc')
  stack.push(token)
  return token
}

export function releaseEsc(token: symbol): void {
  const i = stack.lastIndexOf(token)
  if (i >= 0) stack.splice(i, 1)
}

export function isEscTop(token: symbol | null): boolean {
  return token !== null && stack.length > 0 && stack[stack.length - 1] === token
}

/**
 * 组件级的 ESC 认领：挂载（或 active 变 true）时入栈，卸载/失活时出栈。
 * 返回 ref 里存当前 token，键盘回调里 isEscTop(ref.current) 判定。
 */
export function useEscClaim(active = true): React.RefObject<symbol | null> {
  const ref = React.useRef<symbol | null>(null)
  React.useEffect(() => {
    if (!active) return
    const token = claimEsc()
    ref.current = token
    return () => {
      releaseEsc(token)
      if (ref.current === token) ref.current = null
    }
  }, [active])
  return ref
}
