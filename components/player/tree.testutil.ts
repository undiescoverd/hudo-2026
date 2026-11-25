/**
 * Test helper: expands function components to plain elements (no DOM needed) so
 * tests can find buttons and call their real onClick handlers.
 */
import type { ReactElement, ReactNode } from 'react'

type AnyEl = ReactElement<{ children?: ReactNode; [k: string]: unknown }>

export function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand)
  if (node === null || typeof node !== 'object') return node
  const el = node as AnyEl
  if (typeof el.type === 'function') {
    return expand((el.type as (p: unknown) => ReactNode)(el.props))
  }
  return { ...el, props: { ...el.props, children: expand(el.props.children) } }
}

export function findAll(node: ReactNode, pred: (el: AnyEl) => boolean, out: AnyEl[] = []): AnyEl[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, pred, out))
  else if (node && typeof node === 'object') {
    const el = node as AnyEl
    if (pred(el)) out.push(el)
    findAll(el.props.children, pred, out)
  }
  return out
}

export function textOf(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node && typeof node === 'object') return textOf((node as AnyEl).props.children)
  return ''
}
