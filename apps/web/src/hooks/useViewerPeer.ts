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
  localAt: number // performance.now() at receipt
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

  // --- video reconciliation -------------------------------------------------
  const reconcile = useCallback(() => {
    const v = videoRef.current
    const h = lastHost.current
    if (!v || !h) return

    const expected = h.paused
      ? h.time
      : h.time + ((performance.now() - h.localAt) / 1000) * h.rate

    if (Math.abs(v.currentTime - expected) > DRIFT_TOLERANCE) {
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
      switch (msg.type) {
        case 'source':
          setSourceUrl(msg.url)
          return
        case 'state':
          lastHost.current = { time: msg.time, paused: msg.paused, rate: msg.rate, localAt: now }
          break
        case 'play':
          lastHost.current = { time: msg.time, paused: false, rate: msg.rate, localAt: now }
          break
        case 'pause':
          lastHost.current = { time: msg.time, paused: true, rate: lastHost.current?.rate ?? 1, localAt: now }
          break
        case 'seek':
          lastHost.current = { time: msg.time, paused: msg.paused, rate: lastHost.current?.rate ?? 1, localAt: now }
          break
        case 'rate':
          if (lastHost.current) lastHost.current = { ...lastHost.current, rate: msg.rate, localAt: now }
          break
      }
      reconcile()
      setStatus((s) => (s === 'connecting' || s === 'reconnecting' ? 'connected' : s))
    },
    [reconcile],
  )

  const wireChannel = useCallback(
    (dc: RTCDataChannel) => {
      dc.onmessage = (e) => {
        try {
          applySync(JSON.parse(e.data as string) as SyncMessage)
        } catch {
          /* ignore malformed */
        }
      }
    },
    [applySync],
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
    const onWaiting = () => setStatus('buffering')
    const onPlaying = () => {
      reconcile()
      setStatus((s) => (s === 'buffering' ? 'connected' : s))
    }
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('playing', onPlaying)
    return () => {
      clearInterval(loop)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('playing', onPlaying)
    }
  }, [videoRef, reconcile])

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
