import { Link } from '@tanstack/react-router'

export function Brand({ tag }: { tag?: string }) {
  return (
    <div className="flex items-center justify-between">
      <Link to="/" className="group flex items-baseline gap-3">
        <span className="display text-2xl font-extrabold tracking-tight text-ink">
          SYNC<span className="text-amber">WAVE</span>
        </span>
        <span className="label hidden transition-colors group-hover:text-amber sm:inline">
          p2p·broadcast
        </span>
      </Link>
      {tag ? <span className="label">{tag}</span> : null}
    </div>
  )
}
