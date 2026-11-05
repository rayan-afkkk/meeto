/*
 * Rooms are "owned" by whoever created them, without any server or account.
 *
 * Creating a room makes an ECDSA key pair. The room id is a hash of the public key,
 * so only the holder of the private key can prove they are the host: they sign
 * "roomId:peerId" and everyone checks the signature and that the key hashes to the room id.
 */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const ALGO = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function roomIdFromKey(pub: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', pub))
  return Array.from(hash.slice(0, 6), (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/** Room codes are 6 easy characters ("k7m2qp" -> "k7m-2qp"). Older 10-character codes still work. */
export const isRoomId = (id: string) => /^[a-z0-9]{6}$|^[a-z0-9]{10}$/.test(id)

export const prettyRoomId = (id: string) =>
  id.length === 6 ? `${id.slice(0, 3)}-${id.slice(3)}` : `${id.slice(0, 3)}-${id.slice(3, 7)}-${id.slice(7)}`

/** Accepts a code typed any way ("K7M 2QP", "k7m-2qp") or a full link, returns the bare room id or null. */
export function parseRoomInput(input: string): string | null {
  const lower = input.trim().toLowerCase()
  const fromLink = lower.match(/r\/([a-z0-9-]+)/)
  const raw = (fromLink ? fromLink[1] : lower).replace(/[^a-z0-9]/g, '')
  return isRoomId(raw) ? raw : null
}

type StoredHost = { priv: JsonWebKey; pub: string }

export async function createHostedRoom(): Promise<string> {
  const kp = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const roomId = await roomIdFromKey(pub)
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey)
  localStorage.setItem(`meeto.host.${roomId}`, JSON.stringify({ priv, pub: toB64(pub) } satisfies StoredHost))
  return roomId
}

export type HostProof = { pub: string; sig: string }

export async function makeHostProof(roomId: string, peerId: string): Promise<HostProof | null> {
  const raw = localStorage.getItem(`meeto.host.${roomId}`)
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as StoredHost
    const key = await crypto.subtle.importKey('jwk', stored.priv, ALGO, false, ['sign'])
    const sig = new Uint8Array(await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(`${roomId}:${peerId}`)))
    return { pub: stored.pub, sig: toB64(sig) }
  } catch {
    return null
  }
}

export async function verifyHostProof(roomId: string, peerId: string, proof: HostProof): Promise<boolean> {
  try {
    const pub = fromB64(proof.pub)
    if ((await roomIdFromKey(pub)) !== roomId) return false
    const key = await crypto.subtle.importKey('raw', pub, ALGO, false, ['verify'])
    return await crypto.subtle.verify(SIGN, key, fromB64(proof.sig), new TextEncoder().encode(`${roomId}:${peerId}`))
  } catch {
    return false
  }
}
