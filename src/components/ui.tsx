import type { ReactNode } from 'react'
import { pastelFor } from '../lib/profile'
import { toasts } from '../lib/platform'
import { useEmitter } from '../lib/store'

export function Avatar({ name, src, seed, size = 44 }: { name: string; src?: string | null; seed: string; size?: number }) {
  const tone = pastelFor(seed)
  return (
    <span className={`avatar ${tone}`} style={{ width: size, height: size, fontSize: size * 0.48 }}>
      {src ? <img src={src} alt="" /> : (name.trim()[0] || '?').toUpperCase()}
    </span>
  )
}

export function Toasts() {
  useEmitter(toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.items.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="btn accent"
              onClick={() => {
                t.action!.run()
                toasts.dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  )
}

export function Setting({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="txt">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  )
}

export function Modal({ children, onClose, label }: { children: ReactNode; onClose?: () => void; label: string }) {
  return (
    <div className="modal-back" onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
