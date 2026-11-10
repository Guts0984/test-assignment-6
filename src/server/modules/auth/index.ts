/**
 * Domain API of the auth module: safe to import from anywhere on the server, including tools
 * that must not pull in the web framework. HTTP adapters live in `./http`.
 */
export type { AuthDeps, Authed } from './guard';
export { hashPassword, verifyPassword } from './password';
export { sessions, users } from './schema';
export { createSession, sessionIdFor, type SessionConfig } from './session';
export type { PublicUser } from './user';
export { listUsers } from './user';
