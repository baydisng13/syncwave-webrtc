import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Brand } from '~/components/Brand'
import { randomId } from '~/lib/rtc'

export const Route = createFileRoute('/')({
  component: Landing,
})

const SAMPLES: { label: string; url: string }[] = [
  {
    label: 'Big Buck Bunny (mp4)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  },
  {
    label: 'Sintel (mp4)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  },
  {
    label: 'Apple test HLS (m3u8)',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',
  },
]

function Landing() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')

  const host = () => {
    const src = url.trim()
    if (!src) return
    const roomId = randomId(6)
    navigate({
      to: '/room/$roomId',
      params: { roomId },
      search: { role: 'host', src },
    })
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col p-4 sm:p-8">
      <Brand tag="est. p2p / no server in the loop" />

      <div className="flex flex-1 flex-col justify-center py-12">
        {/* Hero */}
        <div className="rise max-w-3xl">
          <p className="label mb-5 flex items-center gap-2">
            <span className="live-dot h-2 w-2 rounded-full bg-live" />
            real-time · webrtc data channels
          </p>
          <h1 className="display text-[clamp(2.75rem,9vw,6.5rem)] font-extrabold text-ink">
            Watch it
            <br />
            <span className="text-amber">together.</span>{' '}
            <span className="text-muted">Frame-perfect.</span>
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted">
            Paste a video URL, host a room, share one link. Your play, pause and
            seek stream directly to every viewer over a peer-to-peer channel —
            the server only brokers the handshake, then gets out of the way.
          </p>
        </div>

        {/* Console */}
        <div
          className="panel rise mt-10 max-w-2xl p-2"
          style={{ animationDelay: '120ms' }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && host()}
              placeholder="https://…/video.mp4  or  …/stream.m3u8"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-sm bg-void/70 px-4 py-3.5 font-mono text-sm text-ink outline-none placeholder:text-muted focus:ring-1 focus:ring-amber"
            />
            <button
              onClick={host}
              disabled={!url.trim()}
              className="rounded-sm bg-amber px-6 py-3.5 text-sm font-bold uppercase tracking-widest text-void transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              host room →
            </button>
          </div>
        </div>

        {/* Samples */}
        <div className="rise mt-5 flex flex-wrap gap-2" style={{ animationDelay: '220ms' }}>
          <span className="label mr-1 self-center">try:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.url}
              onClick={() => setUrl(s.url)}
              className="rounded-sm px-3 py-1.5 text-xs text-muted transition hover:text-amber hairline"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <footer className="label pt-6 opacity-60">
        stun-only ice · add a turn relay for symmetric nat
      </footer>
    </main>
  )
}
