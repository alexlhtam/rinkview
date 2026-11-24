export interface History<T> {
  past: T[]
  current: T
  future: T[]
}

export function historyOf<T>(current: T): History<T> {
  return { past: [], current, future: [] }
}

export function push<T>(history: History<T>, current: T): History<T> {
  if (history.current === current) return history
  return { past: [...history.past, history.current], current, future: [] }
}

export function undo<T>(history: History<T>): History<T> {
  if (!history.past.length) return history
  return { past: history.past.slice(0, -1), current: history.past.at(-1)!, future: [history.current, ...history.future] }
}

export function redo<T>(history: History<T>): History<T> {
  if (!history.future.length) return history
  return { past: [...history.past, history.current], current: history.future[0], future: history.future.slice(1) }
}
