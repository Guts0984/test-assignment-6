import { Temporal } from '@js-temporal/polyfill';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/server/core/db';
import { sessions, users } from './schema';
import { testUrl, truncateAll } from '@/server/tools/testing/db';
import { makeLoginHandler } from './handlers/login';
import { makeLogoutHandler } from './handlers/logout';
import { makeGetMeHandler, makeUpdateMeHandler } from './handlers/me';
import type { AuthDeps } from './guard';
import { hashPassword } from './password';
import { createSession, findUserBySession, sessionIdFor } from './session';

const SECRET = 'x'.repeat(40);
const PASSWORD = 'demo-pass-123';
const T0 = Temporal.Instant.from('2026-11-10T12:00:00Z');

let db: Db;
let close: () => Promise<void>;
let raw: postgres.Sql;
let now = T0;
let secure = false;

const deps = (): AuthDeps => ({
  db: () => db,
  now: () => now,
  config: () => ({ secret: SECRET, ttlDays: 14, secureCookies: secure }),
});

const login = makeLoginHandler(deps());
const logout = makeLogoutHandler(deps());
const me = makeGetMeHandler(deps());
const updateMe = makeUpdateMeHandler(deps());

const call = (
  method: string,
  path: string,
  o: { body?: unknown; cookie?: string; origin?: string; rawBody?: string } = {},
) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      host: 'localhost:3000',
      'content-type': 'application/json',
      ...(o.cookie ? { cookie: `session=${o.cookie}` } : {}),
      ...(o.origin ? { origin: o.origin } : {}),
    },
    body: o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
  });

const tokenFrom = (res: Response): string => {
  const m = /session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '');
  return m?.[1] ?? '';
};

let ana: { id: string };
let bob: { id: string };

