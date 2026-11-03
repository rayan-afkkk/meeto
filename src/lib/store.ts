import { useSyncExternalStore } from 'react'

/** Tiny change notifier: classes extend this and call emit() when their state changes. */
export class Emitter {
  private listeners = new Set<() => void>()
  private version = 0
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version
  emit() {
    this.version++
    this.listeners.forEach((fn) => fn())
  }
}

export function useEmitter(e: Emitter | null | undefined) {
  const fallback = nullEmitter
  const src = e ?? fallback
  useSyncExternalStore(src.subscribe, src.getVersion)
}
const nullEmitter = new Emitter()

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked */
  }
}
