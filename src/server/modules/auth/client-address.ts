/**
 * The network address of the caller, or null when it cannot be known for sure.
 *
 * `X-Forwarded-For` is a list that every proxy appends to, and the client may start it with anything it
 * likes. Next.js adds the socket address only when the client sent no such header, so with a directly
 * connected client the header is entirely the client's own words. It is therefore believed only when
 * the operator says how many proxies of their own sit in front (`hops`): each of those appended the
 * address it saw, so the entry `hops` places from the END is the one the outermost trusted proxy saw,
 * and nothing the client wrote can change it. With `hops = 0` there is no trustworthy address.
 */
export function clientAddress(forwardedFor: string | null, hops: number): string | null {
  if (hops <= 0 || !forwardedFor) return null;
  const entries = forwardedFor
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length < hops) return null; // fewer entries than proxies: not what our proxies would send
  const address = entries[entries.length - hops] as string;
  return /^[0-9a-fA-F:.]{2,45}$/.test(address) ? address.toLowerCase() : null;
}
