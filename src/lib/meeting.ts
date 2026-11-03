import { joinRoom, selfId, type Room, type JsonValue } from 'trystero'
import { Emitter } from './store'
import { makeHostProof, verifyHostProof, type HostProof } from './hostKeys'
import { profileStore } from './profile'
import { LevelMeter } from './media'
import { p2pConfig, toast } from './platform'
import { Recorder } from './recorder'

export type RequestKind = 'screen' | 'record' | 'unmute' | 'join'
export type Perms = {
  locked: boolean // waiting room: host must let people in
  screenShare: 'everyone' | 'ask' | 'host'
  record: 'everyone' | 'ask' | 'nobody'
  chat: boolean
  unmute: boolean // can participants unmute themselves
}
export const DEFAULT_PERMS: Perms = { locked: false, screenShare: 'everyone', record: 'ask', chat: true, unmute: true }

export type Peer = {
  id: string
  ready: boolean // received their hello
  name: string
  avatar: string | null
  code: string | null
  mic: boolean
  cam: boolean
  hand: number
  sharing: boolean
  recording: boolean
  camStream: MediaStream | null
  screenStream: MediaStream | null
  speaking: boolean
  reaction: { emoji: string; at: number } | null
}
export type ChatMessage = { id: string; from: string; name: string; text: string; ts: number; mine: boolean }
export type PendingRequest = { id: string; peerId: string; name: string; kind: RequestKind }
export type Status = 'connecting' | 'waiting' | 'in' | 'kicked' | 'denied' | 'ended' | 'left'

type Hello = { name: string; avatar: string | null; code: string; mic: boolean; cam: boolean; hand: number; sharing: boolean; recording: boolean }
type StateMsg = Partial<Pick<Hello, 'mic' | 'cam' | 'hand' | 'sharing' | 'recording'>>
type HostMsg = { proof: HostProof; perms: Perms; admitted: string[]; banned: string[]; title: string }
type Cmd = { type: 'mute' | 'camoff' | 'stopshare' | 'stoprecord' | 'kick' | 'grant' | 'deny' | 'end' | 'lowerhand'; kind?: RequestKind }
type FriendMsg = { type: 'request' | 'accept'; name: string; avatar: string | null; code: string }

const APP_ID = 'meeto-p2p-v1'
const debug = (...a: unknown[]) => {
  try {
    if (localStorage.getItem('meeto.debug')) console.log('[meeto]', ...a)
  } catch {
    /* ignore */
  }
}
const asJson = (v: unknown) => v as JsonValue

export class Meeting extends Emitter {
  readonly selfId = selfId
  status: Status = 'connecting'
  peers = new Map<string, Peer>()
  messages: ChatMessage[] = []
  unread = 0
  requests: PendingRequest[] = []
  perms: Perms = { ...DEFAULT_PERMS }
  title: string
  hostId: string | null = null
  amHost = false
  startedAt = Date.now()

  // local state
  mic = true
  cam = true
  hand = 0
  localStream: MediaStream
  screenStream: MediaStream | null = null
  shareMode: 'smooth' | 'sharp' = profileStore.profile.smoothShare ? 'smooth' : 'sharp'
  selfSpeaking = false
  selfReaction: { emoji: string; at: number } | null = null
  recorder: Recorder | null = null
  private grants = new Set<RequestKind>()
  private waitingAsked = false

  // host state
  private admitted = new Set<string>()
  private banned = new Set<string>()
  private hostProof: HostProof | null = null

  private room: Room | null = null
  private sentCam = new Set<string>()
  private sentScreen = new Set<string>()
  private audioEls = new Map<string, HTMLAudioElement>()
  private meter = new LevelMeter()
  private timers: number[] = []
  private a!: {
    hello: (d: Hello, to?: string | string[]) => void
    state: (d: StateMsg) => void
    host: (d: HostMsg, to?: string) => void
    cmd: (d: Cmd, to: string | string[]) => void
    req: (d: { kind: RequestKind }) => void
    chat: (d: { id: string; text: string; ts: number }) => void
    react: (d: { emoji: string }) => void
    friend: (d: FriendMsg, to: string) => void
  }

