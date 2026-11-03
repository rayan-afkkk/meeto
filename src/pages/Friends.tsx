import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/ui'
import { profileStore } from '../lib/profile'
import { inbox } from '../lib/inbox'
import { copyText, toast } from '../lib/platform'
import { useEmitter } from '../lib/store'
import { callFriend } from './Home'

export function Friends() {
  useEmitter(profileStore)
  useEmitter(inbox)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const { friends, requests, profile } = profileStore

  useEffect(() => {
    if (profileStore.friends.length) void inbox.refreshOnline()
  }, [])

  const add = async () => {
    const c = code.trim().toLowerCase()
    if (!/^[a-z0-9]{6,16}$/.test(c)) return toast('Friend codes look like k7m2qpx9')
    if (c === profile.code) return toast('That’s your own code')
    if (profileStore.isFriend(c)) return toast('Already friends')
    setSending(true)
    const ok = await inbox.sendRequest(c)
    setSending(false)
    setCode('')
    toast(ok ? 'Request sent' : 'They’re offline right now — try again when they’re on Meeto')
  }

  const sorted = [...friends].sort((a, b) => Number(!!inbox.online.get(b.code)) - Number(!!inbox.online.get(a.code)))

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
      <section style={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <h1 className="hero-title" style={{ fontSize: 'clamp(56px, 8vw, 96px)' }}>Friends<span className="dot">.</span></h1>
          <span className="spacer" />
          {friends.length > 0 && (
            <button className="btn sm" onClick={() => inbox.refreshOnline()} disabled={inbox.checking}>
              <Icon name="refresh" size={16} /> {inbox.checking ? 'Checking…' : 'Who’s online'}
            </button>
          )}
        </div>

        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <label htmlFor="fcode" className="sr">Friend code</label>
          <input id="fcode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter a friend code" autoComplete="off" />
          <button className="btn cream" type="submit" disabled={sending}>
            <Icon name="userPlus" size={18} /> {sending ? 'Sending…' : 'Add'}
          </button>
        </form>

        {requests.length > 0 && (
          <div className="list">
            <div className="eyebrow">Requests</div>
            {requests.map((r) => (
              <div className="request" key={r.code} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Avatar name={r.name} src={r.avatar} seed={r.code} size={44} />
                <b style={{ flex: 1 }}>{r.name}</b>
                <button className="btn sm dark" onClick={() => profileStore.dropRequest(r.code)}>Ignore</button>
                <button className="btn sm accent" onClick={() => inbox.accept(r.code)}>Accept</button>
              </div>
            ))}
          </div>
        )}

        {friends.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div className="chips" style={{ justifyContent: 'center', marginBottom: 22 }}>
              <span className="chip mint">Add</span><span className="chip lilac">Call</span><span className="chip peach">Hang out</span>
            </div>
            <h2 className="serif" style={{ fontSize: 40 }}>No friends yet</h2>
            <p className="muted">Swap friend codes, or tap “Add friend” on someone in a call.</p>
          </div>
        ) : (
          <div className="list">
            {sorted.map((f) => {
              const online = inbox.online.get(f.code)
              return (
                <div className="friend" key={f.code}>
                  <span style={{ position: 'relative' }}>
                    <Avatar name={f.name} src={f.avatar} seed={f.code} size={52} />
                    <span className="online-dot" style={{ background: online ? '#7fd4a8' : '#5a554e' }} />
                  </span>
                  <div className="info">
                    <b>{f.name}</b>
                    <small>{online ? 'Online' : online === false ? 'Offline' : 'Tap refresh to check'}</small>
                  </div>
                  <button className="icon-btn sm" aria-label={`Remove ${f.name}`} onClick={() => profileStore.removeFriend(f.code)}>
                    <Icon name="x" size={16} />
                  </button>
                  <button className="btn sm accent" onClick={() => callFriend(f.code, f.name)}>
                    <Icon name="video" size={18} /> Call
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <aside style={{ flex: '1 1 300px', minWidth: 0, paddingTop: 8 }}>
        <div className="card butter" style={{ border: 0 }}>
          <div className="eyebrow" style={{ color: 'inherit', opacity: 0.8 }}>Your code</div>
          <div className="code serif" style={{ fontSize: 48, lineHeight: 1.1, margin: '8px 0 16px' }}>{profile.code}</div>
          <button className="btn sm" style={{ background: '#241a00', color: 'var(--butter)', border: 0 }} onClick={() => copyText(profile.code)}>
            <Icon name="copy" size={16} /> Copy code
          </button>
        </div>
      </aside>
    </div>
  )
}
