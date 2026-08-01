import { useRef } from 'react'
import { VideoPlayer } from './VideoPlayer'
import { Brand } from './Brand'
import { useViewerPeer, type ViewerStatus } from '~/hooks/useViewerPeer'

const STATUS_COPY: Record<ViewerStatus, { text: string; color: string }> = {
  connecting: { text: 'connecting to host', color: 'text-amber' },
  connected: { text: 'in sync', color: 'text-cyan' },
  buffering: { text: 'buffering — catching up', color: 'text-amber' },
  reconnecting: { text: 'reconnecting', color: 'text-amber' },
  closed: { text: 'host disconnected', color: 'text-live' },
}

export function RoomViewer({ roomId }: { roomId: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { status, sourceUrl, needsGesture, resume } = useViewerPeer(roomId, videoRef)
  const s = STATUS_COPY[status]

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <Brand tag={`room ${roomId}`} />

      <section className="rise relative overflow-hidden rounded-md bg-black scanlines hairline">
        {/* status chip */}
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-sm bg-black/70 px-3 py-1.5 backdrop-blur">
          <span className={`h-2.5 w-2.5 rounded-full ${status === 'connected' ? 'bg-cyan' : 'bg-amber'} ${status !== 'connected' ? 'live-dot' : ''}`} />
          <span className={`label !tracking-[0.25em] ${s.color}`}>{s.text}</span>
        </div>

        {sourceUrl ? (
          <VideoPlayer
            src={sourceUrl}
            controls={false}
            muted
            videoRef={videoRef}
            className="pointer-events-none aspect-video w-full bg-black"
          />
        ) : (
          <div className="grid aspect-video w-full place-items-center">
            <div className="text-center">
              <div className="sweep mx-auto mb-4 h-1 w-40 rounded-full bg-line" />
              <p className="label">waiting for host stream…</p>
            </div>
          </div>
        )}

        {/* autoplay-gate overlay */}
        {needsGesture && sourceUrl && (
          <button
            onClick={resume}
            className="absolute inset-0 z-20 grid place-items-center bg-black/70 backdrop-blur-sm"
          >
            <span className="display rounded-sm border border-amber px-6 py-3 text-lg font-bold text-amber">
              ▶ tap to join sync
            </span>
          </button>
        )}
      </section>

      <p className="text-center text-xs leading-relaxed text-muted">
        Controls are disabled — playback follows the host in real time. If your
        connection stutters, the player briefly pauses and snaps back into sync.
      </p>
    </main>
  )
}