  constructor(
    readonly roomId: string,
    localStream: MediaStream,
    opts: { mic: boolean; cam: boolean; title?: string },
  ) {
    super()
    this.localStream = localStream
    this.title = opts.title || 'Meeting'
    this.mic = opts.mic && localStream.getAudioTracks().length > 0
    this.cam = opts.cam && localStream.getVideoTracks().length > 0
    this.applyLocalTracks()
  }

  /* ================= lifecycle ================= */

  async join() {
    debug('join', this.roomId)
    this.meter.resume()
    this.meter.track('self', this.localStream)
    this.hostProof = await makeHostProof(this.roomId, selfId)
    this.amHost = !!this.hostProof
    if (this.amHost) this.hostId = selfId

    const room = joinRoom(p2pConfig(APP_ID), this.roomId)
    this.room = room
    this.setupActions(room)

    room.onPeerJoin = (id) => this.onPeerJoin(id)
    room.onPeerLeave = (id) => this.onPeerLeave(id)
    room.onPeerStream = (stream, id, meta) => this.onPeerStream(stream, id, meta)

    this.status = 'in'
    this.startedAt = Date.now()
    this.timers.push(window.setInterval(() => this.tickSpeaking(), 160))
    this.timers.push(window.setInterval(() => this.tuneSenders(), 4000))
    this.emit()
  }

  async leave(status: Status = 'left') {
    debug('leave', status)
    if (this.status === 'left' || this.status === 'kicked' || this.status === 'ended' || this.status === 'denied') return
    if (this.recorder) await this.stopRecording()
    this.status = status
    this.timers.forEach(clearInterval)
    this.stopShare(false)
    this.localStream.getTracks().forEach((t) => t.stop())
    this.audioEls.forEach((a) => {
      a.pause()
      a.srcObject = null
    })
    this.audioEls.clear()
    this.meter.close()
    const room = this.room
    this.room = null
    await room?.leave().catch(() => {})
    this.emit()
  }

  /* ================= wiring ================= */

  private setupActions(room: Room) {
    const hello = room.makeAction<JsonValue>('hello', {
      onMessage: (d, { peerId }) => this.onHello(peerId, d as unknown as Hello),
    })
    const state = room.makeAction<JsonValue>('state', {
      onMessage: (d, { peerId }) => this.onState(peerId, d as unknown as StateMsg),
    })
    const host = room.makeAction<JsonValue>('host', {
      onMessage: (d, { peerId }) => this.onHostMsg(peerId, d as unknown as HostMsg),
    })
    const cmd = room.makeAction<JsonValue>('cmd', {
      onMessage: (d, { peerId }) => this.onCmd(peerId, d as unknown as Cmd),
    })
    const req = room.makeAction<JsonValue>('req', {
      onMessage: (d, { peerId }) => this.onReq(peerId, (d as { kind: RequestKind }).kind),
    })
    const chat = room.makeAction<JsonValue>('chat', {
      onMessage: (d, { peerId }) => this.onChat(peerId, d as { id: string; text: string; ts: number }),
    })
    const react = room.makeAction<JsonValue>('react', {
      onMessage: (d, { peerId }) => this.onReact(peerId, (d as { emoji: string }).emoji),
    })
    const friend = room.makeAction<JsonValue>('friend', {
      onMessage: (d, { peerId }) => this.onFriend(peerId, d as unknown as FriendMsg),
    })
    const all = () => this.allowedPeerIds()
    this.a = {
      hello: (d, to) => void hello.send(asJson(d), { target: to ?? all() }),
      state: (d) => void state.send(asJson(d), { target: all() }),
      host: (d, to) => void host.send(asJson(d), { target: to ?? null }),
      cmd: (d, to) => void cmd.send(asJson(d), { target: to }),
      req: (d) => {
        if (this.hostId) void req.send(asJson(d), { target: this.hostId })
      },
      chat: (d) => void chat.send(asJson(d), { target: all() }),
      react: (d) => void react.send(asJson(d), { target: all() }),
      friend: (d, to) => void friend.send(asJson(d), { target: to }),
    }
  }

