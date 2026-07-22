import { Composer, Context } from "grammy";
import PmManagerDB from "./db.ts";
import { LOCK_TYPES, matchLock } from "./locks.ts";

const composer = new Composer();
const db = new PmManagerDB();

const pendingLock = new Map<
	number,
	{ action: "lock" | "unlock"; types: string[] }
>();

// Functions
// deno-lint-ignore no-explicit-any
const reply = (ctx: Context, text: string, reply_markup: any = undefined) =>
	ctx.reply(text, {
		parse_mode: "HTML",
		link_preview_options: {
			is_disabled: true,
		},
		reply_parameters: ctx.message
			? { message_id: ctx.message.message_id }
			: undefined,
		reply_markup,
	});

// Start command
composer.command(
	"start",
	(ctx: Context) =>
		reply(
			ctx,
			`Hello <b>${ctx.from?.first_name}</b>! I am a personal Pm Chatbot only for business users. You can connect your business account to this bot and receive all your messages in a private chat. To get started, click the button below.`,
			{
				inline_keyboard: [
					[
						{
							text: "How to use?",
							url: "https://t.me/telegram/292",
						},
					],
				],
			},
		),
);

const handleLockCommand = async (ctx: Context, action: "lock" | "unlock") => {
	const ownerId = ctx.from?.id;
	if (!ownerId) return;

	const args = (ctx.match ? String(ctx.match) : "")
		.split(/\s+/)
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);

	if (args.length === 0) {
		return await reply(
			ctx,
			`Usage: <code>/${action} &lt;types&gt;</code> (space separated), then pick a chat.\n\n<b>Available:</b>\n<code>${
				LOCK_TYPES.join(" ")
			}</code>`,
		);
	}

	const invalid = args.filter((t) => !LOCK_TYPES.includes(t));
	if (invalid.length) {
		return await reply(
			ctx,
			`Unknown lock type(s): <code>${invalid.join(" ")}</code>`,
		);
	}

	pendingLock.set(ownerId, { action, types: args });
	return await reply(
		ctx,
		`Pick the chat to <b>${action}</b>: <code>${args.join(" ")}</code>`,
		{
			keyboard: [
				[
					{
						text: `Pick chat to ${action}`,
						request_users: {
							request_id: ctx.msg?.message_id ?? 1,
							user_is_bot: false,
							max_quantity: 1,
						},
					},
				],
			],
			resize_keyboard: true,
			one_time_keyboard: true,
		},
	);
};

composer.command("lock", (ctx: Context) => handleLockCommand(ctx, "lock"));
composer.command("unlock", (ctx: Context) => handleLockCommand(ctx, "unlock"));

composer.command("logger", (ctx: Context) => {
	const ownerId = ctx.from?.id;
	if (!ownerId) return;
	const arg = String(ctx.match ?? "").trim().toLowerCase();
	if (arg !== "on" && arg !== "off") {
		return reply(
			ctx,
			"Usage: <code>/logger on</code> or <code>/logger off</code>.",
		);
	}
	const ok = db.setLogging(ownerId, arg === "on");
	if (!ok) {
		return reply(ctx, "No business connection found for your account.");
	}
	return reply(
		ctx,
		`PM logging is now <b>${arg === "on" ? "ON" : "OFF"}</b>.`,
	);
});

composer.command("locks", (ctx: Context) => {
	const ownerId = ctx.from?.id;
	if (!ownerId) return;
	const rows = db.getAllLocks(ownerId);
	if (rows.length === 0) {
		return reply(
			ctx,
			"No locks set. Use <code>/lock &lt;types&gt;</code>.",
		);
	}
	const byTarget = new Map<number, string[]>();
	for (const { targetId, lockType } of rows) {
		byTarget.set(targetId, [...(byTarget.get(targetId) ?? []), lockType]);
	}
	let text = "<b>Active locks:</b>\n";
	for (const [targetId, types] of byTarget) {
		text += `\n<b>User <code>${targetId}</code>:</b> <code>${
			types.join(" ")
		}</code>`;
	}
	return reply(ctx, text);
});

