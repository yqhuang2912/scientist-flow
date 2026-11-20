// Run locally with Node 22:
// node --env-file=.env --env-file=.env.local --conditions=react-server --import tsx scripts/create-native-direct-chat.ts BOT_ID
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { bots, chatMembers, chats } from "../db/schema"
import { db } from "../lib/db"
import { validateChoice } from "../lib/model-connections.server"
import { installationOwner } from "../lib/model-credentials.server"

const owner = installationOwner()
const botId = process.argv[2]
if (!botId) throw new Error("Supply the ID of an existing bot.")
const [existing] = await db
  .select({ id: chats.id, botId: chatMembers.botId })
  .from(chats)
  .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
  .where(eq(chats.nativeOwner, owner))
if (existing) {
  if (existing.botId !== botId)
    throw new Error(
      "This installation already has a pilot for a different bot."
    )
  console.log("/chats/" + existing.id)
} else {
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId))
  if (!bot?.modelChoice?.effort)
    throw new Error("Select a bot with an explicit model and reasoning effort.")
  await validateChoice(bot.modelChoice)
  const chatId = nanoid()
  await db.batch([
    db
      .insert(chats)
      .values({
        id: chatId,
        kind: "direct",
        name: bot.name + " · Native pilot",
        nativeOwner: owner,
      }),
    db.insert(chatMembers).values({ chatId, botId }),
  ])
  console.log("/chats/" + chatId)
}
