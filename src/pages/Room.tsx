import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { Avatar, Modal, Setting, Switch } from '../components/ui'
import { Meeting, type Peer, type Perms } from '../lib/meeting'
import { getLocalMedia, isVideoBlack, LevelMeter, listDevices, type DeviceChoice } from '../lib/media'
import { pastelFor, profileStore } from '../lib/profile'
import { isRoomId, prettyRoomId } from '../lib/hostKeys'
import { canShareScreen, isDesktopApp, navigate, toast, type DesktopSource } from '../lib/platform'
import { readJSON, useEmitter, writeJSON } from '../lib/store'
import { AvatarPicker } from './Profile'

/* =================================================================== */
/*  Page: lobby → meeting → end                                          */
/* =================================================================== */

export function RoomPage({ roomId, title }: { roomId: string; title?: string }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [rejoinKey, setRejoinKey] = useState(0)

  useEffect(() => () => void meeting?.leave(), [meeting])

  if (!isRoomId(roomId)) {
    return (
      <div className="shell"><div className="center"><div>
        <h1>Hmm<span className="dot">.</span></h1>
        <p>That meeting link doesn’t look right.</p>
        <a className="btn cream" href="#/">Back home</a>
      </div></div></div>
    )
  }
  if (!meeting) {
    return <Lobby key={rejoinKey} roomId={roomId} title={title} onJoin={setMeeting} />
  }
  return (
    <MeetingView
      meeting={meeting}
      onRejoin={() => {
        setMeeting(null)
        setRejoinKey((k) => k + 1)
      }}
    />
  )
}

function copyCode(roomId: string) {
  const code = prettyRoomId(roomId)
  navigator.clipboard?.writeText(code).then(
    () => toast(`Code ${code} copied — send it to friends`),
    () => toast(`Meeting code: ${code}`),
  ) ?? toast(`Meeting code: ${code}`)
}

/* =================================================================== */
/*  Lobby                                                               */
/* =================================================================== */