composer.on("message:users_shared", async (ctx: Context) => {
	const ownerId = ctx.from?.id;
	if (!ownerId) return;
	const pending = pendingLock.get(ownerId);
	if (!pending) return;
	pendingLock.delete(ownerId);

	const shared = ctx.message?.users_shared;
	// deno-lint-ignore no-explicit-any
	const ids: number[] = (shared?.users?.map((u: any) => u.user_id) ??
		// deno-lint-ignore no-explicit-any
		(shared as any)?.user_ids ?? []) as number[];
	if (ids.length === 0) {
		return await reply(ctx, "No user selected.", { remove_keyboard: true });
	}

	for (const targetId of ids) {
		for (const type of pending.types) {
			if (pending.action === "lock") db.addLock(ownerId, targetId, type);
			else db.removeLock(ownerId, targetId, type);
		}
	}
	return await reply(
		ctx,
		`${pending.action === "lock" ? "Locked" : "Unlocked"} <code>${
			pending.types.join(" ")
		}</code> for user <code>${ids.join(", ")}</code>.`,
		{ remove_keyboard: true },
	);
});

composer.on("business_connection:is_enabled", async (ctx: Context) => {
	if (ctx.businessConnection?.is_enabled) {
		try {
			const ownerChatId = ctx.businessConnection.user_chat_id;
			const connId = ctx.businessConnection.id;
			// deno-lint-ignore no-explicit-any
			const newRights = (ctx.businessConnection as any).rights ?? {};
			const known = db.getOwnerIdFromBusinessId(connId) !== null;
			db.addBusinessConnection(ownerChatId, connId);
			if (known) {
				const oldRights = db.getConnectionRights(connId);
				db.setConnectionRights(connId, JSON.stringify(newRights));
				const diff = describeRightsDiff(oldRights, newRights);
				return await ctx.api.sendMessage(
					ownerChatId,
					diff
						? `Permissions updated:\n${diff}`
						: "Business connection updated.",
					{ parse_mode: "HTML" },
				);
			}
			db.setConnectionRights(connId, JSON.stringify(newRights));
			await ctx.api.sendMessage(
				ownerChatId,
				"Business connection is enabled you can now send messages to the business",
				{
					reply_markup: {
						keyboard: [
							[
								{
									text: "Add Log Chat",
									request_chat: {
										request_id: ctx.businessConnection.date,
										chat_is_forum: true,
										chat_is_channel: false,
										bot_is_member: true,
										user_administrator_rights: {
											can_restrict_members: true,
											can_delete_messages: false,
											can_invite_users: false,
											can_pin_messages: true,
											is_anonymous: false,
											can_change_info: false,
											can_manage_topics: true,
											can_manage_chat: false,
											can_promote_members: false,
											can_delete_stories: false,
											can_edit_stories: false,
											can_manage_video_chats: false,
											can_post_stories: false,
										},
										bot_administrator_rights: {
											can_restrict_members: true,
											can_delete_messages: false,
											can_invite_users: false,
											can_pin_messages: true,
											is_anonymous: false,
											can_change_info: false,
											can_manage_topics: true,
											can_manage_chat: false,
											can_promote_members: false,
											can_delete_stories: false,
											can_edit_stories: false,
											can_manage_video_chats: false,
											can_post_stories: false,
										},
									},
								},
							],
						],
						resize_keyboard: true,
					},
				},
			);
		} catch (error) {
			console.error(
				`Error in business_connection:is_enabled for ${ctx.businessConnection.user_chat_id}:`,
				error,
			);
		}
	} else {
		db.deleteBusinessConnection(String(ctx.businessConnectionId));
		if (ctx.businessConnection?.user_chat_id) {
			await ctx.api.sendMessage(
				ctx.businessConnection.user_chat_id,
				"Business connection is disabled",
			);
		}
	}
});

composer.on("message:chat_shared", async (ctx: Context) => {
	const ownerId = ctx.message?.from?.id;
	const sharedChatId = ctx.message?.chat_shared?.chat_id;
	if (!ownerId || !sharedChatId) return;

	const logchat = db.getLogChatFromOwnerId(ownerId);
	if (logchat) {
		await reply(
			ctx,
			"You already have a log chat connected to your account currently getting disconnected",
		);
	}
	const oldChat = db.getLogChatId(sharedChatId);
	if (oldChat) {
		return await reply(ctx, "This chat is already connected to an account");
	}
	db.addLogChatToBusinessConnection(ownerId, sharedChatId);
	await ctx.api.sendMessage(
		sharedChatId,
		"This chat is now connected to your account and will be used to receive all your private messages",
	);
	await reply(ctx, "Log chat added successfully", {
		remove_keyboard: true,
	});
});

