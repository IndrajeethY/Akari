import type { Message } from "grammy/types";

// A predicate returns true when the message should be blocked by that lock.
type LockPredicate = (m: Message) => boolean;

const text = (m: Message): string => m.text ?? m.caption ?? "";

const entities = (m: Message) => [
	...(m.entities ?? []),
	...(m.caption_entities ?? []),
];
const hasEntity = (m: Message, types: string[]): boolean =>
	entities(m).some((e) => types.includes(e.type));

const isMedia = (m: Message): boolean =>
	!!(m.photo || m.video || m.video_note || m.audio || m.voice ||
		m.document || m.sticker || m.animation);

// deno-lint-ignore no-explicit-any
const fwd = (m: Message) => m.forward_origin as any;

const zalgoMarks = /[̀-ͯ҃-҉᪰-᫿᷀-᷿]/g;
const emojiRe = /\p{Extended_Pictographic}/u;

export const LOCKS: Record<string, LockPredicate> = {
	// Media
	photo: (m) => !!m.photo,
	video: (m) => !!m.video,
	videonote: (m) => !!m.video_note,
	audio: (m) => !!m.audio,
	voice: (m) => !!m.voice,
	document: (m) => !!m.document,
	sticker: (m) => !!m.sticker,
	gif: (m) => !!m.animation,
	media: isMedia,

	// Content
	url: (m) => hasEntity(m, ["url", "text_link"]),
	forward: (m) => !!m.forward_origin,
	email: (m) =>
		hasEntity(m, ["email"]) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text(m)),
	cashtag: (m) =>
		hasEntity(m, ["cashtag"]) || /(^|\s)\$[A-Za-z]{1,8}\b/.test(text(m)),
	hashtag: (m) => hasEntity(m, ["hashtag"]) || /(^|\s)#\w+/.test(text(m)),
	location: (m) => !!(m.location || m.venue),
	contact: (m) => !!m.contact,

	// Text filters
	rtl: (m) => /[֐-׿؀-ۿݐ-ݿ]/.test(text(m)),
	cjk: (m) =>
		/[぀-ヿㇰ-ㇿ㐀-䶿一-鿿가-힯]/.test(
			text(m),
		),
	cyrillic: (m) => /[Ѐ-ӿ]/.test(text(m)),
	zalgo: (m) => (text(m).match(zalgoMarks)?.length ?? 0) >= 3,
	emojionly: (m) => {
		const t = text(m);
		if (!t || !emojiRe.test(t)) return false;
		return t.replace(/\p{Extended_Pictographic}|️|‍|\s/gu, "") === "";
	},

	// Sticker types
	stickeranimated: (m) =>
		!!(m.sticker && (m.sticker.is_animated || m.sticker.is_video)),
	premium: (m) => !!m.sticker?.premium_animation,

	// Forward types
	forwardbot: (m) => fwd(m)?.type === "user" && !!fwd(m)?.sender_user?.is_bot,
	forwardchannel: (m) => fwd(m)?.type === "channel",
	forwardstory: (m) => !!m.story,

	// Other
	externalreply: (m) => !!m.external_reply,
	all: () => true,
};

export const LOCK_TYPES: string[] = Object.keys(LOCKS);

/** Returns the name of the first active lock that matches, or null. */
export function matchLock(m: Message, active: string[]): string | null {
	return active.find((t) => LOCKS[t]?.(m)) ?? null;
}
