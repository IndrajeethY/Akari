import { Bot } from "grammy";

import Config from "./src/config.ts";
import composer from "./src/bot.ts";
import PmManagerDB from "./src/db.ts";

const bot = new Bot(new Config().token);
const db = new PmManagerDB();

if (!db.checkDatabaseConnection()) {
	throw new Error("Could not establish a database connection");
}
await bot.init();
console.info("Database connection established");
console.info(`Started as @${bot.botInfo.username}`);

bot.use(composer);
bot.catch((err) => console.error(err));
bot.start({
	drop_pending_updates: true,
	allowed_updates: [
		"message",
		"business_connection",
		"business_message",
		"edited_business_message",
		"deleted_business_messages",
	],
});

const shutdown = () => {
	bot.stop();
	db.close();
};
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
