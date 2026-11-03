# Meeto

Open-source video meetings for web and desktop, built on WebRTC.

> Status: design phase. UI mockups are done; implementation has not started.

## Why Meeto instead of Zoom

| | Zoom (free) | Meeto |
|---|---|---|
| Join as a guest | App or account usually pushed | Click a link in any browser. No account, no install |
| Encryption | E2EE is opt-in and turns off some features | End-to-end encrypted by default (WebRTC Encoded Transforms / SFrame) |
| Time limit | 40 min for group calls | None |
| Captions & notes | Cloud AI, paid tiers | Run **on your device** (Whisper + small LLM via WebGPU). Audio never leaves your machine |
| Joining late | You missed it | "Catch me up": a summary of what you missed |
| After the call | Recording | Auto recap: summary, decisions, action items, searchable transcript, export to Markdown / GitHub Issues |
| Bad network | Video freezes | Audio-first low-bandwidth mode, simulcast + adaptive layers |
| Hosting | Closed SaaS | Self-host with one `docker compose up` |

## Do you need Firebase or user accounts?

**No to both.**

- **Accounts:** guests only need a display name and a room link. Accounts are optional, added later only for
  scheduling, saved recaps and room ownership (e.g. with Auth.js or Supabase Auth).
- **Firebase:** not needed. WebRTC needs four things, and every one has an open-source, self-hostable option:

| Piece | What it does | Choice |
|---|---|---|
| Signaling | Lets peers find each other and swap offers/ICE candidates | Built into the SFU (LiveKit) — or a tiny WebSocket server |
| STUN | Finds your public IP | Public STUN or coturn |
| TURN | Relays media when firewalls block direct links (~10–20% of users) | coturn (self-hosted) |
| SFU | Forwards video so 3+ people don't each upload N streams | **LiveKit** (Apache-2.0) |

Plain peer-to-peer "mesh" only works well for 2–4 people. An SFU is what makes 10–50 person calls possible.

## Planned stack

- **Web app:** React + TypeScript + Vite, Tailwind
- **Media:** LiveKit server + `livekit-client` (SFU, signaling, simulcast, E2EE)
- **TURN:** coturn
- **On-device AI:** Whisper (WebGPU / WASM) for captions; a small local LLM for summaries
- **Desktop:** Electron wrapper around the same web app (stable WebRTC on every OS, screen-share picker)
- **Deploy:** Docker Compose (web + LiveKit + coturn + Redis)

## Design

Black background, warm cream text, a tall serif for headings (Instrument Serif) over a clean sans (DM Sans),
soft pastel tiles and pills with big rounded corners. Icons and colour do the talking, not paragraphs.

| Token | Value |
|---|---|
| Background | `#000000` |
| Card | `#1A1815` (border `#2A2622`) |
| Text / primary button | `#F4EEE4` |
| Muted text | `#A39E95` |
| Accent | `#FF6B3D` |
| Pastels | peach `#F9D2B4`, blue `#C9DBF7`, green `#CFEBC0`, mint `#C8EEDD`, lilac `#DCC8F3`, pink `#F5C6C0`, butter `#F7E2A8` |

## Screens (mockups)

1. Home: big pastel tiles (New meeting, Join, Schedule, Share screen), quick rooms, up next
2. Lobby: camera preview, name, one-tap toggles (captions, blur, data saver)
3. In call: pastel video tiles, floating control dock, live captions, AI notes, "Catch me up"
4. Screen share: 1080p/60fps share, live drawing tools, laser pointer, filmstrip
5. Recap: one-line summary, to-dos, decisions, who talked, chapters
6. Mobile home
7. Mobile call

## Roadmap

1. **MVP:** rooms by link, audio/video, mute/camera, screen share, chat, LiveKit + coturn in Docker
2. **Better than Zoom:** E2EE on by default, raise-hand queue, low-bandwidth mode, live captions
3. **AI layer:** on-device notes, Catch me up, auto recap and export
4. **Desktop:** Electron build for macOS, Windows and Linux
5. **Optional accounts:** scheduling, saved recaps, room ownership

## License

MIT (planned)
