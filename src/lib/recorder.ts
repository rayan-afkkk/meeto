import type { Meeting } from './meeting'
import { pastelFor } from './profile'

const PASTEL_HEX: Record<string, [string, string]> = {
  peach: ['#f9d2b4', '#8a3a0c'], blue: ['#c9dbf7', '#1e4a9a'], green: ['#cfebc0', '#2c6419'], mint: ['#c8eedd', '#145e42'],
  lilac: ['#dcc8f3', '#5426a0'], pink: ['#f5c6c0', '#8e1f24'], butter: ['#f7e2a8', '#6a4700'],
}

/**
 * Records the meeting locally: draws everyone (or the shared screen) onto a canvas
 * and mixes every voice, then saves a .webm file. Nothing is uploaded anywhere.
 */
export class Recorder {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private videos = new Map<MediaStream, HTMLVideoElement>()
  private audioCtx = new AudioContext()
  private dest = this.audioCtx.createMediaStreamDestination()
  private mixed = new Set<MediaStream>()
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private timer = 0

  constructor(private meeting: Meeting) {
    this.canvas.width = 1280
    this.canvas.height = 720
  }

  start() {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t))
    const stream = new MediaStream([...this.canvas.captureStream(30).getVideoTracks(), ...this.dest.stream.getAudioTracks()])
    this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_500_000 })
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.rec.start(1000)
    this.timer = window.setInterval(() => this.draw(), 1000 / 30)
  }

  async stopAndSave(filename: string) {
    clearInterval(this.timer)
    const rec = this.rec
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve()
        rec.stop()
      })
    }
    this.videos.forEach((v) => (v.srcObject = null))
    this.audioCtx.close().catch(() => {})
    const blob = new Blob(this.chunks, { type: 'video/webm' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  private videoFor(stream: MediaStream) {
    let v = this.videos.get(stream)
    if (!v) {
      v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.srcObject = stream
      v.play().catch(() => {})
      this.videos.set(stream, v)
    }
    return v
  }

  private mixAudio(streams: MediaStream[]) {
    for (const s of streams) {
      if (this.mixed.has(s) || !s.getAudioTracks().length) continue
      try {
        this.audioCtx.createMediaStreamSource(s).connect(this.dest)
        this.mixed.add(s)
      } catch {
        /* ignore */
      }
    }
  }

  private draw() {
    const { tiles, share, audio } = this.meeting.mediaForRecording()
    this.mixAudio(audio)
    const { ctx } = this
    const W = this.canvas.width
    const H = this.canvas.height
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    if (share) {
      const strip = 200
      this.drawVideo(this.videoFor(share), 16, 16, W - strip - 40, H - 32, 'contain')
      const shown = tiles.slice(0, 4)
      const th = (H - 32 - (shown.length - 1) * 12) / Math.max(shown.length, 1)
      shown.forEach((t, i) => this.drawTile(t, W - strip - 16, 16 + i * (Math.min(th, 150) + 12), strip, Math.min(th, 150)))
    } else {
      const n = tiles.length
      const cols = Math.ceil(Math.sqrt(n))
      const rows = Math.ceil(n / cols)
      const gap = 12
      const tw = (W - 32 - (cols - 1) * gap) / cols
      const th = (H - 32 - (rows - 1) * gap) / rows
      tiles.forEach((t, i) => this.drawTile(t, 16 + (i % cols) * (tw + gap), 16 + Math.floor(i / cols) * (th + gap), tw, th))
    }
    // REC badge
    ctx.fillStyle = 'rgba(255,90,78,.9)'
    this.round(W - 92, 24, 68, 28, 14)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '700 14px "DM Sans", sans-serif'
    ctx.fillText('● REC', W - 82, 43)
  }

  private drawTile(t: { key: string; name: string; stream: MediaStream | null; cam: boolean }, x: number, y: number, w: number, h: number) {
    const { ctx } = this
    const [bg, ink] = PASTEL_HEX[pastelFor(t.key === 'self' ? this.meeting.selfId : t.key)]
    ctx.save()
    this.round(x, y, w, h, 22)
    ctx.clip()
    ctx.fillStyle = bg
    ctx.fillRect(x, y, w, h)
    if (t.cam && t.stream?.getVideoTracks().length) {
      this.drawVideo(this.videoFor(t.stream), x, y, w, h, 'cover', t.key === 'self')
    } else {
      ctx.fillStyle = ink
      ctx.font = `${Math.round(Math.min(w, h) * 0.32)}px "Instrument Serif", serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText((t.name[0] || '?').toUpperCase(), x + w / 2, y + h / 2)
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
    }
    ctx.restore()
    ctx.font = '600 14px "DM Sans", sans-serif'
    const label = t.name.slice(0, 24)
    const lw = ctx.measureText(label).width + 22
    ctx.fillStyle = 'rgba(0,0,0,.6)'
    this.round(x + 10, y + h - 38, lw, 28, 14)
    ctx.fill()
    ctx.fillStyle = '#f4eee4'
    ctx.fillText(label, x + 21, y + h - 19)
  }

  private drawVideo(v: HTMLVideoElement, x: number, y: number, w: number, h: number, fit: 'cover' | 'contain', mirror = false) {
    const vw = v.videoWidth
    const vh = v.videoHeight
    if (!vw || !vh) return
    const scale = fit === 'cover' ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh)
    const dw = vw * scale
    const dh = vh * scale
    const { ctx } = this
    ctx.save()
    if (mirror) {
      ctx.translate(x + w / 2, 0)
      ctx.scale(-1, 1)
      ctx.translate(-(x + w / 2), 0)
    }
    ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    ctx.restore()
  }

  private round(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
  }
}
