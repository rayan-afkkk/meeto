/** Get camera + mic, falling back gracefully when one of them is missing or blocked. */
export async function getLocalMedia(dataSaver: boolean): Promise<{ stream: MediaStream; error: string | null }> {
  const video: MediaTrackConstraints = dataSaver
    ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) return { stream: new MediaStream(), error: 'This browser cannot use a camera or microphone.' }
  for (const c of [{ video, audio }, { audio }, { video }] as MediaStreamConstraints[]) {
    try {
      const stream = await md.getUserMedia(c)
      stream.getVideoTracks().forEach((t) => (t.contentHint = 'motion'))
      const missing = !c.video ? 'camera' : !c.audio ? 'microphone' : null
      return { stream, error: missing ? `No ${missing} available. You can still join.` : null }
    } catch {
      /* try the next combination */
    }
  }
  return { stream: new MediaStream(), error: 'Camera and microphone are blocked. You can still join and chat.' }
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
