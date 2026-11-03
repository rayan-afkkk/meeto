import { Emitter } from './store'

export const REPO = 'rayan-afkkk/meeto'
export const WEB_URL = 'https://meetop2p.vercel.app/'
const DL = `https://github.com/${REPO}/releases/latest/download`
export const DOWNLOADS = {
  windows: `${DL}/Meeto-Setup.exe`,
  android: `${DL}/Meeto.apk`,
  linux: `${DL}/Meeto.AppImage`,
}

export type DesktopSource = { id: string; name: string; thumbnail: string }
type DesktopBridge = {
  onPickSource: (cb: (sources: DesktopSource[]) => void) => void
  pickSource: (id: string | null) => void
}

declare global {
  interface Window {
    meetoDesktop?: DesktopBridge
    Capacitor?: { isNativePlatform?: () => boolean }
  }
}

export const isDesktopApp = typeof window !== 'undefined' && !!window.meetoDesktop
export const isAndroidApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
export const isNativeApp = isDesktopApp || isAndroidApp
export const canShareScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !isAndroidApp

/** Public link for a room. Native apps link to the website so anyone can open it. */
export function roomLink(roomId: string) {
  const base = location.protocol.startsWith('http') && !isAndroidApp ? location.href.split('#')[0] : WEB_URL
  return `${base}#/r/${roomId}`
}

/* ---------- Toasts ---------- */
export type Toast = { id: number; text: string; action?: { label: string; run: () => void }; ttl: number }

class ToastStore extends Emitter {
  items: Toast[] = []
  private n = 0
  show(text: string, action?: Toast['action'], ttl = 4200) {
    const id = ++this.n
    this.items = [...this.items.slice(-3), { id, text, action, ttl }]
    this.emit()
    setTimeout(() => this.dismiss(id), ttl)
    return id
  }
  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id)
    this.emit()
  }
}
export const toasts = new ToastStore()
export const toast = (text: string, action?: Toast['action'], ttl?: number) => toasts.show(text, action, ttl)

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied')
  } catch {
    toast(text)
  }
}

/** Shared Trystero config: public Nostr relays do the introductions; media flows peer-to-peer. */
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
}

/**
 * Optional custom relays (self-hosting, or networks that block the public ones).
 * Set in Profile, or with ?relay=wss://your.relay in the URL.
 */
export function customRelays(): string[] {
  try {
    const fromUrl = new URLSearchParams(location.search).get('relay')
    if (fromUrl) localStorage.setItem('meeto.relays', fromUrl)
    return (localStorage.getItem('meeto.relays') ?? '')
      .split(/[\s,]+/)
      .filter((u) => /^wss?:\/\//.test(u))
  } catch {
    return []
  }
}

export function p2pConfig(appId: string) {
  const urls = customRelays()
  return {
    appId,
    rtcConfig: RTC_CONFIG,
    ...(urls.length ? { relayConfig: { urls, redundancy: urls.length } } : {}),
  }
}

export function navigate(path: string) {
  location.hash = `#/${path}`
}
