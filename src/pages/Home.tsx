import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/ui'
import { createHostedRoom, parseRoomInput } from '../lib/hostKeys'
import { profileStore } from '../lib/profile'
import { inbox } from '../lib/inbox'
import { DOWNLOADS, isNativeApp, navigate, toast } from '../lib/platform'
import { useEmitter } from '../lib/store'

export async function startMeeting(title?: string) {
  const id = await createHostedRoom()
  navigate(`r/${id}${title ? `?t=${encodeURIComponent(title)}` : ''}`)
  return id
}

export async function callFriend(code: string, name: string) {
  const title = `Call with ${name}`
  const id = await startMeeting(title)
  toast(`Ringing ${name}…`)
  const ok = await inbox.invite(code, id, title)
  if (!ok) toast(`${name} looks offline — send them the link`)
}

const QUICK = [
  ['Stand-up', 'mint'],
  ['1:1', 'pink'],
  ['Study group', 'butter'],
  ['Interview', 'blue'],
  ['Hangout', 'lilac'],
  ['Game night', 'peach'],
] as const

export function Home() {
  useEmitter(profileStore)
  useEmitter(inbox)
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState('')
  const name = profileStore.profile.name
  const friends = profileStore.friends.slice(0, 4)

  const join = () => {
    const id = parseRoomInput(code)
    if (!id) return toast('That code doesn’t look right — it’s like abc-defg-hjk')
    navigate(`r/${id}`)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div className="glow" style={{ top: -240, left: -200 }} />
      <div className="home-grid">
        <section className="home-main">
          <div>
            <h1 className="hero-title">
              {name ? <>Hey {name.split(' ')[0]}<span className="dot">.</span></> : <>Let’s meet<span className="dot">.</span></>}
            </h1>
            <p className="hero-sub">No sign-up. No time limit. Just a link.</p>
          </div>

          <div className="tiles">
            <button className="tile peach" onClick={() => startMeeting()}>
              <Icon name="video" size={34} />
              <span className="label">New meeting</span>
            </button>
            <button className="tile blue" onClick={() => setJoining((v) => !v)} aria-expanded={joining}>
              <Icon name="link" size={34} />
              <span className="label">Join</span>
            </button>
            <a className="tile green" href="#/friends">
              <Icon name="users" size={34} />
              <span className="label">Friends</span>
            </a>
            <button className="tile lilac" onClick={() => startMeeting('Presentation')}>
              <Icon name="screen" size={34} />
              <span className="label">Present</span>
            </button>
          </div>

          {joining && (
            <form
              className="input-row"
              style={{ animation: 'pop .35s var(--spring) both' }}
              onSubmit={(e) => {
                e.preventDefault()
                join()
              }}
            >
              <label htmlFor="join-code" className="sr">Meeting code or link</label>
              <input id="join-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste a link or code" />
              <button className="btn cream" type="submit">Join <Icon name="arrow" size={18} /></button>
            </form>
          )}

          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Quick rooms</div>
            <div className="chips">
              {QUICK.map(([label, tone]) => (
                <button key={label} className={`chip ${tone}`} onClick={() => startMeeting(label)}>{label}</button>
              ))}
            </div>
          </div>
        </section>

        <aside className="home-side">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 className="serif" style={{ fontSize: 34, lineHeight: 1 }}>Friends</h2>
              <a href="#/friends" className="btn sm ghost">See all</a>
            </div>
            {friends.length === 0 ? (
              <div style={{ marginTop: 16 }}>
                <p className="muted" style={{ margin: '0 0 14px' }}>Add friends to call them in one tap.</p>
                <a href="#/friends" className="btn sm cream"><Icon name="userPlus" size={18} /> Add a friend</a>
              </div>
            ) : (
              <div className="list" style={{ marginTop: 14 }}>
                {friends.map((f) => (
                  <div key={f.code} className="friend">
                    <span style={{ position: 'relative' }}>
                      <Avatar name={f.name} src={f.avatar} seed={f.code} size={44} />
                      {inbox.online.get(f.code) && <span className="online-dot" style={{ background: '#7fd4a8' }} />}
                    </span>
                    <div className="info"><b>{f.name}</b></div>
                    <button className="icon-btn sm mint" aria-label={`Call ${f.name}`} onClick={() => callFriend(f.code, f.name)}>
                      <Icon name="video" size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!isNativeApp && <DownloadCard />}
        </aside>
      </div>

      <div className="features">
        <Feature tone="mint" icon="lock" title="Private by design" text="Video goes straight between people, encrypted. No server in the middle." />
        <Feature tone="peach" icon="bolt" title="No time limit" text="Talk for 5 minutes or 5 hours. Free, forever." />
        <Feature tone="lilac" icon="screen" title="Buttery screen share" text="Up to 60 fps, with the bandwidth handed to your screen." />
        <Feature tone="blue" icon="shield" title="You’re the host" text="Waiting room, mute, remove, and permission for sharing and recording." />
      </div>
    </div>
  )
}

function Feature({ tone, icon, title, text }: { tone: string; icon: string; title: string; text: string }) {
  return (
    <div className="feature">
      <span className={`ic ${tone}`}><Icon name={icon} size={20} /></span>
      <div><b>{title}</b><small>{text}</small></div>
    </div>
  )
}

export function DownloadCard() {
  return (
    <div className="card">
      <h2 className="serif" style={{ fontSize: 34, lineHeight: 1 }}>Get the app</h2>
      <p className="muted" style={{ margin: '8px 0 16px' }}>Same meetings, on your desktop and phone.</p>
      <div className="download-row">
        <a className="dl" href={DOWNLOADS.windows}>
          <span className="avatar blue" style={{ width: 40, height: 40 }}><Icon name="windows" size={20} /></span>
          <span><b>Windows</b><small>.exe installer</small></span>
        </a>
        <a className="dl" href={DOWNLOADS.android}>
          <span className="avatar green" style={{ width: 40, height: 40 }}><Icon name="android" size={20} /></span>
          <span><b>Android</b><small>.apk</small></span>
        </a>
        <a className="dl" href={DOWNLOADS.linux}>
          <span className="avatar butter" style={{ width: 40, height: 40 }}><Icon name="linux" size={20} /></span>
          <span><b>Linux</b><small>AppImage</small></span>
        </a>
      </div>
    </div>
  )
}
