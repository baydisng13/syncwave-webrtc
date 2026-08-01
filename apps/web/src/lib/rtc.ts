// Public STUN servers for NAT traversal. Enough for most home/office networks.
// For symmetric-NAT / carrier-grade-NAT peers you also need a TURN relay —
// add its { urls, username, credential } here (e.g. a free metered.ca TURN key).
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

/** Drift beyond this (seconds) triggers a hard resync on the viewer. */
export const DRIFT_TOLERANCE = 0.75

/** Host heartbeat interval (ms) — keeps late/buffering viewers converging. */
export const HEARTBEAT_MS = 2000

export function randomId(len = 8): string {
  const a = new Uint8Array(len)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => (b % 36).toString(36)).join('')
}
