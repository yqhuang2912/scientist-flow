import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

config({ path: ".env.local" })
config({ path: ".env" })

const databaseUrl = process.env.DATABASE_URL_UNPOOLED

if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED is not set")
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
})
