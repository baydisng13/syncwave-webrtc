import { randomUUID } from 'node:crypto'
import {
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import type {
  RegisterMessage,
  RelayMessage,
  SignalMessage,
} from '@syncwave/shared'

// ---------------------------------------------------------------------------
// Signaling gateway. Relays the WebRTC handshake (offer / answer / ICE) between
// two peers in a room, then gets out of the loop — once the P2P data channel is
// up, no video-sync traffic ever touches this server.
//
// Nothing is persisted: room membership lives in memory and evaporates when the
// process restarts. That is deliberate (the brief: "store nothing on the db").
// ---------------------------------------------------------------------------

const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(',') ?? '*'

@WebSocketGateway({ cors: { origin: CORS_ORIGIN } })
export class SignalingGateway implements OnGatewayDisconnect {
  @WebSocketServer() server!: Server

  /** roomId → (participantId → socketId). */
  private readonly rooms = new Map<string, Map<string, string>>()
  /** socketId → { roomId, id } for O(1) disconnect cleanup. */
  private readonly sockets = new Map<string, { roomId: string; id: string }>()
  /**
   * Signals addressed to a participant that has not registered yet.
   * roomId → (participantId → queued messages). Flushed on register.
   */
  private readonly pending = new Map<string, Map<string, SignalMessage[]>>()

  /** Identify a socket as a participant, join the room, flush its backlog. */
  @SubscribeMessage('register')
  handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() { roomId, id }: RegisterMessage,
  ): void {
    void client.join(roomId)

    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Map()
      this.rooms.set(roomId, room)
    }
    room.set(id, client.id)
    this.sockets.set(client.id, { roomId, id })

    // Deliver anything that arrived before this peer was ready.
    const box = this.pending.get(roomId)?.get(id)
    if (box?.length) {
      for (const msg of box) client.emit('signal', msg)
      this.pending.get(roomId)!.set(id, [])
    }
  }

  /** Relay one signal to its addressed recipient inside the room. */
  @SubscribeMessage('signal')
  handleSignal(@MessageBody() { roomId, message }: RelayMessage): void {
    const room = this.rooms.get(roomId)
    const targetSocketId = room?.get(message.to)

    if (targetSocketId) {
      this.server.to(targetSocketId).emit('signal', message)
      return
    }

    // Recipient not here yet — buffer until it registers.
    let byRecipient = this.pending.get(roomId)
    if (!byRecipient) {
      byRecipient = new Map()
      this.pending.set(roomId, byRecipient)
    }
    const box = byRecipient.get(message.to) ?? []
    box.push(message)
    byRecipient.set(message.to, box)
  }

  /** On drop, tell the rest of the room this participant left. */
  handleDisconnect(client: Socket): void {
    const info = this.sockets.get(client.id)
    if (!info) return
    this.sockets.delete(client.id)

    const room = this.rooms.get(info.roomId)
    if (!room || room.get(info.id) !== client.id) return
    room.delete(info.id)

    if (room.size === 0) {
      this.rooms.delete(info.roomId)
      this.pending.delete(info.roomId)
    }

    // Broadcast a 'bye' so the host tears down that peer (and viewers learn the
    // host is gone). `to` is empty = everyone still in the room filters on it.
    const bye: SignalMessage = {
      id: randomUUID(),
      from: info.id,
      to: '',
      kind: 'bye',
      payload: null,
      ts: Date.now(),
    }
    client.to(info.roomId).emit('signal', bye)
  }
}
