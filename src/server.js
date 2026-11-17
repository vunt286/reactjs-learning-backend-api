import { createApp } from "./app.js";
import { config } from "./config.js";

createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  console.log(`Allowed CORS origins: ${config.corsOrigins.join(", ")}`);
  if (config.debugRoutes) console.log("Debug routes enabled (/debug/*, ?_delay, ?_fail)");
});
