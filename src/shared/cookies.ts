/** Viewing preferences live in cookies so the server can render them (no flash, no hydration mismatch). */
export function setPreferenceCookie(name: string, value: string | null): void {
  const maxAge = value === null ? 0 : 60 * 60 * 24 * 365;
  document.cookie = `${name}=${value === null ? '' : encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}