  private myHello(): Hello {
    const p = profileStore.profile
    return {
      name: p.name || 'Guest',
      avatar: p.avatar,
      code: p.code,
      mic: this.mic,
      cam: this.cam,
      hand: this.hand,
      sharing: !!this.screenStream,
      recording: !!this.recorder,
    }
  }

  private onPeerJoin(id: string) {
    debug('peer join', id)
    if (!this.peers.has(id)) {
      this.peers.set(id, {
        id, ready: false, name: 'Joining…', avatar: null, code: null, mic: false, cam: false, hand: 0,
        sharing: false, recording: false, camStream: null, screenStream: null, speaking: false, reaction: null,
      })
    }
    this.a.hello(this.myHello(), id)
    if (this.amHost) this.sendHostState(id)
    this.syncMedia()
    setTimeout(() => this.tuneSenders(), 1500)
    this.emit()
  }

  private onPeerLeave(id: string) {
    debug('peer leave', id)
    const p = this.peers.get(id)
    if (p?.ready && this.isAllowed(id)) toast(`${p.name} left`)
    this.peers.delete(id)
    this.sentCam.delete(id)
    this.sentScreen.delete(id)
    this.requests = this.requests.filter((r) => r.peerId !== id)
    this.dropAudio(id)
    this.dropAudio(`${id}:screen`)
    this.meter.untrack(id)
    if (id === this.hostId) this.hostId = null
    this.emit()
  }

  private onPeerStream(stream: MediaStream, id: string, meta?: JsonValue) {
    const p = this.peers.get(id)
    if (!p) return
    const kind = (meta as { kind?: string } | undefined)?.kind ?? (p.camStream ? 'screen' : 'cam')
    if (kind === 'screen') {
      p.screenStream = stream
      p.sharing = true
      this.playAudio(`${id}:screen`, stream)
    } else {
      p.camStream = stream
      this.playAudio(id, stream)
      this.meter.track(id, stream)
    }
    stream.addEventListener('removetrack', () => this.emit())
    this.tuneSenders()
    this.emit()
  }

  private onHello(id: string, h: Hello) {
    const p = this.peers.get(id)
    if (!p) return
    const first = !p.ready
    Object.assign(p, {
      ready: true,
      name: String(h.name || 'Guest').slice(0, 40),
      avatar: typeof h.avatar === 'string' && h.avatar.startsWith('data:image/') ? h.avatar : null,
      code: h.code ?? null,
      mic: !!h.mic, cam: !!h.cam, hand: Number(h.hand) || 0, sharing: !!h.sharing, recording: !!h.recording,
    })
    if (first && this.isAllowed(id) && this.status === 'in') toast(`${p.name} joined`)
    if (first && this.amHost && this.perms.locked && !this.admitted.has(id)) this.addRequest(id, 'join')
    this.emit()
  }

  private onState(id: string, s: StateMsg) {
    const p = this.peers.get(id)
    if (!p) return
    if (s.hand && !p.hand && this.isAllowed(id)) toast(`${p.name} raised their hand`)
    if (s.recording && !p.recording) toast(`${p.name} started recording`)
    Object.assign(p, s)
    if (s.sharing === false) {
      p.screenStream = null
      this.dropAudio(`${id}:screen`)
    }
    this.tuneSenders()
    this.emit()
  }

  /* ================= host & permissions ================= */

  private sendHostState(to?: string) {
    if (!this.amHost || !this.hostProof) return
    this.a.host(
      { proof: this.hostProof, perms: this.perms, admitted: [...this.admitted], banned: [...this.banned], title: this.title },
      to,
    )
  }

  private async onHostMsg(id: string, m: HostMsg) {
    if (this.amHost) return
    if (id !== this.hostId && !(await verifyHostProof(this.roomId, id, m.proof))) return
    this.hostId = id
    this.perms = { ...DEFAULT_PERMS, ...m.perms }
    this.admitted = new Set(m.admitted)
    this.banned = new Set(m.banned)
    if (m.title) this.title = String(m.title).slice(0, 60)
    if (this.banned.has(selfId)) return void this.leave('kicked')
    if (!this.selfAllowed()) {
      this.status = 'waiting'
      if (!this.waitingAsked) {
        this.waitingAsked = true
        this.a.req({ kind: 'join' })
      }
    } else if (this.status === 'waiting') {
      this.status = 'in'
      toast('The host let you in')
    }
    this.syncMedia()
    this.refreshAudio()
    this.emit()
  }

