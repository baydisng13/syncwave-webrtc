import { useCallback, useEffect, useRef, useState } from 'react'
import { useSocket } from './useSocket'
import { DRIFT_TOLERANCE, RTC_CONFIG, randomId } from '~/lib/rtc'
import { HOST_ID } from '@syncwave/shared'
import type { SignalMessage, SyncMessage } from '@syncwave/shared'

export type ViewerStatus =
  | 'connecting'
  | 'connected'
  | 'buffering'
  | 'reconnecting'
  | 'closed'

export interface ViewerState {
  status: ViewerStatus
  /** Video URL received from the host over the data channel. */
  sourceUrl: string | null
  /** True when autoplay was blocked and a user gesture is required. */
  needsGesture: boolean
  /** Call from a click handler to satisfy autoplay policy. */
  resume: () => void
}

interface HostSnapshot {
  time: number
  paused: boolean
  rate: number
  hostAt: number // host Date.now() when the msg was sent (for latency comp.)
  localAt: number // performance.now() at receipt (fallback pre-clock-sync)
}

/**
 * Viewer side: answers the host's offer, then slaves the local <video> to the
 * host snapshot stream — correcting drift and catching up after buffering.
 */
export function useViewerPeer(
  roomId: string,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): ViewerState {
  // Stable across StrictMode remounts / refreshes so the host tracks one peer
  // identity instead of a churn of throwaway ids.
  const [self] = useState(() => {
    try {
      const key = `sw-viewer-${roomId}`
      let v = sessionStorage.getItem(key)
      if (!v) {
        v = randomId(10)
        sessionStorage.setItem(key, v)
      }
      return v
    } catch {
      return randomId(10)
    }
  })
  const [status, setStatus] = useState<ViewerStatus>('connecting')
  const [needsGesture, setNeedsGesture] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const hasRemote = useRef(false)
  const pendingIce = useRef<RTCIceCandidateInit[]>([])
  const lastHost = useRef<HostSnapshot | null>(null)
  const sendRef = useRef<ReturnType<typeof useSocket>['send']>(() => {})
  const dcRef = useRef<RTCDataChannel | null>(null)
  // performance.now() + clockOffset ≈ host Date.now(). null until first pong.
  const clockOffset = useRef<number | null>(null)
  const bestRtt = useRef<number>(Infinity)

  // --- video reconciliation -------------------------------------------------
  // Where the host is *right now*. When clock-sync has landed we anchor to the
  // host's own send timestamp (msg.at) + estimated one-way latency, so we place
  // playback where the host actually is — not where it was when the packet
  // left. Pre-sync we fall back to "elapsed since receipt".
  const expectedTime = (h: HostSnapshot): number => {
    if (h.paused) return h.time
    const elapsedMs =
      clockOffset.current != null
        ? performance.now() + clockOffset.current - h.hostAt
        : performance.now() - h.localAt
    return h.time + (Math.max(0, elapsedMs) / 1000) * h.rate
  }

  // `hard` = snap currentTime exactly (user actions: play/pause/seek). Soft
  // reconcile only corrects when drift exceeds tolerance, so the periodic loop
  // and heartbeat don't fight normal decode jitter.
  const reconcile = useCallback((hard = false) => {
    const v = videoRef.current
    const h = lastHost.current
    if (!v || !h) return

    const expected = expectedTime(h)
    if (hard || Math.abs(v.currentTime - expected) > DRIFT_TOLERANCE) {
      v.currentTime = expected
    }
    if (v.playbackRate !== h.rate) v.playbackRate = h.rate

    if (h.paused && !v.paused) v.pause()
    if (!h.paused && v.paused) {
      v.play().then(
        () => setNeedsGesture(false),
        () => setNeedsGesture(true), // autoplay blocked → need a click
      )
    }
  }, [videoRef])

  const applySync = useCallback(
    (msg: SyncMessage) => {
      const now = performance.now()
      // `hard` snaps currentTime exactly — reserved for host user actions.
      let hard = false
      switch (msg.type) {
        case 'source':
          setSourceUrl(msg.url)
          return
        case 'pong': {
          // Clock-sync: keep the min-RTT sample. hostClock@receipt ≈ hostAt +
          // rtt/2, so offset maps performance.now() → host Date.now().
          const rtt = now - msg.t0
          if (rtt < bestRtt.current) {
            bestRtt.current = rtt
            clockOffset.current = msg.hostAt + rtt / 2 - now
          }
          return
        }
        case 'ping':
          return // viewer never receives these
        case 'state':
          lastHost.current = { time: msg.time, paused: msg.paused, rate: msg.rate, hostAt: msg.at, localAt: now }
          break
        case 'play':
          hard = true
          lastHost.current = { time: msg.time, paused: false, rate: msg.rate, hostAt: msg.at, localAt: now }
          break
        case 'pause':
          hard = true
          lastHost.current = { time: msg.time, paused: true, rate: lastHost.current?.rate ?? 1, hostAt: msg.at, localAt: now }
          break
        case 'seek':
          hard = true
          lastHost.current = { time: msg.time, paused: msg.paused, rate: lastHost.current?.rate ?? 1, hostAt: msg.at, localAt: now }
          break
        case 'rate':
          if (lastHost.current) lastHost.current = { ...lastHost.current, rate: msg.rate, hostAt: msg.at, localAt: now }
          break
      }
      reconcile(hard)
      setStatus((s) => (s === 'connecting' || s === 'reconnecting' ? 'connected' : s))
    },
    [reconcile],
  )

  // Fire a short burst of clock-sync probes, keeping the min-RTT estimate.
  const syncClock = useCallback(() => {
    let n = 0
    const ping = () => {
      const dc = dcRef.current
      if (!dc || dc.readyState !== 'open') return
      try {
        dc.send(JSON.stringify({ type: 'ping', t0: performance.now() } satisfies SyncMessage))
      } catch {
        return
      }
      if (++n < 5) setTimeout(ping, 300)
    }
    ping()
  }, [])

  const wireChannel = useCallback(
    (dc: RTCDataChannel) => {
      dcRef.current = dc
      bestRtt.current = Infinity // re-measure fresh network on each channel
      dc.onmessage = (e) => {
        try {
          applySync(JSON.parse(e.data as string) as SyncMessage)
        } catch {
          /* ignore malformed */
        }
      }
      if (dc.readyState === 'open') syncClock()
      else dc.onopen = syncClock
    },
    [applySync, syncClock],
  )

  // --- signaling ------------------------------------------------------------
  const buildPeer = useCallback(() => {
    const pc = new RTCPeerConnection(RTC_CONFIG)
    pcRef.current = pc
    hasRemote.current = false
    // NB: do NOT clear pendingIce here — the host's fastest (mDNS host)
    // candidates can arrive just before the offer is processed, i.e. before
    // this pc exists. Those are buffered by the 'ice' handler and must survive
    // into the pc we just built, else the only viable same-machine pair
    // (host↔host) never forms and ICE fails.

    pc.ondatachannel = (e) => wireChannel(e.channel)
    pc.onicecandidate = (e) => {
      if (e.candidate) sendRef.current(HOST_ID, 'ice', e.candidate.toJSON())
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') setStatus('connected')
      else if (st === 'disconnected' || st === 'failed') {
        setStatus('reconnecting')
        // Ask the host for a fresh offer.
        sendRef.current(HOST_ID, 'join')
      } else if (st === 'closed') setStatus('closed')
    }
    return pc
  }, [wireChannel])

  const handleSignal = useCallback(
    (msg: SignalMessage) => {
      if (msg.from !== HOST_ID) return
      switch (msg.kind) {
        case 'offer': {
          // Each offer is a fresh host session — tear down any prior pc so we
          // never apply two remote offers to one connection (glare → stall).
          pcRef.current?.close()
          const pc = buildPeer()
          void pc
            .setRemoteDescription(msg.payload as RTCSessionDescriptionInit)
            .then(() => {
              hasRemote.current = true
              for (const c of pendingIce.current) void pc.addIceCandidate(c).catch(() => {})
              pendingIce.current = []
              return pc.createAnswer()
            })
            .then((answer) => pc.setLocalDescription(answer))
            .then(() => {
              const d = pc.localDescription
              if (d) sendRef.current(HOST_ID, 'answer', { type: d.type, sdp: d.sdp })
            })
            .catch(() => {})
          break
        }
        case 'ice': {
          const pc = pcRef.current
          const cand = msg.payload as RTCIceCandidateInit | null
          if (!cand) break
          // Buffer whenever the pc isn't ready to take it yet — no pc built, or
          // remote description not set — instead of dropping. Flushed once the
          // offer's setRemoteDescription resolves.
          if (pc && hasRemote.current) void pc.addIceCandidate(cand).catch(() => {})
          else pendingIce.current.push(cand)
          break
        }
        case 'bye': {
          // Host dropped its socket — surface it; the peer will also fail soon.
          setStatus('closed')
          break
        }
      }
    },
    [buildPeer],
  )

  const { send } = useSocket(roomId, self, handleSignal)
  sendRef.current = send

  // Announce presence until connected; keep nudging the host.
  useEffect(() => {
    send(HOST_ID, 'join')
    const t = setInterval(() => {
      // Only re-announce when there is no in-flight or live connection —
      // rejoining mid-'connecting' would reset ICE before it can complete.
      const st = pcRef.current?.connectionState
      if (!pcRef.current || st === 'failed' || st === 'disconnected' || st === 'closed') {
        send(HOST_ID, 'join')
      }
    }, 3000)
    return () => clearInterval(t)
  }, [send])

  // Drift correction + buffering handling.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const loop = setInterval(reconcile, 500)
    const resync = setInterval(syncClock, 15000) // track clock drift over time
    const onWaiting = () => setStatus('buffering')
    const onPlaying = () => {
      reconcile()
      setStatus((s) => (s === 'buffering' ? 'connected' : s))
    }
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('playing', onPlaying)
    return () => {
      clearInterval(loop)
      clearInterval(resync)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('playing', onPlaying)
    }
  }, [videoRef, reconcile, syncClock])

  // Say goodbye + tear down.
  useEffect(() => {
    return () => {
      sendRef.current(HOST_ID, 'bye')
      pcRef.current?.close()
    }
  }, [])

  const resume = useCallback(() => {
    setNeedsGesture(false)
    reconcile()
  }, [reconcile])

  return { status, sourceUrl, needsGesture, resume }
}
