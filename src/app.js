import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { ApiError, errorHandler, notFoundHandler } from "./errors.js";
import { authRouter, meRouter } from "./routes/auth.js";
import { coursesRouter } from "./routes/courses.js";
import { debugRouter } from "./routes/debug.js";
import { adminRouter, instructorsRouter } from "./routes/people.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.isProduction ? 1 : false);

  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (curl, same-origin, server-to-server) are not CORS requests.
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );

  // CSRF defense in depth on top of SameSite cookies: reject state-changing requests from unknown origins.
  app.use((req, _res, next) => {
    const safe = ["GET", "HEAD", "OPTIONS"].includes(req.method);
    const origin = req.headers.origin;
    if (!safe && origin && !config.corsOrigins.includes(origin)) {
      return next(new ApiError(403, "ORIGIN_NOT_ALLOWED", "Origin not allowed"));
    }
    next();
  });

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.use(async (req, _res, next) => {
    let delay = config.latencyMs;
    if (config.debugRoutes) {
      const requested = Number.parseInt(req.query._delay, 10);
      if (Number.isFinite(requested)) delay = Math.min(Math.max(requested, 0), 10_000);
      const fail = Number.parseInt(req.query._fail, 10);
      if (fail >= 400 && fail <= 599) {
        if (delay) await sleep(delay);
        return next(new ApiError(fail, "SIMULATED_ERROR", `Simulated ${fail} error`));
      }
    }
    if (delay) await sleep(delay);
    next();
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/auth", authRouter);
  app.use("/me", meRouter);
  app.use("/courses", coursesRouter);
  app.use("/instructors", instructorsRouter);
  app.use("/admin", adminRouter);
  if (config.debugRoutes) app.use("/debug", debugRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