  /** People still in the waiting room (or removed) are never heard. */
  private refreshAudio() {
    this.audioEls.forEach((el, key) => (el.muted = !this.isAllowed(key.split(':')[0])))
  }

  private onCmd(id: string, c: Cmd) {
    if (id !== this.hostId) return
    switch (c.type) {
      case 'mute':
        if (this.mic) toast('The host muted you')
        this.grants.delete('unmute')
        this.setMic(false)
        break
      case 'camoff':
        if (this.cam) toast('The host turned off your camera')
        this.setCam(false)
        break
      case 'stopshare':
        if (this.screenStream) toast('The host stopped your screen share')
        this.stopShare()
        break
      case 'stoprecord':
        if (this.recorder) toast('The host stopped your recording')
        void this.stopRecording()
        break
      case 'lowerhand':
        this.setHand(false)
        break
      case 'grant':
        if (c.kind) {
          this.grants.add(c.kind)
          const label = { screen: 'share your screen — tap Share', record: 'record', unmute: 'unmute', join: 'join' }[c.kind]
          toast(`The host lets you ${label}`)
          if (c.kind === 'unmute') this.setMic(true)
          if (c.kind === 'record') void this.startRecording()
        }
        break
      case 'deny':
        toast('The host said no this time')
        break
      case 'kick':
        if (this.status !== 'waiting') toast('You were removed from the meeting')
        void this.leave(this.status === 'waiting' ? 'denied' : 'kicked')
        break
      case 'end':
        void this.leave('ended')
        break
    }
  }

  private onReq(id: string, kind: RequestKind) {
    if (!this.amHost) return
    if (kind === 'join' ? this.admitted.has(id) || !this.perms.locked : !this.isAllowed(id)) return
    this.addRequest(id, kind)
  }

  private addRequest(peerId: string, kind: RequestKind) {
    if (this.requests.some((r) => r.peerId === peerId && r.kind === kind)) return
    const name = this.peers.get(peerId)?.name ?? 'Someone'
    this.requests = [...this.requests, { id: `${peerId}:${kind}`, peerId, name, kind }]
    const what = { screen: 'wants to share their screen', record: 'wants to record', unmute: 'wants to unmute', join: 'is waiting to join' }[kind]
    toast(`${name} ${what}`, { label: 'Allow', run: () => this.answer(`${peerId}:${kind}`, true) }, 8000)
    this.emit()
  }

  answer(requestId: string, allow: boolean) {
    const r = this.requests.find((x) => x.id === requestId)
    if (!r) return
    this.requests = this.requests.filter((x) => x.id !== requestId)
    if (r.kind === 'join') {
      if (allow) {
        this.admitted.add(r.peerId)
        this.sendHostState()
        this.syncMedia()
        this.refreshAudio()
      } else {
        this.a.cmd({ type: 'kick' }, r.peerId)
      }
    } else {
      this.a.cmd({ type: allow ? 'grant' : 'deny', kind: r.kind }, r.peerId)
    }
    this.emit()
  }

  setPerms(patch: Partial<Perms>) {
    if (!this.amHost) return
    if (patch.locked && !this.perms.locked) {
      // everyone already here stays in
      this.peers.forEach((p) => p.ready && this.admitted.add(p.id))
    }
    this.perms = { ...this.perms, ...patch }
    this.sendHostState()
    this.refreshAudio()
    this.emit()
  }

  hostCommand(peerId: string | 'all', type: Cmd['type']) {
    if (!this.amHost) return
    const targets = peerId === 'all' ? this.allowedPeerIds() : [peerId]
    if (!targets.length) return
    if (type === 'kick' && peerId !== 'all') {
      this.banned.add(peerId)
      this.admitted.delete(peerId)
      this.sendHostState()
      this.syncMedia()
      this.refreshAudio()
    }
    this.a.cmd({ type }, targets)
    if (type === 'end') void this.leave('ended')
    this.emit()
  }

