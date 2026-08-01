import { useCallback, useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { randomId } from '~/lib/rtc'
import type { SignalKind, SignalMessage } from '@syncwave/shared'

// URL of the NestJS signaling server. Overridable per-env via VITE_SIGNAL_URL.
const SIGNAL_URL =
  (import.meta.env.VITE_SIGNAL_URL as string | undefined) ??
  'http://localhost:4000'

type SendFn = (
  to: string,
  kind: SignalKind,
  payload?: SignalMessage['payload'],
) => void

/**
 * socket.io signaling transport. Registers this participant in the room, then
 * relays the WebRTC handshake through the server. Drop-in replacement for the
 * old polling transport — same { send } contract, so the peer hooks are
 * unchanged apart from the import.
 */
export function useSocket(
  roomId: string,
  self: string,
  onMessage: (msg: SignalMessage) => void,
): { send: SendFn } {
  // Keep the latest handler without re-opening the socket.
  const handler = useRef(onMessage)
  handler.current = onMessage

  const seen = useRef<Set<string>>(new Set())
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io(SIGNAL_URL, {
      transports: ['websocket'],
      reconnectionDelay: 500,
    })
    socketRef.current = socket

    // (Re)claim our participant id on every (re)connect so the server can route
    // signals back to us after a socket drop.
    const register = () => socket.emit('register', { roomId, id: self })
    socket.on('connect', register)

    socket.on('signal', (msg: SignalMessage) => {
      if (seen.current.has(msg.id)) return
      seen.current.add(msg.id)
      handler.current(msg)
    })

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [roomId, self])

  const send = useCallback<SendFn>(
    (to, kind, payload) => {
      const message: SignalMessage = {
        id: randomId(10),
        from: self,
        to,
        kind,
        payload: payload ?? null,
        ts: Date.now(),
      }
      // socket.io buffers emits until the connection is live, so an early send
      // (e.g. the viewer's first 'join') is not lost.
      socketRef.current?.emit('signal', { roomId, message })
    },
    [roomId, self],
  )

  return { send }
}
