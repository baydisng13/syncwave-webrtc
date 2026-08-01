// ---------------------------------------------------------------------------
// Shared signaling + sync contract. Imported by both the NestJS signaling
// server and the TanStack Start client so the wire format can never drift.
// ---------------------------------------------------------------------------

export const HOST_ID = 'host' as const

export type SignalKind = 'join' | 'offer' | 'answer' | 'ice' | 'bye'

/** One message relayed through the signaling server between two peers. */
export interface SignalMessage {
  /** Unique per message — used for client-side dedupe. */
  id: string
  /** Sender participant id ('host' or a viewer id). */
  from: string
  /** Recipient participant id ('host' or a viewer id). Empty = broadcast. */
  to: string
  kind: SignalKind
  /** SDP (offer/answer) or serialized ICE candidate. */
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | null
  ts: number
}

/** Client → server: identify this socket as a participant in a room. */
export interface RegisterMessage {
  roomId: string
  id: string
}

/** Client → server: relay one signal to `message.to` inside `roomId`. */
export interface RelayMessage {
  roomId: string
  message: SignalMessage
}

/** Payloads sent over the WebRTC data channel from host → viewers. */
export type SyncMessage =
  /** The video URL the host is playing. Sent first on channel open. */
  | { type: 'source'; url: string }
  /** Full authoritative snapshot. Sent on connect + as periodic heartbeat. */
  | { type: 'state'; time: number; paused: boolean; rate: number; at: number }
  | { type: 'play'; time: number; rate: number; at: number }
  | { type: 'pause'; time: number; at: number }
  | { type: 'seek'; time: number; paused: boolean; at: number }
  | { type: 'rate'; rate: number; at: number }

export type Role = 'host' | 'viewer'
