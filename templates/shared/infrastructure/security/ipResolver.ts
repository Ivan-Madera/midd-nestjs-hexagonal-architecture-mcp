import { Request } from 'express'

export type TrustedCidr = { network: number; mask: number }

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/

const toInt = (ip: string): number =>
  ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0

const stripIpv4Mapping = (ip: string): string => ip.replace(/^::ffff:/i, '')

/**
 * Parses a comma separated CIDR list (e.g. "10.0.0.0/8,192.168.0.0/16").
 * Invalid entries are ignored: an unparsable proxy is never trusted.
 */
export function parseTrustedCidrs(list: string): TrustedCidr[] {
  return list
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [address, bits = '32'] = entry.split('/')
      const prefix = Number(bits)
      if (!IPV4_PATTERN.test(address) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        return []
      }
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
      return [{ network: toInt(address) & mask, mask }]
    })
}

export function isTrustedProxy(ip: string, trusted: TrustedCidr[]): boolean {
  const candidate = stripIpv4Mapping(ip)
  if (!IPV4_PATTERN.test(candidate)) return false
  const value = toInt(candidate)
  return trusted.some(({ network, mask }) => (value & mask) === network)
}

/**
 * Resolves the real client IP. X-Forwarded-For is honoured ONLY when the direct
 * peer is a trusted proxy (anti-spoofing); in that case the FIRST entry wins.
 * Shared by the rate limit (C1) and the concurrency limit (C2).
 */
export function resolveClientIp(req: Request, trusted: TrustedCidr[]): string {
  const directIp = stripIpv4Mapping(req.socket?.remoteAddress ?? 'unknown')
  if (!isTrustedProxy(directIp, trusted)) return directIp

  const forwarded = req.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first ? stripIpv4Mapping(first) : directIp
}
