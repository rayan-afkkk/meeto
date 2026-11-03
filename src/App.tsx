import { useEffect, useState, type ReactNode } from 'react'
import { Home } from './pages/Home'
import { RoomPage } from './pages/Room'
import { Friends } from './pages/Friends'
import { ProfilePage } from './pages/Profile'
import { Avatar, Modal, Toasts } from './components/ui'
import { Icon } from './components/Icon'
import { inbox } from './lib/inbox'
import { profileStore } from './lib/profile'
import { useEmitter } from './lib/store'
import { prettyRoomId } from './lib/hostKeys'
import { navigate } from './lib/platform'

function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, '')
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => {
      setRoute(read())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function App() {
  const route = useRoute()
  useEffect(() => {
    inbox.start()
  }, [])

  const [path, query = ''] = route.split('?')
  const parts = path.split('/')
  let page: ReactNode
  if (parts[0] === 'r' && parts[1]) {
    const title = new URLSearchParams(query).get('t') ?? undefined
    page = <RoomPage key={parts[1]} roomId={parts[1].replace(/-/g, '')} title={title} />
  } else if (parts[0] === 'friends') {
    page = <Shell tab="friends"><Friends /></Shell>
  } else if (parts[0] === 'profile') {
    page = <Shell tab="profile"><ProfilePage /></Shell>
  } else {
    page = <Shell tab="home"><Home /></Shell>
  }

  return (
    <>
      {page}
      <IncomingCall />
      <Toasts />
    </>
  )
}

function Shell({ tab, children }: { tab: 'home' | 'friends' | 'profile'; children: ReactNode }) {
  useEmitter(profileStore)
  const p = profileStore.profile
  const pending = profileStore.requests.length
  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="wordmark" aria-label="Meeto home">meeto<span className="dot">.</span></a>
        <nav className="seg" aria-label="Main">
          <a href="#/" className={tab === 'home' ? 'on' : ''}>Home</a>
          <a href="#/friends" className={tab === 'friends' ? 'on' : ''}>
            Friends{pending > 0 && <span className="tag" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{pending}</span>}
          </a>
          <a href="#/profile" className={tab === 'profile' ? 'on' : ''}>Profile</a>
        </nav>
        <a href="#/profile" aria-label="Your profile" style={{ textDecoration: 'none' }}>
          <Avatar name={p.name || 'You'} src={p.avatar} seed={p.code} size={46} />
        </a>
      </header>
      <main className="page">{children}</main>
      <nav className="tabbar" aria-label="Tabs">
        <a href="#/" className={tab === 'home' ? 'on' : ''}><Icon name="home" />Home</a>
        <a href="#/friends" className={tab === 'friends' ? 'on' : ''}><Icon name="users" />Friends{pending ? ` (${pending})` : ''}</a>
        <a href="#/profile" className={tab === 'profile' ? 'on' : ''}><Icon name="user" />Profile</a>
      </nav>
    </div>
  )
}

function IncomingCall() {
  useEmitter(inbox)
  const call = inbox.incoming
  useEffect(() => {
    if (!call) return
    const t = setTimeout(() => inbox.clearIncoming(), 45000)
    return () => clearTimeout(t)
  }, [call])
  if (!call) return null
  return (
    <Modal label="Incoming call" onClose={() => inbox.clearIncoming()}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center', padding: '10px 0' }}>
        <div style={{ animation: 'pulse 1.4s infinite' }}>
          <Avatar name={call.from.name} src={call.from.avatar} seed={call.from.code} size={110} />
        </div>
        <h2 style={{ margin: 0 }}>{call.from.name} is calling</h2>
        <p className="muted" style={{ margin: 0 }}>{call.title} · {prettyRoomId(call.roomId)}</p>
        <div className="row" style={{ width: '100%' }}>
          <button className="btn block" onClick={() => inbox.clearIncoming()}>Decline</button>
          <button
            className="btn accent block"
            onClick={() => {
              inbox.clearIncoming()
              navigate(`r/${call.roomId}?t=${encodeURIComponent(call.title)}`)
            }}
          >
            <Icon name="video" /> Join
          </button>
        </div>
      </div>
    </Modal>
  )
}