  isAllowed(id: string) {
    if (this.banned.has(id)) return false
    if (id === this.hostId) return true
    return !this.perms.locked || this.admitted.has(id)
  }

  private selfAllowed() {
    return this.amHost || (!this.banned.has(selfId) && (!this.perms.locked || this.admitted.has(selfId)))
  }

  private allowedPeerIds() {
    if (!this.selfAllowed()) return this.hostId ? [this.hostId] : []
    return [...this.peers.keys()].filter((id) => this.isAllowed(id))
  }

  /** Visible people, host first then by join order. */
  visiblePeers() {
    return [...this.peers.values()].filter((p) => p.ready && this.isAllowed(p.id))
  }

  /* ================= media ================= */

  private syncMedia() {
    if (!this.room) return
    const can = this.selfAllowed()
    for (const id of this.peers.keys()) {
      const ok = can && this.isAllowed(id)
      if (ok && !this.sentCam.has(id) && this.localStream.getTracks().length) {
        this.room.addStream(this.localStream, { target: id, metadata: { kind: 'cam' } })
        this.sentCam.add(id)
      } else if (!ok && this.sentCam.has(id)) {
        this.room.removeStream(this.localStream, { target: id })
        this.sentCam.delete(id)
      }
      if (this.screenStream) {
        if (ok && !this.sentScreen.has(id)) {
          this.room.addStream(this.screenStream, { target: id, metadata: { kind: 'screen' } })
          this.sentScreen.add(id)
        } else if (!ok && this.sentScreen.has(id)) {
          this.room.removeStream(this.screenStream, { target: id })
          this.sentScreen.delete(id)
        }
      }
    }
  }

  private applyLocalTracks() {
    this.localStream.getAudioTracks().forEach((t) => (t.enabled = this.mic))
    this.localStream.getVideoTracks().forEach((t) => (t.enabled = this.cam))
  }

  private setMic(on: boolean) {
    if (on && !this.localStream.getAudioTracks().length) return void toast('No microphone found')
    this.mic = on
    this.applyLocalTracks()
    this.a?.state({ mic: on })
    this.emit()
  }

  private setCam(on: boolean) {
    if (on && !this.localStream.getVideoTracks().length) return void toast('No camera found')
    this.cam = on
    this.applyLocalTracks()
    this.a?.state({ cam: on })
    this.emit()
  }

  toggleMic() {
    if (!this.mic && !this.amHost && !this.perms.unmute && !this.grants.has('unmute')) {
      this.a.req({ kind: 'unmute' })
      return void toast('Asked the host to unmute you')
    }
    this.setMic(!this.mic)
  }

  toggleCam() {
    this.setCam(!this.cam)
  }

  setHand(up: boolean) {
    this.hand = up ? Date.now() : 0
    this.a.state({ hand: this.hand })
    this.emit()
  }

  private canDo(kind: 'screen' | 'record'): 'yes' | 'ask' | 'no' {
    if (this.amHost || this.grants.has(kind)) return 'yes'
    const rule = kind === 'screen' ? this.perms.screenShare : this.perms.record
    if (rule === 'everyone') return 'yes'
    if (rule === 'ask') return this.hostId ? 'ask' : 'yes'
    return 'no'
  }

