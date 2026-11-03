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

## Screens (mockups)

1. Home: new meeting / join with code, upcoming meetings, recent recaps
2. Pre-join lobby: camera and mic check, name, no account needed
3. In call: grid, live captions, raise-hand queue, AI notes side panel, "Catch me up"
4. Recap: summary, chapters, decisions, action items, transcript
5. Mobile in-call

## Roadmap

1. **MVP:** rooms by link, audio/video, mute/camera, screen share, chat, LiveKit + coturn in Docker
2. **Better than Zoom:** E2EE on by default, raise-hand queue, low-bandwidth mode, live captions
3. **AI layer:** on-device notes, Catch me up, auto recap and export
4. **Desktop:** Electron build for macOS, Windows and Linux
5. **Optional accounts:** scheduling, saved recaps, room ownership

## License

MIT (planned)
