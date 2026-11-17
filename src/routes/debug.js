import { Router } from "express";
import { authenticate, expireAccessToken, resetSessions, revokeAllSessions } from "../auth.js";
import { resetLoginAttempts } from "./auth.js";
import { resetDb } from "../store.js";

// Helpers for practicing expiry/error handling. Only mounted when ENABLE_DEBUG_ROUTES=true.
export const debugRouter = Router();

debugRouter.post("/reset", (_req, res) => {
  resetDb();
  resetSessions();
  resetLoginAttempts();
  res.status(204).end();
});

debugRouter.post("/expire-access", authenticate, (req, res) => {
  expireAccessToken(req.accessToken);
  res.status(204).end();
});

debugRouter.post("/revoke-session", authenticate, (req, res) => {
  revokeAllSessions(req.accessToken);
  res.status(204).end();
});