  async startShare(sourcePicked?: () => Promise<void>) {
    if (this.screenStream) return
    const can = this.canDo('screen')
    if (can === 'no') return void toast('Only the host can share in this meeting')
    if (can === 'ask') {
      this.a.req({ kind: 'screen' })
      return void toast('Asked the host if you can share')
    }
    if (this.visiblePeers().some((p) => p.sharing)) toast('Someone else is sharing — yours will show too')
    let stream: MediaStream
    try {
      await sourcePicked?.()
      const smooth = this.shareMode === 'smooth'
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: smooth ? 60 : 30, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      })
    } catch {
      return
    }
    const vt = stream.getVideoTracks()[0]
    if (!vt) return
    vt.contentHint = this.shareMode === 'smooth' ? 'motion' : 'detail'
    vt.addEventListener('ended', () => this.stopShare())
    this.screenStream = stream
    this.syncMedia()
    this.a.state({ sharing: true })
    // tune bitrate/framerate as soon as the tracks are negotiated
    ;[300, 1200, 3000].forEach((ms) => setTimeout(() => this.tuneSenders(), ms))
    this.emit()
  }

  stopShare(announce = true) {
    const s = this.screenStream
    if (!s) return
    this.screenStream = null
    if (this.room) {
      for (const id of this.sentScreen) this.room.removeStream(s, { target: id })
    }
    this.sentScreen.clear()
    s.getTracks().forEach((t) => t.stop())
    if (announce) this.a?.state({ sharing: false })
    this.tuneSenders()
    this.emit()
  }

  setShareMode(mode: 'smooth' | 'sharp') {
    this.shareMode = mode
    profileStore.update({ smoothShare: mode === 'smooth' })
    const vt = this.screenStream?.getVideoTracks()[0]
    if (vt) {
      vt.contentHint = mode === 'smooth' ? 'motion' : 'detail'
      vt.applyConstraints({ frameRate: { ideal: mode === 'smooth' ? 60 : 30, max: 60 } }).catch(() => {})
    }
    this.tuneSenders()
    this.emit()
  }

  /**
   * The "smooth as heck" part. Screen share gets a high bitrate and keeps its frame rate
   * (resolution drops first on a bad network). While anyone is sharing, cameras get a
   * small budget so the shared screen has the bandwidth.
   */
  private tuneSenders() {
    if (!this.room) return
    const shareTrack = this.screenStream?.getVideoTracks()[0]
    const someoneSharing = !!shareTrack || this.visiblePeers().some((p) => p.sharing)
    const n = Math.max(1, this.visiblePeers().length)
    const dataSaver = profileStore.profile.dataSaver
    const camBitrate = someoneSharing ? 250_000 : dataSaver ? 300_000 : n > 4 ? 450_000 : n > 2 ? 800_000 : 1_500_000
    const smooth = this.shareMode === 'smooth'
    const pcs = Object.values(this.room.getPeers())
    for (const pc of pcs) {
      for (const sender of pc.getSenders()) {
        const t = sender.track
        if (!t || t.kind !== 'video') continue
        const isShare = t === shareTrack
        const params = sender.getParameters()
        if (!params.encodings?.length) continue
        const enc = params.encodings[0]
        if (isShare) {
          enc.maxBitrate = smooth ? 6_000_000 : 4_000_000
          enc.maxFramerate = smooth ? 60 : 30
          enc.priority = 'high'
          enc.networkPriority = 'high'
        } else {
          enc.maxBitrate = camBitrate
          enc.maxFramerate = someoneSharing ? 15 : 30
          enc.priority = 'low'
        }
        const withPref = { ...params, degradationPreference: isShare ? (smooth ? 'maintain-framerate' : 'maintain-resolution') : 'balanced' }
        sender.setParameters(withPref as RTCRtpSendParameters).catch(() => sender.setParameters(params).catch(() => {}))
      }
    }
  }

  private playAudio(key: string, stream: MediaStream) {
    if (!stream.getAudioTracks().length) return
    let el = this.audioEls.get(key)
    if (!el) {
      el = new Audio()
      el.autoplay = true
      this.audioEls.set(key, el)
    }
    el.srcObject = stream
    el.muted = !this.isAllowed(key.split(':')[0])
    el.play().catch(() => {
      // autoplay blocked: retry on the next interaction
      const retry = () => el!.play().catch(() => {})
      window.addEventListener('pointerdown', retry, { once: true })
    })
  }

  private dropAudio(key: string) {
    const el = this.audioEls.get(key)
    if (!el) return
    el.pause()
    el.srcObject = null
    this.audioEls.delete(key)
  }

  private tickSpeaking() {
    let changed = false
    const me = this.mic && this.meter.level('self') > 0.12
    if (me !== this.selfSpeaking) {
      this.selfSpeaking = me
      changed = true
    }
    for (const p of this.peers.values()) {
      const s = p.mic && this.meter.level(p.id) > 0.12
      if (s !== p.speaking) {
        p.speaking = s
        changed = true
      }
    }
    if (changed) this.emit()
  }

  /* ================= chat, reactions, friends ================= */

  sendChat(text: string) {
    text = text.trim().slice(0, 2000)
    if (!text) return
    if (!this.perms.chat && !this.amHost) return void toast('The host turned chat off')
    const msg = { id: `${selfId}-${Date.now()}`, text, ts: Date.now() }
    this.a.chat(msg)
    this.messages = [...this.messages, { ...msg, from: selfId, name: 'You', mine: true }]
    this.emit()
  }

  private onChat(id: string, m: { id: string; text: string; ts: number }) {
    if (!this.isAllowed(id) || (!this.perms.chat && id !== this.hostId)) return
    const p = this.peers.get(id)
    this.messages = [
      ...this.messages,
      { id: String(m.id), from: id, name: p?.name ?? 'Guest', text: String(m.text).slice(0, 2000), ts: Date.now(), mine: false },
    ]
    this.unread++
    this.emit()
  }

  markRead() {
    if (!this.unread) return
    this.unread = 0
    this.emit()
  }

  sendReaction(emoji: string) {
    this.selfReaction = { emoji, at: Date.now() }
    this.a.react({ emoji })
    this.emit()
    setTimeout(() => this.emit(), 2500)
  }

  private onReact(id: string, emoji: string) {
    const p = this.peers.get(id)
    if (!p || !this.isAllowed(id)) return
    p.reaction = { emoji: String(emoji).slice(0, 8), at: Date.now() }
    this.emit()
    setTimeout(() => this.emit(), 2500)
  }

  sendFriendRequest(peerId: string) {
    const me = profileStore.profile
    this.a.friend({ type: 'request', name: me.name || 'Guest', avatar: me.avatar, code: me.code }, peerId)
    toast('Friend request sent')
  }

  private onFriend(id: string, f: FriendMsg) {
    if (!f.code || typeof f.code !== 'string') return
    const info = { code: f.code, name: String(f.name || 'Friend').slice(0, 40), avatar: f.avatar?.startsWith('data:image/') ? f.avatar : null }
    if (f.type === 'accept') {
      profileStore.addFriend(info)
      return void toast(`You and ${info.name} are now friends`)
    }
    if (profileStore.isFriend(f.code)) return
    profileStore.addRequest(info)
    toast(`${info.name} wants to be friends`, {
      label: 'Accept',
      run: () => {
        profileStore.addFriend(info)
        const me = profileStore.profile
        this.a.friend({ type: 'accept', name: me.name || 'Guest', avatar: me.avatar, code: me.code }, id)
      },
    }, 9000)
  }

  /* ================= recording ================= */

  async startRecording() {
    if (this.recorder) return
    const can = this.canDo('record')
    if (can === 'no') return void toast('Recording is turned off in this meeting')
    if (can === 'ask') {
      this.a.req({ kind: 'record' })
      return void toast('Asked the host if you can record')
    }
    const rec = new Recorder(this)
    try {
      rec.start()
    } catch {
      return void toast('Recording is not supported here')
    }
    this.recorder = rec
    this.a.state({ recording: true })
    toast('Recording — everyone can see the REC badge')
    this.emit()
  }

  async stopRecording() {
    const rec = this.recorder
    if (!rec) return
    this.recorder = null
    this.a?.state({ recording: false })
    this.emit()
    await rec.stopAndSave(`meeto-${this.title.replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`)
    toast('Recording saved to your downloads')
  }

  /** Every stream the recorder should draw / mix. */
  mediaForRecording() {
    const tiles: { key: string; name: string; stream: MediaStream | null; cam: boolean }[] = [
      { key: 'self', name: profileStore.profile.name || 'You', stream: this.localStream, cam: this.cam },
      ...this.visiblePeers().map((p) => ({ key: p.id, name: p.name, stream: p.camStream, cam: p.cam })),
    ]
    const share = this.screenStream ?? this.visiblePeers().find((p) => p.screenStream)?.screenStream ?? null
    const audio: MediaStream[] = [this.localStream, ...this.visiblePeers().flatMap((p) => [p.camStream, p.screenStream].filter(Boolean) as MediaStream[])]
    if (this.screenStream) audio.push(this.screenStream)
    return { tiles, share, audio }
  }
}
