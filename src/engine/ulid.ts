/**
 * Minimal ULID generator (no external dependencies)
 * Format: 26-character, Crockford base32, time-sorted
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIMESTAMP_LEN = 10
const RANDOM_LEN = 16
let lastTimestamp = 0
let lastRandom = ""

export function ulid(): string {
  const now = Date.now()
  const timestamp = encodeTimestamp(now)

  // Ensure monotonicity
  if (now === lastTimestamp) {
    lastRandom = incrementRandom(lastRandom)
  } else {
    lastRandom = generateRandom()
  }
  lastTimestamp = now

  return timestamp + lastRandom
}

function encodeTimestamp(ts: number): string {
  let result = ""
  for (let i = TIMESTAMP_LEN - 1; i >= 0; i--) {
    result = CROCKFORD[ts % 32]! + result
    ts = Math.floor(ts / 32)
  }
  return result
}

function generateRandom(): string {
  let result = ""
  const arr = new Uint8Array(RANDOM_LEN)
  crypto.getRandomValues(arr)
  for (let i = 0; i < RANDOM_LEN; i++) {
    result += CROCKFORD[arr[i]! % 32]
  }
  return result
}

function incrementRandom(r: string): string {
  let chars = r.split("")
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = CROCKFORD.indexOf(chars[i]!)
    if (idx < 31) {
      chars[i] = CROCKFORD[idx + 1]!
      return chars.join("")
    }
    chars[i] = "0"
  }
  return generateRandom()
}
