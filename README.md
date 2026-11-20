# Next.js template

This is a Next.js template with shadcn/ui.

## Drizzle ORM with Neon

The database client is available from `@/lib/db`. Runtime queries use the pooled `DATABASE_URL`; Drizzle Kit uses the direct `DATABASE_URL_UNPOOLED` connection for schema operations.

Copy `.env.example` to `.env.local` and replace both placeholders with connection strings from Neon.

```bash
npm run db:push
```

## Chat runtime

Run `npm run dev` locally or `npm run build` followed by `npm start` for a long-running Node.js server. Configure the installation ID and encryption key from `.env.example` and keep them stable across restarts.

Next.js stores accepted user messages in Neon before dispatching them to the TypeScript Deep Agents runner. Closing a tab detaches the viewer. The Stop button requests cancellation. On startup the server checks for queued turns and takes over expired worker leases. An interrupted speaker can repeat a model request. Completed speakers retain their message IDs and the shared HTTP tool keeps its per-turn POST claims.

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
