import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { unauthenticated } from "./errors.js";
import { db } from "./store.js";

// Opaque server-side sessions kept in memory (restarting the server logs everyone out).
const accessSessions = new Map(); // token -> { userId, refreshToken, expiresAt }
const refreshSessions = new Map(); // token -> { userId, expiresAt }

const newToken = () => randomBytes(32).toString("hex");

export function resetSessions() {
  accessSessions.clear();
  refreshSessions.clear();
}

export function createSession(userId) {
  const accessToken = newToken();
  const refreshToken = newToken();
  const now = Date.now();
  accessSessions.set(accessToken, { userId, refreshToken, expiresAt: now + config.accessTtlMs });
  refreshSessions.set(refreshToken, { userId, expiresAt: now + config.refreshTtlMs });
  return { accessToken, refreshToken };
}

// Refresh tokens are single-use (rotation): the old pair is destroyed when a new one is issued.
export function rotateSession(refreshToken) {
  const entry = refreshToken ? refreshSessions.get(refreshToken) : undefined;
  if (!entry || entry.expiresAt <= Date.now()) {
    if (refreshToken) destroySession({ refreshToken });
    return null;
  }
  destroySession({ refreshToken });
  if (!db.users.some((u) => u.id === entry.userId)) return null;
  return { userId: entry.userId, ...createSession(entry.userId) };
}

export function destroySession({ accessToken, refreshToken }) {
  const access = accessToken ? accessSessions.get(accessToken) : undefined;
  const refresh = refreshToken ?? access?.refreshToken;
  if (accessToken) accessSessions.delete(accessToken);
  if (refresh) {
    refreshSessions.delete(refresh);
    for (const [token, session] of accessSessions) {
      if (session.refreshToken === refresh) accessSessions.delete(token);
    }
  }
}

// Debug helpers used to practice expiry handling.
export function expireAccessToken(accessToken) {
  const session = accessSessions.get(accessToken);
  if (session) session.expiresAt = Date.now() - 1;
}

export function revokeAllSessions(accessToken) {
  destroySession({ accessToken });
}

export function readAccessToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.access_token;
}

export function cookieOptions(maxAgeMs, path = "/") {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    maxAge: maxAgeMs,
    path,
  };
}

export function setSessionCookies(res, { accessToken, refreshToken }) {
  res.cookie("access_token", accessToken, cookieOptions(config.accessTtlMs));
  // The refresh cookie is only sent to /auth/* endpoints.
  res.cookie("refresh_token", refreshToken, cookieOptions(config.refreshTtlMs, "/auth"));
}

export function clearSessionCookies(res) {
  const { maxAge: _a, ...base } = cookieOptions(0);
  const { maxAge: _b, ...refreshBase } = cookieOptions(0, "/auth");
  res.clearCookie("access_token", base);
  res.clearCookie("refresh_token", refreshBase);
}

export function authenticate(req, _res, next) {
  const token = readAccessToken(req);
  const session = token ? accessSessions.get(token) : undefined;
  if (!session) return next(unauthenticated());
  if (session.expiresAt <= Date.now()) {
    return next(unauthenticated("Your session has expired", "SESSION_EXPIRED"));
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return next(unauthenticated());
  req.user = user;
  req.accessToken = token;
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of accessSessions) if (s.expiresAt + 600_000 < now) accessSessions.delete(token);
  for (const [token, s] of refreshSessions) if (s.expiresAt < now) refreshSessions.delete(token);
}, 60_000).unref();
