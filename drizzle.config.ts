import { defineConfig } from "drizzle-kit";
import { databasePath } from "./db-path";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
