/** HTTP adapters of the auth module: route handlers and the gate that protects other routes. */
export { authDeps } from './deps';
export { authorize, currentUser, isDenied, type AuthDeps, type Authed } from './guard';
export { makeLoginHandler } from './handlers/login';
export { makeLogoutHandler } from './handlers/logout';
export { makeGetMeHandler, makeUpdateMeHandler } from './handlers/me';
