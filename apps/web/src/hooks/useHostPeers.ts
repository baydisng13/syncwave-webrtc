import { useCallback, useEffect, useRef, useState } from 'react'
import { useSocket } from './useSocket'
import { HEARTBEAT_MS, RTC_CONFIG } from '~/lib/rtc'
import { HOST_ID } from '@syncwave/shared'
import type { SignalMessage, SyncMessage } from '@syncwave/shared'

interface PeerRec {
  pc: RTCPeerConnection
  dc: RTCDataChannel
  hasRemote: boolean
  pendingIce: RTCIceCandidateInit[]
}

export interface HostState {
  viewerCount: number
  /** viewerId → RTCPeerConnectionState, for the host UI. */
  peers: Record<string, RTCPeerConnectionState>
}

/**
 * Host side: authoritative broadcaster. Creates an offer per joining viewer,
 * owns a data channel to each, and mirrors the host <video> DOM events out to
 * every connected viewer.
 */
export function useHostPeers(
  roomId: string,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string,
): HostState {
  const srcRef = useRef(src)
  srcRef.current = src

  const peers = useRef<Map<string, PeerRec>>(new Map())
  const [state, setState] = useState<HostState>({ viewerCount: 0, peers: {} })

  const syncStates = useCallback(() => {
    const map: Record<string, RTCPeerConnectionState> = {}
    let connected = 0
    for (const [id, rec] of peers.current) {
      map[id] = rec.pc.connectionState
      if (rec.dc.readyState === 'open') connected++
    }
    setState({ viewerCount: connected, peers: map })
  }, [])

  const snapshot = useCallback((): SyncMessage => {
    const v = videoRef.current
    return {
      type: 'state',
      time: v?.currentTime ?? 0,
      paused: v?.paused ?? true,
      rate: v?.playbackRate ?? 1,
      at: Date.now(),
    }
  }, [videoRef])

  const broadcast = useCallback((msg: SyncMessage) => {
    const data = JSON.stringify(msg)
    for (const rec of peers.current.values()) {
      if (rec.dc.readyState === 'open') {
        try {
          rec.dc.send(data)
        } catch {
          /* channel closing */
        }
      }
    }
  }, [])

  // Ref so signaling handler always sees the latest createPeer without
  // re-subscribing the socket.
  const createPeerRef = useRef<(viewerId: string) => void>(() => {})

  const handleSignal = useCallback(
    (msg: SignalMessage) => {
      const rec = peers.current.get(msg.from)
      switch (msg.kind) {
        case 'join': {
          const existing = peers.current.get(msg.from)
          // Only (re)build for a viewer with no peer or a dead one. A handshake
          // in flight ('new' / 'connecting') must be left alone — tearing it
          // down on every re-announce is what caused the connect→fail→retry
          // thrash and stopped ICE from ever completing.
          const st = existing?.pc.connectionState
          if (st === 'connected' || st === 'connecting' || st === 'new') break
          existing?.pc.close()
          peers.current.delete(msg.from)
          createPeerRef.current(msg.from)
          break
        }
        case 'answer': {
          if (rec && msg.payload) {
            void rec.pc
              .setRemoteDescription(msg.payload as RTCSessionDescriptionInit)
              .then(() => {
                rec.hasRemote = true
                for (const c of rec.pendingIce) void rec.pc.addIceCandidate(c)
                rec.pendingIce = []
              })
              .catch(() => {})
          }
          break
        }
        case 'ice': {
          if (rec && msg.payload) {
            const cand = msg.payload as RTCIceCandidateInit
            if (rec.hasRemote) void rec.pc.addIceCandidate(cand).catch(() => {})
            else rec.pendingIce.push(cand)
          }
          break
        }
        case 'bye': {
          rec?.pc.close()
          peers.current.delete(msg.from)
          syncStates()
          break
        }
      }
    },
    [syncStates],
  )

  const { send } = useSocket(roomId, HOST_ID, handleSignal)

  // Build a fresh peer connection + offer for one viewer.
  createPeerRef.current = useCallback(
    (viewerId: string) => {
      const pc = new RTCPeerConnection(RTC_CONFIG)
      const dc = pc.createDataChannel('sync')
      const rec: PeerRec = { pc, dc, hasRemote: false, pendingIce: [] }
      peers.current.set(viewerId, rec)

      dc.onopen = () => {
        try {
          dc.send(JSON.stringify({ type: 'source', url: srcRef.current }))
          dc.send(JSON.stringify(snapshot()))
        } catch {
          /* noop */
        }
        syncStates()
      }
      dc.onclose = syncStates

      // Answer viewer clock-sync probes so they can compensate for one-way
      // latency. Reply carries the host wall-clock at reply time.
      dc.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data as string) as SyncMessage
          if (m.type === 'ping') {
            dc.send(JSON.stringify({ type: 'pong', t0: m.t0, hostAt: Date.now() }))
          }
        } catch {
          /* ignore malformed */
        }
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) send(viewerId, 'ice', e.candidate.toJSON())
      }
      pc.onconnectionstatechange = () => {
        syncStates()
        if (['failed', 'closed'].includes(pc.connectionState)) {
          peers.current.delete(viewerId)
          syncStates()
        }
      }

      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          const d = pc.localDescription
          if (d) send(viewerId, 'offer', { type: d.type, sdp: d.sdp })
        })
        .catch(() => {})
    },
    [send, snapshot, syncStates],
  )

  // Mirror host <video> events → viewers.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const onPlay = () =>
      broadcast({ type: 'play', time: v.currentTime, rate: v.playbackRate, at: Date.now() })
    const onPause = () =>
      broadcast({ type: 'pause', time: v.currentTime, at: Date.now() })
    const onSeeked = () =>
      broadcast({ type: 'seek', time: v.currentTime, paused: v.paused, at: Date.now() })
    const onRate = () =>
      broadcast({ type: 'rate', rate: v.playbackRate, at: Date.now() })

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('ratechange', onRate)

    const beat = setInterval(() => broadcast(snapshot()), HEARTBEAT_MS)

    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('ratechange', onRate)
      clearInterval(beat)
    }
  }, [videoRef, broadcast, snapshot])

  // Tear down all peers on unmount.
  useEffect(() => {
    const map = peers.current
    return () => {
      for (const rec of map.values()) rec.pc.close()
      map.clear()
    }
  }, [])

  return state
}
