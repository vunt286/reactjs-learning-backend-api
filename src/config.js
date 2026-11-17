import "dotenv/config";

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value, fallback) => (value === undefined ? fallback : value === "true");

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: int(process.env.PORT, 3000),
  isProduction,
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:3000")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),
  accessTtlMs: int(process.env.ACCESS_TOKEN_TTL_SECONDS, 120) * 1000,
  refreshTtlMs: int(process.env.REFRESH_TOKEN_TTL_SECONDS, 604800) * 1000,
  cookieSameSite: process.env.COOKIE_SAMESITE ?? "lax",
  cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
  latencyMs: int(process.env.LATENCY_MS, 0),
  debugRoutes: bool(process.env.ENABLE_DEBUG_ROUTES, !isProduction),
};
