import "@vibecodeapp/proxy";
import { createApp } from "./app";
import { ensureDevelopmentAuthProfiles } from "./development-auth";
import { env } from "./env";
import { initializeDatabase } from "./prisma";

const app = createApp();

initializeDatabase()
  .then(() => ensureDevelopmentAuthProfiles())
  .then((ensured) => {
    if (ensured) console.log("Development auth profiles ready");
  })
  .catch((error) => {
    console.error("Failed to initialize development auth profiles:", error);
  });

export { app };

export default {
  port: env.PORT,
  fetch: app.fetch,
};