beforeAll(() => {
  ({ db, close } = createDb(testUrl(), 4));
  raw = postgres(testUrl(), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await raw.end();
  await close();
});
beforeEach(async () => {
  await truncateAll(raw);
  now = T0;
  secure = false;
  const hash = await hashPassword(PASSWORD);
  const rows = await db
    .insert(users)
    .values([
      {
        email: 'Ana@Example.com',
        passwordHash: hash,
        name: 'Ana',
        timezone: 'Europe/Kyiv',
        locale: 'uk',
      },
      {
        email: 'bob@example.com',
        passwordHash: hash,
        name: 'Bob',
        timezone: 'America/New_York',
        locale: 'en',
      },
    ])
    .returning();
  ana = rows[0]!;
  bob = rows[1]!;
});

describe('POST /api/auth/login', () => {
  it('logs in, returns the public user and sets a hardened cookie', async () => {
    const res = await login(
      call('POST', '/api/auth/login', { body: { email: 'ana@example.com', password: PASSWORD } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({
      id: ana.id,
      email: 'Ana@Example.com',
      name: 'Ana',
      timezone: 'Europe/Kyiv',
      locale: 'uk',
    });

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=1209600/); // 14 days
    expect(cookie).not.toMatch(/Secure/i); // plain-http docker must still work
  });

  it('marks the cookie Secure when the app is served over https', async () => {
    secure = true;
    const res = await login(
      call('POST', '/api/auth/login', { body: { email: 'ana@example.com', password: PASSWORD } }),
    );
    expect(res.headers.get('set-cookie')).toMatch(/Secure/i);
  });

  it('never leaks the password hash, in any response', async () => {
    const res = await login(
      call('POST', '/api/auth/login', { body: { email: 'ana@example.com', password: PASSWORD } }),
    );
    const text = await res.text();
    expect(text).not.toMatch(/scrypt|passwordHash|password_hash/i);
    const meRes = await me(call('GET', '/api/me', { cookie: tokenFrom(res) }));
    expect(await meRes.text()).not.toMatch(/scrypt|passwordHash|password_hash/i);
  });

  it('stores only an HMAC of the token, never the token itself', async () => {
    const res = await login(
      call('POST', '/api/auth/login', { body: { email: 'ana@example.com', password: PASSWORD } }),
    );
    const token = tokenFrom(res);
    expect(token.length).toBeGreaterThanOrEqual(40);
    const rows = await raw`select id, user_id, expires_at from sessions`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(sessionIdFor(token, SECRET));
    expect(rows[0]?.id).not.toContain(token);
    expect(new Date(rows[0]?.expires_at as string).toISOString()).toBe('2026-11-24T12:00:00.000Z');
  });

  it('is case-insensitive on email and trims it', async () => {
    const res = await login(
      call('POST', '/api/auth/login', {
        body: { email: '  ANA@example.COM ', password: PASSWORD },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('answers wrong password and unknown email identically (no user enumeration) and creates no session', async () => {
    const wrong = await login(
      call('POST', '/api/auth/login', { body: { email: 'ana@example.com', password: 'nope' } }),
    );
    const unknown = await login(
      call('POST', '/api/auth/login', { body: { email: 'ghost@example.com', password: PASSWORD } }),
    );
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it.each([
    ['empty object', {}],
    ['no password', { email: 'ana@example.com' }],
    ['bad email', { email: 'not-an-email', password: 'x' }],
    ['empty password', { email: 'ana@example.com', password: '' }],
    ['non-string password', { email: 'ana@example.com', password: 123 }],
    ['unknown field', { email: 'ana@example.com', password: PASSWORD, admin: true }],
  ])('rejects invalid body: %s', async (_n, body) => {
    const res = await login(call('POST', '/api/auth/login', { body }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION');
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const res = await login(call('POST', '/api/auth/login', { rawBody: '{nope' }));
    expect(res.status).toBe(400);
  });

  it('rejects a cross-origin browser request, accepts same-origin and origin-less requests', async () => {
    const body = { email: 'ana@example.com', password: PASSWORD };
    expect(
      (await login(call('POST', '/api/auth/login', { body, origin: 'https://evil.example' })))
        .status,
    ).toBe(403);
    expect(
      (await login(call('POST', '/api/auth/login', { body, origin: 'http://localhost:3000' })))
        .status,
    ).toBe(200);
    expect((await login(call('POST', '/api/auth/login', { body }))).status).toBe(200);
  });

  it('purges expired sessions of everybody on login', async () => {
    await db
      .insert(sessions)
      .values({ id: 'old', userId: bob.id, expiresAt: T0.subtract({ hours: 1 }).toString() });
    await login(
      call('POST', '/api/auth/login', { body: { email: 'ana@example.com', password: PASSWORD } }),
    );
    const ids = (await db.select().from(sessions)).map((s) => s.id);
    expect(ids).not.toContain('old');
    expect(ids).toHaveLength(1);
  });
});

describe('sessions', () => {
  const cfg = { secret: SECRET, ttlDays: 14 };

  it('are valid until the expiry instant (exclusive) and not after', async () => {
    const { token } = await createSession(db, ana.id, cfg, T0);
    const expiry = T0.add({ hours: 24 * 14 });
    expect(await findUserBySession(db, token, cfg, expiry.subtract({ seconds: 1 }))).not.toBeNull();
    expect(await findUserBySession(db, token, cfg, expiry)).toBeNull();
    expect(await findUserBySession(db, token, cfg, expiry.add({ hours: 24 * 30 }))).toBeNull();
  });

  it('reject unknown, tampered, empty and undefined tokens, and tokens made with another secret', async () => {
    const { token } = await createSession(db, ana.id, cfg, T0);
    expect(await findUserBySession(db, token + 'x', cfg, T0)).toBeNull();
    expect(await findUserBySession(db, token.slice(1), cfg, T0)).toBeNull();
    expect(await findUserBySession(db, '', cfg, T0)).toBeNull();
    expect(await findUserBySession(db, undefined, cfg, T0)).toBeNull();
    expect(await findUserBySession(db, token, { ...cfg, secret: 'y'.repeat(40) }, T0)).toBeNull();
  });

  it("belong to one user: Bob cannot act through Ana's session and vice versa", async () => {
    const a = await createSession(db, ana.id, cfg, T0);
    const b = await createSession(db, bob.id, cfg, T0);
    expect((await findUserBySession(db, a.token, cfg, T0))?.id).toBe(ana.id);
    expect((await findUserBySession(db, b.token, cfg, T0))?.id).toBe(bob.id);
  });

  it('die with the user (cascade)', async () => {
    const { token } = await createSession(db, ana.id, cfg, T0);
    await db.delete(users).where(eq(users.id, ana.id));
    expect(await findUserBySession(db, token, cfg, T0)).toBeNull();
  });
});

describe('GET /api/me and POST /api/auth/logout', () => {
  const loginAs = async (email: string) =>
    tokenFrom(
      await login(call('POST', '/api/auth/login', { body: { email, password: PASSWORD } })),
    );

  it('401 without a cookie or with a garbage cookie', async () => {
    expect((await me(call('GET', '/api/me'))).status).toBe(401);
    expect((await me(call('GET', '/api/me', { cookie: 'garbage' }))).status).toBe(401);
  });

  it('returns the user of the cookie', async () => {
    const t = await loginAs('bob@example.com');
    const res = await me(call('GET', '/api/me', { cookie: t }));
    expect((await res.json()).user.email).toBe('bob@example.com');
  });

  it('401 once the session has expired', async () => {
    const t = await loginAs('ana@example.com');
    now = T0.add({ hours: 24 * 14 });
    expect((await me(call('GET', '/api/me', { cookie: t }))).status).toBe(401);
  });

  it('logout deletes the server-side session (the old cookie stops working) and clears the cookie', async () => {
    const t = await loginAs('ana@example.com');
    const res = await logout(call('POST', '/api/auth/logout', { cookie: t }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect((await me(call('GET', '/api/me', { cookie: t }))).status).toBe(401);
  });

  it("logout only ends the caller's session, other devices stay logged in", async () => {
    const t1 = await loginAs('ana@example.com');
    const t2 = await loginAs('ana@example.com');
    await logout(call('POST', '/api/auth/logout', { cookie: t1 }));
    expect((await me(call('GET', '/api/me', { cookie: t2 }))).status).toBe(200);
  });

  it('logout without a session is harmless', async () => {
    expect((await logout(call('POST', '/api/auth/logout'))).status).toBe(200);
  });
});

describe('PATCH /api/me (profile time zone, acceptance #5)', () => {
  const tokenFor = async (email: string) =>
    tokenFrom(
      await login(call('POST', '/api/auth/login', { body: { email, password: PASSWORD } })),
    );

  it('changes the time zone and the next /api/me shows it', async () => {
    const t = await tokenFor('ana@example.com');
    const res = await updateMe(
      call('PATCH', '/api/me', { cookie: t, body: { timezone: 'Asia/Tokyo' } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).user.timezone).toBe('Asia/Tokyo');
    const again = await me(call('GET', '/api/me', { cookie: t }));
    expect((await again.json()).user.timezone).toBe('Asia/Tokyo');
  });

  it("changes only the caller's profile", async () => {
    const t = await tokenFor('ana@example.com');
    await updateMe(
      call('PATCH', '/api/me', { cookie: t, body: { timezone: 'Asia/Tokyo', locale: 'en' } }),
    );
    const [b] = await db.select().from(users).where(eq(users.id, bob.id));
    expect([b?.timezone, b?.locale]).toEqual(['America/New_York', 'en']);
  });

  it.each([
    ['unknown zone', { timezone: 'Mars/Phobos' }],
    ['fixed offset', { timezone: '+02:00' }],
    ['empty zone', { timezone: '' }],
    ['bad locale', { locale: 'de' }],
    ['empty name', { name: '   ' }],
    ['empty body', {}],
    ['mass assignment: email', { email: 'hacker@example.com' }],
    ['mass assignment: password hash', { passwordHash: 'x' }],
    ['mass assignment: id', { id: '00000000-0000-4000-8000-000000000000' }],
    ['valid field + forbidden field', { timezone: 'Asia/Tokyo', email: 'hacker@example.com' }],
  ])('rejects %s and changes nothing', async (_n, body) => {
    const t = await tokenFor('ana@example.com');
    const res = await updateMe(call('PATCH', '/api/me', { cookie: t, body }));
    expect(res.status).toBe(400);
    const [a] = await db.select().from(users).where(eq(users.id, ana.id));
    expect([a?.email, a?.timezone, a?.locale, a?.name]).toEqual([
      'Ana@Example.com',
      'Europe/Kyiv',
      'uk',
      'Ana',
    ]);
  });

  it('401 without a session, 403 for a cross-origin request', async () => {
    expect(
      (await updateMe(call('PATCH', '/api/me', { body: { timezone: 'Asia/Tokyo' } }))).status,
    ).toBe(401);
    const t = await tokenFor('ana@example.com');
    const res = await updateMe(
      call('PATCH', '/api/me', {
        cookie: t,
        body: { timezone: 'Asia/Tokyo' },
        origin: 'https://evil.example',
      }),
    );
    expect(res.status).toBe(403);
    const [a] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(a?.timezone).toBe('Europe/Kyiv');
  });
});
