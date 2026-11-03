export type DeviceChoice = { videoId?: string; audioId?: string }

/** Plain-language reason a camera/mic request failed. */
function explain(err: unknown, what: 'camera' | 'microphone' | 'camera and microphone'): string {
  const name = (err as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return `Your ${what} is blocked. Click the lock/camera icon in the address bar and choose Allow, then tap Try again.`
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return `Your ${what} is being used by another app (Zoom, Teams, Discord, the Camera app, OBS or another tab). Close it and tap Try again.`
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} found. Plug one in or pick another below.`
  return `Couldn’t start your ${what}. Tap Try again.`
}

/** Get camera + mic, falling back gracefully when one of them is missing or blocked. */
export async function getLocalMedia(dataSaver: boolean, choice: DeviceChoice = {}): Promise<{ stream: MediaStream; error: string | null }> {
  const video: MediaTrackConstraints = {
    ...(dataSaver
      ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }),
    ...(choice.videoId ? { deviceId: { exact: choice.videoId } } : { facingMode: 'user' }),
  }
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(choice.audioId ? { deviceId: { exact: choice.audioId } } : {}),
  }
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) {
    const insecure = typeof isSecureContext !== 'undefined' && !isSecureContext
    return { stream: new MediaStream(), error: insecure ? 'Camera needs a secure (https://) link.' : 'This browser can’t use a camera or microphone.' }
  }
  let firstErr: unknown = null
  for (const c of [{ video, audio }, { audio }, { video }] as MediaStreamConstraints[]) {
    try {
      const stream = await md.getUserMedia(c)
      stream.getVideoTracks().forEach((t) => (t.contentHint = 'motion'))
      if (!c.video) return { stream, error: explain(firstErr, 'camera') + ' You can still join.' }
      if (!c.audio) return { stream, error: explain(firstErr, 'microphone') + ' You can still join.' }
      return { stream, error: null }
    } catch (e) {
      firstErr ??= e
    }
  }
  return { stream: new MediaStream(), error: explain(firstErr, 'camera and microphone') }
}

export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return {
      cams: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
      mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
    }
  } catch {
    return { cams: [], mics: [] }
  }
}

/** True when a playing <video> is (almost) completely black, e.g. a closed privacy shutter or an idle virtual camera. */
export function isVideoBlack(v: HTMLVideoElement) {
  if (!v.videoWidth || v.readyState < 2) return false
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 18
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(v, 0, 0, 32, 18)
  const d = ctx.getImageData(0, 0, 32, 18).data
  let sum = 0
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
  return sum / (d.length / 4) / 3 < 6
}

/** Live 0..1 loudness for a stream, for meters and speaking rings. */
export class LevelMeter {
  private ctx: AudioContext
  private nodes = new Map<string, { src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Uint8Array<ArrayBuffer>; stream: MediaStream }>()

  constructor() {
    this.ctx = new AudioContext()
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  track(key: string, stream: MediaStream) {
    const existing = this.nodes.get(key)
    if (existing?.stream === stream) return
    this.untrack(key)
    if (!stream.getAudioTracks().length) return
    try {
      const src = this.ctx.createMediaStreamSource(stream)
      const an = this.ctx.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      this.nodes.set(key, { src, an, buf: new Uint8Array(new ArrayBuffer(an.fftSize)), stream })
    } catch {
      /* stream without usable audio */
    }
  }

  untrack(key: string) {
    const n = this.nodes.get(key)
    if (!n) return
    n.src.disconnect()
    this.nodes.delete(key)
  }

  level(key: string) {
    const n = this.nodes.get(key)
    if (!n) return 0
    if (!n.stream.getAudioTracks().some((t) => t.enabled && t.readyState === 'live')) return 0
    n.an.getByteTimeDomainData(n.buf)
    let sum = 0
    for (let i = 0; i < n.buf.length; i++) {
      const v = (n.buf[i] - 128) / 128
      sum += v * v
    }
    return Math.min(1, Math.sqrt(sum / n.buf.length) * 4)
  }

  close() {
    this.nodes.forEach((_, k) => this.untrack(k))
    this.ctx.close().catch(() => {})
  }
}
