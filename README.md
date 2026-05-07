# P2P Chat — WebRTC DataChannel

Live demo: https://non-s.github.io/Profile-

## What it is

A real peer-to-peer chat that runs entirely in the browser. No server. No SDK. No relay. Two browsers negotiate a direct encrypted connection using the WebRTC standard and then exchange messages through a DataChannel.

## How it works

WebRTC requires a signaling step before the direct connection can be established. Normally this uses a WebSocket server. Here, signaling is done manually: connection parameters are encoded as base64 strings and exchanged via copy-paste.

### Connection flow

```
Peer A                          Peer B
  │                               │
  │  createOffer()                │
  │  setLocalDescription          │
  │  waitForICE()                 │
  │  → btoa(localDesc) ──────────►│
  │                               │  setRemoteDescription(offer)
  │                               │  createAnswer()
  │                               │  setLocalDescription
  │                               │  waitForICE()
  │◄──────────── btoa(localDesc) ─│
  │  setRemoteDescription(answer) │
  │  ICE connectivity checks...   │
  │◄═══════════ DataChannel ═════►│  DTLS-SRTP encrypted
```

### ICE gathering

`waitForICE` waits for the browser to gather all ICE candidates (local addresses + STUN-discovered public addresses) before the SDP is base64-encoded. This produces a single self-contained string that encodes both the session description and all candidates — so no trickle ICE is needed for the signaling step.

```js
function waitForICE(pc) {
    return new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const handler = () => {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', handler);
                resolve();
            }
        };
        pc.addEventListener('icegatheringstatechange', handler);
        setTimeout(resolve, 4000); // fallback — partial candidates still work
    });
}
```

### STUN servers

Used only to discover the public IP/port. No media passes through them. The two Google STUN servers are included as fallback; only one needs to respond.

### DataChannel

Messages are JSON-encoded `{ author, text }` objects. The channel is ordered (`{ ordered: true }`) which gives TCP-like reliability over the underlying DTLS-SRTP transport.

### Demo mode

If WebRTC is unavailable (sandboxed environment, old browser) or the user just wants to see the interface, `/demo` starts a simulated session with a fake peer sending pre-canned messages at random intervals.

## Security

The DataChannel is encrypted with DTLS-SRTP. The SDP strings exchanged during signaling contain session fingerprints that authenticate each endpoint. A passive observer who intercepts the base64 codes cannot inject themselves into the channel.

## Files

```
Profile-/
├── index.html   — terminal layout, sidebar with SDP exchange UI
├── style.css    — dark green terminal aesthetic, status indicators
├── script.js    — WebRTC core: createOffer, joinSession, confirmAnswer
└── README.md
```

No build step. No dependencies. Standard browser WebRTC API only.
