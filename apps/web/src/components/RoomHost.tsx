import { useEffect, useRef, useState } from 'react'
import { VideoPlayer } from './VideoPlayer'
import { Brand } from './Brand'
import { useHostPeers } from '~/hooks/useHostPeers'

export function RoomHost({ roomId, src }: { roomId: string; src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { viewerCount, peers } = useHostPeers(roomId, videoRef, src)
  const [copied, setCopied] = useState(false)

  // Built after mount so SSR and first client render agree (no hydration diff).
  const [viewerLink, setViewerLink] = useState('')
  useEffect(() => {
    setViewerLink(`${window.location.origin}/room/${roomId}?role=viewer`)
  }, [roomId])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(viewerLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  const peerList = Object.entries(peers)

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <Brand tag={`room ${roomId}`} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Stage */}
        <section className="rise relative overflow-hidden rounded-md bg-black scanlines hairline">
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-sm bg-black/70 px-3 py-1.5 backdrop-blur">
            <span className="live-dot h-2.5 w-2.5 rounded-full bg-live" />
            <span className="label !text-live !tracking-[0.3em]">on air</span>
          </div>
          <VideoPlayer
            src={src}
            controls
            videoRef={videoRef}
            className="aspect-video w-full bg-black"
          />
        </section>

        {/* Control rail */}
        <aside className="flex flex-col gap-4">
          <div className="panel rise p-4" style={{ animationDelay: '80ms' }}>
            <p className="label mb-3">viewers connected</p>
            <div className="flex items-baseline gap-3">
              <span className="display text-6xl font-extrabold text-amber tabular-nums">
                {String(viewerCount).padStart(2, '0')}
              </span>
              <span className="text-xs text-muted">
                {peerList.length} handshaking
              </span>
            </div>
          </div>

          <div className="panel rise p-4" style={{ animationDelay: '160ms' }}>
            <p className="label mb-3">shareable viewer link</p>
            <div className="mb-3 break-all rounded-sm bg-void/60 p-3 text-xs leading-relaxed text-cyan hairline">
              {viewerLink || '…'}
            </div>
            <button
              onClick={copy}
              className="w-full rounded-sm bg-amber px-4 py-2.5 text-sm font-bold uppercase tracking-widest text-void transition hover:brightness-110 active:translate-y-px"
            >
              {copied ? '✓ copied' : 'copy link'}
            </button>
            <p className="mt-3 text-[0.7rem] leading-relaxed text-muted">
              Open it in another tab/device. Every play, pause &amp; seek you make
              here mirrors to viewers over a direct P2P data channel.
            </p>
          </div>

          {peerList.length > 0 && (
            <div className="panel rise p-4" style={{ animationDelay: '240ms' }}>
              <p className="label mb-3">peer states</p>
              <ul className="space-y-1.5 text-xs">
                {peerList.map(([id, st]) => (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted">{id}</span>
                    <span
                      className={
                        st === 'connected'
                          ? 'text-cyan'
                          : st === 'failed' || st === 'closed'
                            ? 'text-live'
                            : 'text-amber'
                      }
                    >
                      {st}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