composer.on("business_message", async (ctx: Context) => {
	const connectionId = String(ctx.businessMessage?.business_connection_id);
	const senderId = ctx.businessMessage?.from?.id;
	const ownerId = db.getOwnerIdFromBusinessId(connectionId);
	if (!ownerId || ownerId === senderId || !senderId) return;
	if (!db.isLoggingEnabled(connectionId)) return;

	const locks = db.getLocks(ownerId, senderId);
	if (locks.length && ctx.businessMessage) {
		const hit = matchLock(ctx.businessMessage, locks);
		if (hit) {
			try {
				await ctx.api.deleteBusinessMessages(connectionId, [
					ctx.businessMessage.message_id,
				]);
			} catch (error) {
				console.error(
					`Failed to delete locked message (${hit}):`,
					error,
				);
			}
			return;
		}
	}

	const logchat = db.getLogChatFromBusinessId(connectionId);
	if (!logchat) {
		return await ctx.api.sendMessage(
			ownerId,
			"You don't have a log chat connected to your account",
		);
	}

	const topicid = db.getTopicIdByUserId(senderId, connectionId);
	if (!topicid) {
		const topic = await ctx.api.createForumTopic(
			logchat,
			`${ctx.businessMessage?.from?.first_name} ${
				ctx.businessMessage?.from?.last_name || ""
			}`,
		);
		await sendIntro(ctx, logchat, topic.message_thread_id);
		return await sendMessage(ctx, logchat, topic.message_thread_id);
	}

	const replyMsgId = ctx.businessMessage?.reply_to_message?.message_id;
	if (replyMsgId) {
		const replytoId = db.getMessagesByToId(replyMsgId, senderId);
		return await sendMessage(ctx, logchat, topicid, replytoId);
	}
	return await sendMessage(ctx, logchat, topicid);
});

composer.on("message", async (ctx: Context) => {
	const chatId = ctx.message?.chat?.id;
	if (!chatId) return;
	const [logchat, businessId] = db.getLogInfo(chatId);
	if (!ctx.message?.is_topic_message || !logchat) return;

	const userId = db.userIdByTopicId(ctx.message.message_thread_id!, logchat);
	if (!userId) {
		return await reply(ctx, "User Chat not found");
	}

	const repliedTo = ctx.message.reply_to_message;
	if (
		repliedTo?.message_id &&
		repliedTo.message_id !== repliedTo.message_thread_id
	) {
		let replytoId = db.getMessagesByFromId(repliedTo.message_id, logchat);
		if (repliedTo.from?.id === ctx.me.id) {
			replytoId = db.getMessagesByToId(repliedTo.message_id, logchat);
		}
		return await sendMessage(ctx, userId, null, replytoId, businessId);
	}
	return await sendMessage(ctx, userId, null, null, businessId);
});

function describeRightsDiff(
	oldJson: string | null,
	next: Record<string, unknown>,
): string {
	const prev: Record<string, unknown> = oldJson ? JSON.parse(oldJson) : {};
	const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
	const lines: string[] = [];
	for (const k of keys) {
		const before = !!prev[k];
		const after = !!next[k];
		if (before === after) continue;
		const label = k.replace(/^can_/, "").replace(/_/g, " ");
		lines.push(
			`${after ? "✅" : "❌"} <code>${label}</code> ${
				after ? "enabled" : "disabled"
			}`,
		);
	}
	return lines.join("\n");
}

