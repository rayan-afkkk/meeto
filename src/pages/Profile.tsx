import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Avatar, Setting, Switch } from '../components/ui'
import { imageToAvatar, profileStore } from '../lib/profile'
import { copyText, isNativeApp, REPO, toast } from '../lib/platform'
import { useEmitter } from '../lib/store'
import { DownloadCard } from './Home'

export function AvatarPicker({ size = 132 }: { size?: number }) {
  useEmitter(profileStore)
  const p = profileStore.profile
  return (
    <div className="avatar-edit" style={{ width: size, height: size }}>
      <Avatar name={p.name || 'You'} src={p.avatar} seed={p.code} size={size} />
      <label title="Change photo">
        <span className="sr">Change profile picture</span>
        <Icon name="camera" size={18} />
        <input
          type="file"
          accept="image/*"
          className="sr"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              profileStore.update({ avatar: await imageToAvatar(f) })
              toast('Looking good')
            } catch {
              toast('Couldn’t read that image')
            }
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}

export function ProfilePage() {
  useEmitter(profileStore)
  const p = profileStore.profile
  const [name, setName] = useState(p.name)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
      <section style={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1 className="hero-title" style={{ fontSize: 'clamp(56px, 8vw, 96px)' }}>You<span className="dot">.</span></h1>
        <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <AvatarPicker />
          <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label htmlFor="pname" className="eyebrow">Your name</label>
            <input
              id="pname"
              className="field"
              value={name}
              maxLength={40}
              placeholder="What should people call you?"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => profileStore.update({ name: name.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            {p.avatar && (
              <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => profileStore.update({ avatar: null })}>
                <Icon name="trash" size={16} /> Remove photo
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <div className="eyebrow">Your friend code</div>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <span className="code serif" style={{ fontSize: 44, lineHeight: 1 }}>{p.code}</span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => copyText(p.code)}><Icon name="copy" size={16} /> Copy</button>
          </div>
          <p className="muted" style={{ margin: '12px 0 0', fontSize: 14 }}>Share it so friends can add you. No email or phone number needed.</p>
        </div>

        <div className="card" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <Setting title="Smooth screen share" hint="60 fps for videos and scrolling. Turn off for sharper text.">
            <Switch label="Smooth screen share" checked={p.smoothShare} onChange={(v) => profileStore.update({ smoothShare: v })} />
          </Setting>
          <Setting title="Data saver" hint="Lower camera quality on slow connections.">
            <Switch label="Data saver" checked={p.dataSaver} onChange={(v) => profileStore.update({ dataSaver: v })} />
          </Setting>
        </div>
      </section>

      <aside style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
        {!isNativeApp && <DownloadCard />}
        <div className="card">
          <h2 className="serif" style={{ fontSize: 34, lineHeight: 1 }}>Open source</h2>
          <p className="muted" style={{ margin: '8px 0 16px' }}>Meeto is free and open source. Your profile lives only on this device.</p>
          <a className="btn sm" href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer">View on GitHub</a>
        </div>
      </aside>
    </div>
  )
}
