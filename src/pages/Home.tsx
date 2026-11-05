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

export function Home() {
  useEmitter(profileStore)
  useEmitter(inbox)
  const [code, setCode] = useState('')
  const [starting, setStarting] = useState(false)
  const name = profileStore.profile.name
  const friends = profileStore.friends.slice(0, 4)

  const join = () => {
    const id = parseRoomInput(code)
    if (!id) return toast('Type the code you were sent, like kmpq4827')
    navigate(`r/${id}`)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div className="glow" style={{ top: -240, left: -200 }} />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <h1 className="hero-title">
            {name ? <>Hey {name.split(' ')[0]}<span className="dot">.</span></> : <>Let’s meet<span className="dot">.</span></>}
          </h1>
          <p className="hero-sub">Free video calls. No sign-up, no time limit.</p>
        </div>

        <div className="start-grid">
          <button
            className="tile peach big-tile"
            disabled={starting}
            onClick={async () => {
              setStarting(true)
              await startMeeting()
            }}
          >
            <Icon name="video" size={40} />
            <span>
              <span className="label">Start a meeting</span>
              <small>You get a code to share</small>
            </span>
          </button>

          <form
            className="tile blue big-tile"
            onSubmit={(e) => {
              e.preventDefault()
              join()
            }}
          >
            <Icon name="users" size={40} />
            <span style={{ width: '100%', position: 'relative', zIndex: 1 }}>
              <label htmlFor="join-code" className="label" style={{ display: 'block' }}>Join with a code</label>
              <span className="join-box">
                <input
                  id="join-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="kmpq4827"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={40}
                />
                <button className="btn cream" type="submit" disabled={!code.trim()}>Join</button>
              </span>
            </span>
          </form>
        </div>

        <div className="steps">
          <div><b>1</b><span>Start a meeting</span></div>
          <div><b>2</b><span>Send the code to friends</span></div>
          <div><b>3</b><span>They type it in and join</span></div>
        </div>
      </section>

      <div className="home-grid" style={{ marginTop: 32 }}>
        <div className="card" style={{ flex: '1 1 320px', minWidth: 0 }}>
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
        {!isNativeApp && <div style={{ flex: '1 1 320px', minWidth: 0 }}><DownloadCard /></div>}
      </div>

      <div className="features">
        <Feature tone="mint" icon="lock" title="Private" text="Video goes straight between people, encrypted." />
        <Feature tone="peach" icon="bolt" title="No time limit" text="Talk as long as you want. Free, forever." />
        <Feature tone="lilac" icon="screen" title="Smooth screen share" text="Up to 60 fps." />
        <Feature tone="blue" icon="shield" title="You’re the host" text="Waiting room, mute, remove, and who can share or record." />
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
