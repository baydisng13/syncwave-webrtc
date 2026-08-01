import { useEffect } from 'react'
import Hls from 'hls.js'

interface Props {
  src: string
  controls: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  muted?: boolean
  className?: string
}

/**
 * Plays progressive files (.mp4/.webm) natively and HLS (.m3u8) via hls.js,
 * falling back to native HLS on Safari. The <video> element ref is owned by
 * the caller so the WebRTC hooks can drive it.
 */
export function VideoPlayer({ src, controls, videoRef, muted, className }: Props) {
  useEffect(() => {
    const v = videoRef.current
    if (!v || !src) return

    const isHls = /\.m3u8($|\?)/i.test(src)

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true })
      hls.loadSource(src)
      hls.attachMedia(v)
      return () => hls.destroy()
    }

    // mp4/webm, or Safari native HLS.
    v.src = src
    return () => {
      v.removeAttribute('src')
      v.load()
    }
  }, [src, videoRef])

  return (
    <video
      ref={videoRef}
      controls={controls}
      muted={muted}
      playsInline
      // Block the viewer's context menu / picture-in-picture download affordances.
      controlsList="nodownload noplaybackrate"
      disablePictureInPicture={!controls}
      className={className}
    />
  )
}