async function sendIntro(
	ctx: Context,
	logchat: number,
	topicid: number,
): Promise<void> {
	const userinfo = await ctx.getChat();
	if (userinfo && userinfo.type === "private") {
		const {
			first_name: firstName,
			last_name: lastName,
			username,
			birthdate,
			bio,
			id,
		} = userinfo;
		const photos =
			(await ctx.api.getUserProfilePhotos(id, { limit: 1 })).photos;
		const isPremium = ctx.message?.from?.is_premium;
		let introMessage = "<b>✘  Usᴇʀ Iɴғᴏ ✘</b>\n\n";
		if (firstName) {
			introMessage += `<b>✘  Fɪʀsᴛ Nᴀᴍᴇ:</b> <code>${firstName}</code>\n`;
		}
		if (lastName) {
			introMessage += `<b>✘ Lᴀsᴛ Nᴀᴍᴇ:</b> <code>${lastName}</code>\n`;
		}
		if (username) {
			introMessage += `<b>✘ Usᴇʀɴᴀᴍᴇ:</b> <code>${username}</code>\n`;
		}
		if (id) introMessage += `<b>✘ Usᴇʀ ID:</b> <code>${id}</code>\n`;
		if (birthdate) {
			introMessage += `<b>✘ Bɪʀᴛʜᴅᴀᴛᴇ:</b> <code>${birthdate}</code>\n`;
		}
		introMessage += `<b>✘ Is Pʀᴇᴍɪᴜᴍ:</b> <code>${
			isPremium ? "Yes" : "No"
		}</code>\n`;
		if (bio) introMessage += `\n\n<b>✘ Bɪᴏ:</b> <code>${bio}</code>`;
		if (photos.length > 0) {
			const sizes = photos[0];
			const best = sizes[sizes.length - 1];
			await ctx.api.sendPhoto(logchat, best.file_id, {
				caption: introMessage,
				message_thread_id: topicid,
				parse_mode: "HTML",
			});
			return;
		}
		await ctx.api.sendMessage(logchat, introMessage, {
			message_thread_id: topicid,
			parse_mode: "HTML",
		});
		return;
	}
	await ctx.api.sendMessage(logchat, "User is not a valid user", {
		message_thread_id: topicid,
	});
}

async function sendMessage(
	ctx: Context,
	chatId: number,
	topicid: number | null = null,
	replytoId: number | null = null,
	businessId: string | null = null,
): Promise<void> {
	const message = ctx.businessMessage ?? ctx.message;
	if (!message) return;

	const opts: {
		message_thread_id?: number;
		reply_parameters?: { message_id: number };
		business_connection_id?: string;
	} = {};
	if (topicid) opts.message_thread_id = topicid;
	if (replytoId) opts.reply_parameters = { message_id: replytoId };
	if (businessId) opts.business_connection_id = businessId;

	let sent;
	if (message.text) {
		sent = await ctx.api.sendMessage(chatId, message.text, opts);
	} else if (message.audio) {
		sent = await ctx.api.sendAudio(chatId, message.audio.file_id, opts);
	} else if (message.document) {
		sent = await ctx.api.sendDocument(
			chatId,
			message.document.file_id,
			opts,
		);
	} else if (message.photo) {
		const best = message.photo[message.photo.length - 1];
		sent = await ctx.api.sendPhoto(chatId, best.file_id, opts);
	} else if (message.sticker) {
		sent = await ctx.api.sendSticker(chatId, message.sticker.file_id, opts);
	} else if (message.video) {
		sent = await ctx.api.sendVideo(chatId, message.video.file_id, opts);
	} else if (message.voice) {
		sent = await ctx.api.sendVoice(chatId, message.voice.file_id, opts);
	} else if (message.animation) {
		sent = await ctx.api.sendAnimation(
			chatId,
			message.animation.file_id,
			opts,
		);
	} else if (message.video_note) {
		sent = await ctx.api.sendVideoNote(
			chatId,
			message.video_note.file_id,
			opts,
		);
	} else if (message.contact) {
		sent = await ctx.api.sendContact(
			chatId,
			message.contact.phone_number,
			message.contact.first_name,
			opts,
		);
	} else if (message.location) {
		sent = await ctx.api.sendLocation(
			chatId,
			message.location.latitude,
			message.location.longitude,
			opts,
		);
	} else if (message.venue) {
		sent = await ctx.api.sendVenue(
			chatId,
			message.venue.location.latitude,
			message.venue.location.longitude,
			message.venue.title,
			message.venue.address,
			opts,
		);
	} else if (message.dice) {
		sent = await ctx.api.sendDice(chatId, message.dice.emoji, opts);
	} else if (message.game) {
		sent = await ctx.api.sendGame(chatId, message.game.title, opts);
	}

	if (!sent) return;
	db.addMessage(
		message.message_id,
		sent.message_id,
		topicid ?? 0,
		message.from?.id ?? 0,
		chatId,
	);
}

export default composer;
