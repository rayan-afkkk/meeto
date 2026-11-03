import { joinRoom, type JsonValue, type Room } from 'trystero'
import { Emitter } from './store'
import { profileStore } from './profile'
import { p2pConfig, toast } from './platform'

/*
 * Friends without a server: every app listens in a tiny P2P "inbox" room named after
 * its friend code. To reach a friend we briefly join their inbox, drop a message,
 * wait for an acknowledgement and leave. If nobody answers, they are offline.
 */

const APP_ID = 'meeto-inbox-v1'
type Who = { code: string; name: string; avatar: string | null }
type InboxMsg =
  | { type: 'request' | 'accept' | 'ping'; from: Who }
  | { type: 'invite'; from: Who; roomId: string; title: string }
  | { type: 'ack'; from: Who }

export type IncomingCall = { from: Who; roomId: string; title: string }

const me = (): Who => {
  const p = profileStore.profile
  return { code: p.code, name: p.name || 'Guest', avatar: p.avatar }
}
const cleanWho = (w: Who): Who => ({
  code: String(w?.code ?? '').slice(0, 16),
  name: String(w?.name ?? 'Friend').slice(0, 40),
  avatar: typeof w?.avatar === 'string' && w.avatar.startsWith('data:image/') ? w.avatar : null,
})

class Inbox extends Emitter {
  online = new Map<string, boolean>()
  checking = false
  incoming: IncomingCall | null = null
  private room: Room | null = null

  start() {
    if (this.room) return
    try {
      this.room = joinRoom(p2pConfig(APP_ID), `inbox-${profileStore.profile.code}`)
    } catch {
      return
    }
    const action = this.room.makeAction<JsonValue>('msg', {
      onMessage: (d, { peerId }) => {
        const m = d as unknown as InboxMsg
        if (!m || m.type === 'ack') return
        const from = cleanWho(m.from)
        if (!from.code || from.code === profileStore.profile.code) return
        void action.send({ type: 'ack', from: me() } as unknown as JsonValue, { target: peerId })
        this.online.set(from.code, true)
        if (m.type === 'request') {
          if (profileStore.isFriend(from.code)) {
            void this.send(from.code, { type: 'accept', from: me() })
          } else if (profileStore.addRequest(from)) {
            toast(`${from.name} sent you a friend request`)
          }
        } else if (m.type === 'accept') {
          profileStore.addFriend(from)
          toast(`You and ${from.name} are now friends`)
        } else if (m.type === 'invite' && profileStore.isFriend(from.code)) {
          this.incoming = { from, roomId: String(m.roomId), title: String(m.title || 'Call').slice(0, 60) }
        }
        this.emit()
      },
    })
  }

  /** Deliver a message to someone's inbox. Resolves true if they were online to receive it. */
  send(code: string, msg: InboxMsg, timeoutMs = 12000): Promise<boolean> {
    if (code === profileStore.profile.code) return Promise.resolve(false)
    return new Promise((resolve) => {
      let done = false
      const temp = joinRoom(p2pConfig(APP_ID), `inbox-${code}`)
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        clearTimeout(timer)
        void temp.leave().catch(() => {})
        resolve(ok)
      }
      const action = temp.makeAction<JsonValue>('msg', {
        onMessage: (d) => {
          const m = d as unknown as InboxMsg
          if (m?.type === 'ack' && m.from?.code === code) finish(true)
        },
      })
      temp.onPeerJoin = (peerId) => void action.send(msg as unknown as JsonValue, { target: peerId })
      const timer = setTimeout(() => finish(false), timeoutMs)
    })
  }

  async sendRequest(code: string) {
    const ok = await this.send(code, { type: 'request', from: me() })
    this.online.set(code, ok)
    this.emit()
    return ok
  }

  async accept(code: string) {
    const req = profileStore.requests.find((r) => r.code === code)
    if (req) profileStore.addFriend(req)
    const ok = await this.send(code, { type: 'accept', from: me() })
    this.online.set(code, ok)
    this.emit()
  }

  async invite(code: string, roomId: string, title: string) {
    return this.send(code, { type: 'invite', from: me(), roomId, title }, 20000)
  }

  async refreshOnline() {
    if (this.checking) return
    this.checking = true
    this.emit()
    const friends = profileStore.friends.slice(0, 24)
    await Promise.all(
      friends.map(async (f) => {
        const ok = await this.send(f.code, { type: 'ping', from: me() }, 9000)
        this.online.set(f.code, ok)
        this.emit()
      }),
    )
    this.checking = false
    this.emit()
  }

  clearIncoming() {
    this.incoming = null
    this.emit()
  }
}

export const inbox = new Inbox()
