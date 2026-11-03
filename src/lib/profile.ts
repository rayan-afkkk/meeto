import { Emitter, readJSON, writeJSON } from './store'

export type Profile = {
  name: string
  avatar: string | null // small JPEG data URL
  code: string // public friend code
  smoothShare: boolean // prefer frame rate over sharpness when sharing
  dataSaver: boolean
}

export type Friend = { code: string; name: string; avatar: string | null; since: number }
export type FriendRequest = { code: string; name: string; avatar: string | null; at: number }

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function randomCode(len: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export const PASTELS = ['peach', 'blue', 'green', 'mint', 'lilac', 'pink', 'butter'] as const
export type Pastel = (typeof PASTELS)[number]

export function pastelFor(seed: string): Pastel {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PASTELS[h % PASTELS.length]
}

class ProfileStore extends Emitter {
  profile: Profile
  friends: Friend[]
  requests: FriendRequest[]

  constructor() {
    super()
    const saved = readJSON<Partial<Profile>>('meeto.profile', {})
    this.profile = {
      name: saved.name ?? '',
      avatar: saved.avatar ?? null,
      code: saved.code ?? randomCode(8),
      smoothShare: saved.smoothShare ?? true,
      dataSaver: saved.dataSaver ?? false,
    }
    this.friends = readJSON<Friend[]>('meeto.friends', [])
    this.requests = readJSON<FriendRequest[]>('meeto.requests', [])
    writeJSON('meeto.profile', this.profile)
  }

  update(patch: Partial<Profile>) {
    this.profile = { ...this.profile, ...patch }
    writeJSON('meeto.profile', this.profile)
    this.emit()
  }

  isFriend(code: string) {
    return this.friends.some((f) => f.code === code)
  }

  addFriend(f: Omit<Friend, 'since'>) {
    if (f.code === this.profile.code) return
    const existing = this.friends.find((x) => x.code === f.code)
    if (existing) {
      existing.name = f.name || existing.name
      existing.avatar = f.avatar ?? existing.avatar
    } else {
      this.friends = [{ ...f, since: Date.now() }, ...this.friends]
    }
    this.requests = this.requests.filter((r) => r.code !== f.code)
    this.save()
  }

  removeFriend(code: string) {
    this.friends = this.friends.filter((f) => f.code !== code)
    this.save()
  }

  addRequest(r: Omit<FriendRequest, 'at'>) {
    if (this.isFriend(r.code) || r.code === this.profile.code) return false
    this.requests = [{ ...r, at: Date.now() }, ...this.requests.filter((x) => x.code !== r.code)]
    this.save()
    return true
  }

  dropRequest(code: string) {
    this.requests = this.requests.filter((r) => r.code !== code)
    this.save()
  }

  private save() {
    writeJSON('meeto.friends', this.friends)
    writeJSON('meeto.requests', this.requests)
    this.emit()
  }
}

export const profileStore = new ProfileStore()

/** Center-crop and shrink a picked image to a small square JPEG so it is cheap to send to peers. */
export async function imageToAvatar(file: File, size = 192): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}
