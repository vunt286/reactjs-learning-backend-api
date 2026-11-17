import { Router } from "express";
import { z } from "zod";
import {
  authenticate, clearSessionCookies, createSession, destroySession, rotateSession, setSessionCookies,
} from "../auth.js";
import { ApiError, parseOrThrow, unauthenticated } from "../errors.js";
import { permissionsFor } from "../permissions.js";
import { db, publicUser, verifyPassword } from "../store.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

export const sessionUser = (user) => ({ ...publicUser(user), permissions: permissionsFor(user) });

// Basic brute-force protection: 5 failures per email+ip in 5 minutes.
const attempts = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function resetLoginAttempts() {
  attempts.clear();
}

function registerFailure(key) {
  const now = Date.now();
  const entry = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  entry.push(now);
  attempts.set(key, entry);
}

authRouter.post("/login", (req, res) => {
  const { email, password } = parseOrThrow(loginSchema, req.body ?? {});
  const key = `${req.ip}:${email.toLowerCase()}`;
  const recent = (attempts.get(key) ?? []).filter((t) => Date.now() - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many failed attempts. Please try again later.");
  }

  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  // Same message whether the email exists or not, so accounts cannot be enumerated.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    registerFailure(key);
    throw unauthenticated("Invalid email or password", "INVALID_CREDENTIALS");
  }

  attempts.delete(key);
  setSessionCookies(res, createSession(user.id));
  res.json({ user: sessionUser(user) });
});

authRouter.post("/logout", (req, res) => {
  destroySession({ accessToken: req.cookies?.access_token, refreshToken: req.cookies?.refresh_token });
  clearSessionCookies(res);
  res.status(204).end();
});

authRouter.post("/refresh", (req, res) => {
  const rotated = rotateSession(req.cookies?.refresh_token);
  if (!rotated) {
    clearSessionCookies(res);
    throw unauthenticated("Your session has expired", "SESSION_EXPIRED");
  }
  setSessionCookies(res, rotated);
  const user = db.users.find((u) => u.id === rotated.userId);
  res.json({ user: sessionUser(user) });
});

export const meRouter = Router();
meRouter.get("/", authenticate, (req, res) => {
  res.json({ user: sessionUser(req.user) });
});
