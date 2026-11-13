# Next.js template

This is a Next.js template with shadcn/ui.

## Drizzle ORM with Neon

The database client is available from `@/lib/db`. Runtime queries use the pooled `DATABASE_URL`; Drizzle Kit uses the direct `DATABASE_URL_UNPOOLED` connection for schema operations.

Copy `.env.example` to `.env.local` and replace both placeholders with connection strings from Neon.

```bash
npm run db:push
```

The starter schema includes a `bots` table; add more tables to `db/schema.ts` before pushing schema changes.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```