function Lobby({ roomId, title, onJoin }: { roomId: string; title?: string; onJoin: (m: Meeting) => void }) {
  useEmitter(profileStore)
  const p = profileStore.profile
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(!p.dataSaver)
  const [name, setName] = useState(p.name)
  const [level, setLevel] = useState(0)
  const [joining, setJoining] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const handedOff = useRef(false)

  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] })
  const [choice, setChoice] = useState<DeviceChoice>(() => readJSON('meeto.devices', {}))
  const [attempt, setAttempt] = useState(0)
  const [black, setBlack] = useState(false)
  const [showDevices, setShowDevices] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  // (re)start camera + mic whenever the chosen devices change or the user taps Try again
  useEffect(() => {
    let alive = true
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
    setBlack(false)
    getLocalMedia(p.dataSaver, choice).then(async (r) => {
      if (!alive) return r.stream.getTracks().forEach((t) => t.stop())
      streamRef.current = r.stream
      setStream(r.stream)
      setError(r.error)
      setDevices(await listDevices()) // labels only appear after permission is granted
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, attempt])

  // stop the camera if we leave the lobby without joining
  useEffect(() => () => {
    if (!handedOff.current) streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (v && stream) {
      if (v.srcObject !== stream) v.srcObject = stream
      v.play().catch(() => {})
    }
    if (!stream?.getAudioTracks().length) return
    const meter = new LevelMeter()
    meter.track('me', stream)
    const t = setInterval(() => setLevel(meter.level('me')), 90)
    return () => {
      clearInterval(t)
      meter.close()
    }
  }, [stream, cam])

  // a camera that is "on" but only sends black (privacy shutter, idle virtual camera, driver issue)
  useEffect(() => {
    if (!stream || !cam || !stream.getVideoTracks().length) return setBlack(false)
    let blackFor = 0
    const t = setInterval(() => {
      const v = videoRef.current
      if (!v) return
      blackFor = isVideoBlack(v) ? blackFor + 1 : 0
      setBlack(blackFor >= 3)
    }, 1000)
    return () => clearInterval(t)
  }, [stream, cam])

  const pickDevice = (patch: DeviceChoice) => {
    const next = { ...choice, ...patch }
    writeJSON('meeto.devices', next)
    setChoice(next)
  }

  useEffect(() => {
    stream?.getAudioTracks().forEach((t) => (t.enabled = mic))
    stream?.getVideoTracks().forEach((t) => (t.enabled = cam))
  }, [stream, mic, cam])

  const hasVideo = !!stream?.getVideoTracks().length
  const hasAudio = !!stream?.getAudioTracks().length

  const join = async () => {
    const n = name.trim()
    if (!n) return toast('Add your name first')
    if (!stream) return
    profileStore.update({ name: n })
    setJoining(true)
    handedOff.current = true
    const m = new Meeting(roomId, stream, { mic, cam, title })
    await m.join()
    onJoin(m)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="wordmark">meeto<span className="dot">.</span></a>
        <button className="pill" onClick={() => copyCode(roomId)} style={{ cursor: 'pointer' }}>
          <Icon name="copy" size={14} /> {prettyRoomId(roomId)}
        </button>
      </header>
      <main className="page">
        <div className="lobby">
          <section className={`lobby-preview ${pastelFor(p.code)}`}>
            {hasVideo && cam ? (
              <video ref={videoRef} autoPlay playsInline muted />
            ) : (
              <Avatar name={name || 'You'} src={p.avatar} seed={p.code} size={150} />
            )}
            {!stream && <div className="spinner" style={{ position: 'absolute' }} />}
            {hasAudio && (
              <div className="meter" aria-hidden="true">
                {[0.08, 0.2, 0.35, 0.5, 0.7].map((th, i) => (
                  <i key={i} style={{ height: 6 + i * 4, background: mic && level > th ? '#9fd8b8' : undefined }} />
                ))}
              </div>
            )}
            <div className="preview-dock">
              <button className={`icon-btn ${mic ? '' : 'off'}`} aria-label={mic ? 'Mute' : 'Unmute'} onClick={() => setMic(!mic)} disabled={!hasAudio}>
                <Icon name={mic ? 'mic' : 'micOff'} />
              </button>
              <button className={`icon-btn ${cam ? '' : 'off'}`} aria-label={cam ? 'Camera off' : 'Camera on'} onClick={() => setCam(!cam)} disabled={!hasVideo}>
                <Icon name={cam ? 'video' : 'videoOff'} />
              </button>
            </div>
          </section>

          <section className="lobby-side">
            <div>
              <h1 className="hero-title" style={{ fontSize: 'clamp(56px, 7vw, 84px)' }}>Ready<span className="dot">?</span></h1>
              {title && <p className="muted" style={{ fontSize: 17, margin: '10px 0 0' }}>{title}</p>}
            </div>
            <button className="code-card" onClick={() => copyCode(roomId)} aria-label={`Meeting code ${prettyRoomId(roomId)}, tap to copy`}>
              <span>
                <small>Meeting code</small>
                <b className="code">{prettyRoomId(roomId)}</b>
              </span>
              <span className="code-copy"><Icon name="copy" size={18} /> Copy</span>
            </button>
            <div className="row" style={{ gap: 16 }}>
              <AvatarPicker size={64} />
              <div style={{ flex: 1 }}>
                <label htmlFor="lname" className="sr">Your name</label>
                <input
                  id="lname"
                  className="field"
                  value={name}
                  maxLength={40}
                  placeholder="Your name"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && join()}
                />
              </div>
            </div>
            {(error || black) && (
              <div className="request" role="alert">
                <b>{black ? 'Your camera is on but the picture is black' : 'Camera or mic problem'}</b>
                <span style={{ fontSize: 14, lineHeight: 1.45 }}>
                  {black
                    ? 'Open the privacy shutter or press your laptop’s camera key (often F8/F10), close other apps using the camera, or pick a different camera below. If “OBS Virtual Camera” is selected, choose your real webcam.'
                    : error}
                </span>
                <div className="row">
                  <button className="btn dark" onClick={() => setAttempt((a) => a + 1)}><Icon name="refresh" size={16} /> Try again</button>
                </div>
              </div>
            )}
            {(showDevices || black || !!error) && (devices.cams.length > 0 || devices.mics.length > 0) && (
              <div className="device-row">
                {devices.cams.length > 0 && (
                  <label>
                    <span className="eyebrow">Camera</span>
                    <select
                      className="field"
                      value={choice.videoId ?? stream?.getVideoTracks()[0]?.getSettings().deviceId ?? ''}
                      onChange={(e) => pickDevice({ videoId: e.target.value })}
                    >
                      {devices.cams.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                    </select>
                  </label>
                )}
                {devices.mics.length > 0 && (
                  <label>
                    <span className="eyebrow">Microphone</span>
                    <select
                      className="field"
                      value={choice.audioId ?? stream?.getAudioTracks()[0]?.getSettings().deviceId ?? ''}
                      onChange={(e) => pickDevice({ audioId: e.target.value })}
                    >
                      {devices.mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
            {!showDevices && !black && !error && (devices.cams.length > 1 || devices.mics.length > 1) && (
              <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowDevices(true)}>
                <Icon name="camera" size={16} /> Change camera or mic
              </button>
            )}
            <button className="btn cream big block" onClick={join} disabled={!stream || joining}>
              {joining ? 'Joining…' : <>Join now <Icon name="arrow" size={20} /></>}
            </button>
          </section>
        </div>
      </main>
    </div>
  )
}

/* =================================================================== */
/*  Meeting                                                             */
/* =================================================================== */

type PanelTab = 'chat' | 'people' | 'host' | null

function MeetingView({ meeting: m, onRejoin }: { meeting: Meeting; onRejoin: () => void }) {
  useEmitter(m)
  useEmitter(profileStore)
  const [panel, setPanel] = useState<PanelTab>(null)
  const [reactOpen, setReactOpen] = useState(false)
  const [focusShare, setFocusShare] = useState<string | null>(null)

  useEffect(() => {
    if (panel === 'chat') m.markRead()
  }, [panel, m, m.messages.length])

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (m.status === 'in') e.preventDefault()
    }
    window.addEventListener('beforeunload', before)
    return () => window.removeEventListener('beforeunload', before)
  }, [m])

  if (m.status === 'waiting') {
    return (
      <div className="room"><div className="center"><div>
        <div className="spinner" />
        <h1>Hang tight<span className="dot">.</span></h1>
        <p>The host will let you in soon.</p>
        <button className="btn" onClick={() => m.leave().then(() => navigate(''))}>Leave</button>
      </div></div></div>
    )
  }
  if (m.status !== 'in' && m.status !== 'connecting') {
    const text = { kicked: 'You were removed from this meeting.', denied: 'The host didn’t let you in.', ended: 'The host ended the meeting for everyone.', left: 'You left the meeting.' }[m.status]
    return (
      <div className="room"><div className="center"><div>
        <h1>{m.status === 'left' ? 'See you' : 'That’s a wrap'}<span className="dot">.</span></h1>
        <p>{text}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {m.status === 'left' && <button className="btn" onClick={onRejoin}>Rejoin</button>}
          <a className="btn cream" href="#/">Back home</a>
        </div>
      </div></div></div>
    )
  }

  const me = profileStore.profile
  const peers = m.visiblePeers()
  const shares: { key: string; name: string; stream: MediaStream; self: boolean }[] = [
    ...(m.screenStream ? [{ key: 'self', name: 'You', stream: m.screenStream, self: true }] : []),
    ...peers.filter((p) => p.screenStream).map((p) => ({ key: p.id, name: p.name, stream: p.screenStream!, self: false })),
  ]
  const activeShare = shares.find((s) => s.key === focusShare) ?? shares[0]
  const recorders = [...(m.recorder ? ['You'] : []), ...peers.filter((p) => p.recording).map((p) => p.name)]
  const toggle = (t: PanelTab) => setPanel((cur) => (cur === t ? null : t))

  const selfTile: TileData = {
    key: 'self', seed: m.selfId, name: me.name || 'You', label: `${me.name || 'You'} (you)`, avatar: me.avatar,
    stream: m.localStream, cam: m.cam, mic: m.mic, hand: m.hand, speaking: m.selfSpeaking, reaction: m.selfReaction,
    host: m.amHost, self: true,
  }
  const tiles: TileData[] = [selfTile, ...peers.map((p) => peerTile(p, m.hostId))]

  return (
    <div className="room">
      <header className="room-top">
        <span className="room-title">{m.title}</span>
        <Timer since={m.startedAt} />
        <span className="pill green-t hide-mobile"><Icon name="lock" size={13} /> Encrypted P2P</span>
        {recorders.length > 0 && <span className="pill rec"><span className="live-dot" /> REC · {recorders.join(', ')}</span>}
        {m.amHost && <span className="pill hide-mobile" style={{ color: 'var(--butter)' }}><Icon name="shield" size={13} /> Host</span>}
        <span className="spacer" />
        <button className="btn sm butter" style={{ border: 0 }} onClick={() => copyCode(m.roomId)} aria-label="Copy meeting code">
          <Icon name="copy" size={16} /> <span className="code">{prettyRoomId(m.roomId)}</span>
        </button>
      </header>

      <div className="room-body">
        <section className="stage">
          {activeShare ? (
            <div className="share-layout">
              <div className="share-main">
                <StreamVideo stream={activeShare.stream} fit="contain" />
                <div style={{ position: 'absolute', top: 14, left: 14, right: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="pill" style={{ border: 0, background: 'var(--lilac)', color: 'var(--lilac-ink)', fontWeight: 700 }}>
                    <span className="live-dot" /> {activeShare.self ? 'You’re presenting' : `${activeShare.name} is presenting`}
                  </span>
                  {shares.length > 1 && shares.map((s) => (
                    <button key={s.key} className={`btn sm ${s.key === activeShare.key ? 'cream' : ''}`} onClick={() => setFocusShare(s.key)}>{s.name}</button>
                  ))}
                  <span className="spacer" />
                  {activeShare.self && (
                    <>
                      <div className="seg small" role="group" aria-label="Share quality">
                        <button className={m.shareMode === 'smooth' ? 'on' : ''} onClick={() => m.setShareMode('smooth')}>Smooth 60fps</button>
                        <button className={m.shareMode === 'sharp' ? 'on' : ''} onClick={() => m.setShareMode('sharp')}>Sharp text</button>
                      </div>
                      <button className="btn sm cream" onClick={() => m.stopShare()}>Stop sharing</button>
                    </>
                  )}
                </div>
              </div>
              <div className="filmstrip">
                {tiles.map((t) => <Tile key={t.key} t={t} />)}
              </div>
            </div>
          ) : (
            <Grid tiles={tiles} />
          )}
        </section>

        {panel && (
          <aside className="panel" aria-label="Side panel">
            <div className="panel-head">
              <div className="seg small" style={{ flex: 1 }}>
                <button className={panel === 'chat' ? 'on' : ''} onClick={() => setPanel('chat')}>Chat</button>
                <button className={panel === 'people' ? 'on' : ''} onClick={() => setPanel('people')}>People {peers.length + 1}</button>
                {m.amHost && (
                  <button className={panel === 'host' ? 'on' : ''} onClick={() => setPanel('host')}>
                    Host{m.requests.length > 0 && <span className="tag" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{m.requests.length}</span>}
                  </button>
                )}
              </div>
              <button className="icon-btn sm" aria-label="Close panel" onClick={() => setPanel(null)}><Icon name="x" size={18} /></button>
            </div>
            {panel === 'chat' && <ChatPanel m={m} />}
            {panel === 'people' && <PeoplePanel m={m} />}
            {panel === 'host' && m.amHost && <HostPanel m={m} />}
          </aside>
        )}
      </div>

      <div className="dock-wrap" style={{ position: 'relative' }}>
        {reactOpen && (
          <div className="react-pop" role="menu">
            {['👍', '❤️', '😂', '🔥', '👏', '🎉'].map((e) => (
              <button key={e} role="menuitem" aria-label={`React ${e}`} onClick={() => { m.sendReaction(e); setReactOpen(false) }}>{e}</button>
            ))}
          </div>
        )}
        <div className="dock">
          <DockBtn label={m.mic ? 'Mute' : 'Unmute'} icon={m.mic ? 'mic' : 'micOff'} cls={m.mic ? '' : 'off'} onClick={() => m.toggleMic()} />
          <DockBtn label={m.cam ? 'Stop video' : 'Start video'} icon={m.cam ? 'video' : 'videoOff'} cls={m.cam ? '' : 'off'} onClick={() => m.toggleCam()} />
          {canShareScreen && (
            <DockBtn
              label={m.screenStream ? 'Stop sharing' : 'Share screen'}
              icon={m.screenStream ? 'screenOff' : 'screen'}
              cls="lilac"
              onClick={() => (m.screenStream ? m.stopShare() : m.startShare())}
            />
          )}
          <DockBtn
            label={m.recorder ? 'Stop recording' : 'Record'}
            icon="rec"
            cls={m.recorder ? 'rec' : ''}
            onClick={() => (m.recorder ? m.stopRecording() : m.startRecording())}
            hideMobile
          />
          <DockBtn label={m.hand ? 'Lower hand' : 'Raise hand'} icon="hand" cls={m.hand ? 'butter' : ''} onClick={() => m.setHand(!m.hand)} />
          <DockBtn label="React" icon="smile" onClick={() => setReactOpen((v) => !v)} hideMobile />
          <span className="sep hide-mobile" />
          <DockBtn label="Chat" icon="chat" cls={panel === 'chat' ? 'mint' : ''} badge={m.unread} onClick={() => toggle('chat')} />
          <DockBtn
            label={m.amHost ? 'Host controls' : 'People'}
            icon={m.amHost ? 'shield' : 'users'}
            cls={panel === 'people' || panel === 'host' ? 'mint' : ''}
            badge={m.amHost ? m.requests.length : 0}
            onClick={() => toggle(m.amHost ? 'host' : 'people')}
          />
          <button className="btn accent leave-btn" aria-label="Leave meeting" onClick={() => m.leave().then(() => navigate(''))}>
            <Icon name="phone" /> <span className="hide-mobile">Leave</span>
          </button>
        </div>
      </div>
      {isDesktopApp && <DesktopPicker />}
    </div>
  )
}

function DockBtn({ label, icon, cls = '', onClick, badge = 0, hideMobile }: { label: string; icon: string; cls?: string; onClick: () => void; badge?: number; hideMobile?: boolean }) {
  return (
    <button className={`icon-btn ${cls} ${hideMobile ? 'hide-mobile' : ''}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
      {badge > 0 && <span className="badge">{badge > 9 ? '9+' : badge}</span>}
    </button>
  )
}

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return (
    <span className="pill" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--accent)' }} />
      {hh ? `${hh}:` : ''}{mm}:{ss}
    </span>
  )
}

/* ---------------- tiles ---------------- */

type TileData = {
  key: string; seed: string; name: string; label: string; avatar: string | null; stream: MediaStream | null
  cam: boolean; mic: boolean; hand: number; speaking: boolean; reaction: { emoji: string; at: number } | null
  host: boolean; self: boolean
}

function peerTile(p: Peer, hostId: string | null): TileData {
  return {
    key: p.id, seed: p.id, name: p.name, label: p.name, avatar: p.avatar, stream: p.camStream, cam: p.cam, mic: p.mic,
    hand: p.hand, speaking: p.speaking, reaction: p.reaction, host: p.id === hostId, self: false,
  }
}

function StreamVideo({ stream, mirror, fit = 'cover' }: { stream: MediaStream; mirror?: boolean; fit?: 'cover' | 'contain' }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (v.srcObject !== stream) v.srcObject = stream
    v.play().catch(() => {})
    // a camera turned back on, or a track added later, needs a nudge on some browsers
    const replay = () => v.play().catch(() => {})
    stream.addEventListener('addtrack', replay)
    return () => stream.removeEventListener('addtrack', replay)
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted className={mirror ? 'mirror' : ''} style={{ objectFit: fit }} />
}

function Tile({ t, style }: { t: TileData; style?: React.CSSProperties }) {
  const showVideo = t.cam && !!t.stream?.getVideoTracks().length
  const reacting = t.reaction && Date.now() - t.reaction.at < 2400
  return (
    <div className={`vtile ${pastelFor(t.seed)} ${t.speaking ? 'speaking' : ''}`} style={style}>
      {showVideo ? <StreamVideo stream={t.stream!} mirror={t.self} /> : <Avatar name={t.name} src={t.avatar} seed={t.seed} size={96} />}
      <span className="name">
        {!t.mic && <span style={{ color: '#ff9e86', display: 'inline-flex' }}><Icon name="micOff" size={14} stroke={2.4} /></span>}
        <span>{t.label}</span>
        {t.host && <span className="tag butter">Host</span>}
      </span>
      {t.hand > 0 && <div className="corner"><span title="Hand raised"><Icon name="hand" size={18} /></span></div>}
      {reacting && <span key={t.reaction!.at} className="float-react">{t.reaction!.emoji}</span>}
    </div>
  )
}

/** Picks the column count that makes 16:10 tiles as big as possible inside the stage. */
function Grid({ tiles }: { tiles: TileData[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const n = tiles.length
  const gap = 12
  let best = { cols: 1, w: 0 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const w = Math.min((size.w - gap * (cols - 1)) / cols, ((size.h - gap * (rows - 1)) / rows) * 1.6)
    if (w > best.w) best = { cols, w }
  }
  return (
    <div ref={ref} className="grid" style={{ gridTemplateColumns: `repeat(${best.cols}, ${Math.floor(best.w)}px)`, justifyContent: 'center' }}>
      {tiles.map((t) => <Tile key={t.key} t={t} />)}
    </div>
  )
}

/* ---------------- panels ---------------- */

function ChatPanel({ m }: { m: Meeting }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [m.messages.length])
  const blocked = !m.perms.chat && !m.amHost
  return (
    <>
      <div className="panel-body">
        <div className="notice"><Icon name="lock" size={12} /> Messages go straight to people in this call and disappear when it ends.</div>
        {m.messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div className="serif" style={{ fontSize: 34 }}>Say hi</div>
            <p className="muted" style={{ margin: 0 }}>No messages yet.</p>
          </div>
        )}
        {m.messages.map((msg) => (
          <div key={msg.id} className={`msg ${msg.mine ? 'me' : ''}`}>
            {!msg.mine && <Avatar name={msg.name} src={m.peers.get(msg.from)?.avatar} seed={msg.from} size={30} />}
            <div className="bubble">
              {!msg.mine && <span className="who">{msg.name}</span>}
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="panel-foot"
        onSubmit={(e) => {
          e.preventDefault()
          m.sendChat(text)
          setText('')
        }}
      >
        <div className="input-row">
          <label htmlFor="chat-in" className="sr">Message</label>
          <input id="chat-in" value={text} onChange={(e) => setText(e.target.value)} placeholder={blocked ? 'Chat is off' : 'Message everyone'} disabled={blocked} autoComplete="off" />
          <button className="icon-btn sm" style={{ background: 'var(--text)', color: '#141210' }} aria-label="Send" disabled={blocked || !text.trim()}>
            <Icon name="send" size={18} />
          </button>
        </div>
      </form>
    </>
  )
}

function PeoplePanel({ m }: { m: Meeting }) {
  const me = profileStore.profile
  const peers = m.visiblePeers()
  return (
    <div className="panel-body">
      <div className="person">
        <Avatar name={me.name || 'You'} src={me.avatar} seed={m.selfId} size={42} />
        <div className="info"><b>{me.name || 'You'} (you)</b><small>{m.amHost ? 'Host' : 'Participant'}</small></div>
      </div>
      {peers.map((p) => (
        <div className="person" key={p.id}>
          <Avatar name={p.name} src={p.avatar} seed={p.id} size={42} />
          <div className="info">
            <b>{p.name}</b>
            <small>
              {p.id === m.hostId ? 'Host' : 'Participant'}
              {p.hand ? ' · ✋ hand up' : ''}{p.sharing ? ' · sharing' : ''}{p.recording ? ' · recording' : ''}
            </small>
          </div>
          {!p.mic && <span className="muted" aria-label="Muted"><Icon name="micOff" size={16} /></span>}
          {p.code && !profileStore.isFriend(p.code) && p.code !== me.code && (
            <button className="icon-btn sm" title="Add friend" aria-label={`Add ${p.name} as a friend`} onClick={() => m.sendFriendRequest(p.id)}>
              <Icon name="userPlus" size={16} />
            </button>
          )}
          {m.amHost && <HostPersonMenu m={m} p={p} />}
        </div>
      ))}
      {peers.length === 0 && (
        <div className="card" style={{ textAlign: 'center', background: 'var(--card-2)' }}>
          <p className="muted" style={{ margin: '0 0 12px' }}>It’s just you. Share the code!</p>
          <button className="btn sm cream" onClick={() => copyCode(m.roomId)}><Icon name="copy" size={16} /> Copy code {prettyRoomId(m.roomId)}</button>
        </div>
      )}
    </div>
  )
}

function HostPersonMenu({ m, p }: { m: Meeting; p: Peer }) {
  const [open, setOpen] = useState(false)
  const act = (t: Parameters<Meeting['hostCommand']>[1], msg: string) => {
    m.hostCommand(p.id, t)
    toast(msg)
    setOpen(false)
  }
  return (
    <span style={{ position: 'relative' }}>
      <button className="icon-btn sm" aria-label={`Manage ${p.name}`} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more" size={18} /></button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 46, zIndex: 10, padding: 8, width: 210, display: 'flex', flexDirection: 'column', gap: 2, animation: 'pop .3s var(--spring) both' }}>
          {p.mic && <MenuItem icon="micOff" onClick={() => act('mute', `Muted ${p.name}`)}>Mute</MenuItem>}
          {p.cam && <MenuItem icon="videoOff" onClick={() => act('camoff', `Turned off ${p.name}’s camera`)}>Stop video</MenuItem>}
          {p.sharing && <MenuItem icon="screenOff" onClick={() => act('stopshare', 'Stopped their share')}>Stop screen share</MenuItem>}
          {p.recording && <MenuItem icon="rec" onClick={() => act('stoprecord', 'Stopped their recording')}>Stop recording</MenuItem>}
          {p.hand > 0 && <MenuItem icon="hand" onClick={() => act('lowerhand', 'Lowered their hand')}>Lower hand</MenuItem>}
          <MenuItem icon="door" danger onClick={() => act('kick', `Removed ${p.name}`)}>Remove</MenuItem>
        </div>
      )}
    </span>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: string; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className="btn sm ghost" style={{ justifyContent: 'flex-start', border: 0, color: danger ? '#ff8a7e' : undefined, borderRadius: 14 }} onClick={onClick}>
      <Icon name={icon} size={16} /> {children}
    </button>
  )
}

function HostPanel({ m }: { m: Meeting }) {
  const kindLabel = { screen: 'wants to share their screen', record: 'wants to record', unmute: 'wants to unmute', join: 'is waiting to join' }
  const set = (patch: Partial<Perms>) => m.setPerms(patch)
  return (
    <div className="panel-body">
      {m.requests.map((r) => (
        <div className="request" key={r.id}>
          <b>{r.name} {kindLabel[r.kind]}</b>
          <div className="row">
            <button className="btn dark" onClick={() => m.answer(r.id, false)}>{r.kind === 'join' ? 'Deny' : 'No'}</button>
            <button className="btn accent" onClick={() => m.answer(r.id, true)}>{r.kind === 'join' ? 'Let in' : 'Allow'}</button>
          </div>
        </div>
      ))}

      <div className="eyebrow" style={{ marginTop: 4 }}>Meeting</div>
      <div>
        <Setting title="Waiting room" hint="New people wait until you let them in">
          <Switch label="Waiting room" checked={m.perms.locked} onChange={(v) => set({ locked: v })} />
        </Setting>
        <Setting title="Chat" hint="Let everyone send messages">
          <Switch label="Chat" checked={m.perms.chat} onChange={(v) => set({ chat: v })} />
        </Setting>
        <Setting title="Unmute themselves" hint="Off: people ask you first">
          <Switch label="Let people unmute" checked={m.perms.unmute} onChange={(v) => set({ unmute: v })} />
        </Setting>
      </div>

      <div className="eyebrow">Who can share their screen</div>
      <div className="seg small" role="group" aria-label="Screen share permission">
        {(['everyone', 'ask', 'host'] as const).map((v) => (
          <button key={v} className={m.perms.screenShare === v ? 'on' : ''} onClick={() => set({ screenShare: v })}>
            {{ everyone: 'Everyone', ask: 'Ask me', host: 'Only me' }[v]}
          </button>
        ))}
      </div>

      <div className="eyebrow">Who can record</div>
      <div className="seg small" role="group" aria-label="Recording permission">
        {(['everyone', 'ask', 'nobody'] as const).map((v) => (
          <button key={v} className={m.perms.record === v ? 'on' : ''} onClick={() => set({ record: v })}>
            {{ everyone: 'Everyone', ask: 'Ask me', nobody: 'Only me' }[v]}
          </button>
        ))}
      </div>

      <div className="eyebrow">Everyone</div>
      <div className="row wrap">
        <button className="btn sm" onClick={() => { m.hostCommand('all', 'mute'); toast('Muted everyone') }}><Icon name="micOff" size={16} /> Mute all</button>
        <button className="btn sm" onClick={() => { m.hostCommand('all', 'lowerhand'); toast('Lowered all hands') }}><Icon name="hand" size={16} /> Lower hands</button>
        <button className="btn sm" style={{ color: '#ff8a7e' }} onClick={() => m.hostCommand('all', 'end')}><Icon name="phone" size={16} /> End for all</button>
      </div>

      <div className="eyebrow">People</div>
      <PeoplePanelInline m={m} />
    </div>
  )
}

function PeoplePanelInline({ m }: { m: Meeting }) {
  const peers = m.visiblePeers()
  if (!peers.length) return <p className="muted" style={{ margin: 0, fontSize: 14 }}>Nobody else is here yet.</p>
  return (
    <>
      {peers.map((p) => (
        <div className="person" key={p.id}>
          <Avatar name={p.name} src={p.avatar} seed={p.id} size={38} />
          <div className="info"><b>{p.name}</b><small>{[p.mic ? 'mic on' : 'muted', p.cam ? 'video on' : 'video off'].join(' · ')}</small></div>
          <HostPersonMenu m={m} p={p} />
        </div>
      ))}
    </>
  )
}

/* ---------------- desktop app: choose what to share ---------------- */

function DesktopPicker() {
  const [sources, setSources] = useState<DesktopSource[] | null>(null)
  useEffect(() => {
    window.meetoDesktop?.onPickSource((s) => setSources(s))
  }, [])
  if (!sources) return null
  const pick = (id: string | null) => {
    window.meetoDesktop?.pickSource(id)
    setSources(null)
  }
  return (
    <Modal label="Choose what to share" onClose={() => pick(null)}>
      <h2>Share what<span className="dot">?</span></h2>
      <div className="sources">
        {sources.map((s) => (
          <button key={s.id} className="source" onClick={() => pick(s.id)}>
            <img src={s.thumbnail} alt="" />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <button className="btn block" style={{ marginTop: 16 }} onClick={() => pick(null)}>Cancel</button>
    </Modal>
  )
}
