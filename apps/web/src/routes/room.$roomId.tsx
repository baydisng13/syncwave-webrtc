import { createFileRoute } from '@tanstack/react-router'
import { RoomHost } from '~/components/RoomHost'
import { RoomViewer } from '~/components/RoomViewer'
import type { Role } from '@syncwave/shared'

interface RoomSearch {
  role: Role
  src?: string
}

export const Route = createFileRoute('/room/$roomId')({
  validateSearch: (search: Record<string, unknown>): RoomSearch => ({
    role: search.role === 'host' ? 'host' : 'viewer',
    src: typeof search.src === 'string' ? search.src : undefined,
  }),
  component: RoomPage,
})

function RoomPage() {
  const { roomId } = Route.useParams()
  const { role, src } = Route.useSearch()

  return role === 'host' ? (
    <RoomHost roomId={roomId} src={src ?? ''} />
  ) : (
    <RoomViewer roomId={roomId} />
  )
}
