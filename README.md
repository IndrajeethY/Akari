# Akari PM Manager Bot

A simple Telegram bot for **business accounts**. Connect your business account
and every incoming PM is mirrored into a private forum group as its own topic,
so you can reply from one place. Built to test the Telegram Business Bot API.

## Stack

- [Deno](https://deno.com) 2.x
- [grammY](https://grammy.dev) `v1.45.1`
- [`@db/sqlite`](https://jsr.io/@db/sqlite) `0.13` (FFI SQLite)

## Setup

Clone and enter the project:

```sh
git clone https://github.com/TAMILVIP007/Akari.git && cd Akari
```

Create a `.env` file in the project root:

```sh
TOKEN=<your Telegram bot token>
DB_STRING=database.db
```

`TOKEN` comes from [@BotFather](https://t.me/BotFather). `DB_STRING` is the
SQLite file path (defaults to `database.db`). The `.env` file is loaded
natively via Deno's `--env-file` flag — no dotenv dependency needed.

## Usage

```sh
deno task start   # run
deno task dev     # run with --watch
```

Required permissions (already wired into the tasks): `--allow-net`,
`--allow-read`, `--allow-write`, `--allow-env`, `--allow-ffi`,
`--allow-import`. FFI is needed because `@db/sqlite` loads a native library.

### First run

1. Enable the bot on your Business account (Settings → Business → Chatbots).
2. The bot DMs you an **Add Log Chat** button — pick a forum group where you
   are admin and the bot can manage topics.
3. Incoming PMs now land as topics in that group. Reply in the topic to answer.

## Locks (anti-spam)

Block specific kinds of incoming messages **per user**. Matching messages are
skipped and deleted from your inbox (requires `can_delete_messages` business
right).

```
/lock <types...>     # then tap the button to pick which chat to lock
/unlock <types...>   # then pick the chat to unlock
/locks               # list active locks
```

Available lock types:

- **Media:** `photo` `video` `videonote` `audio` `voice` `document` `sticker` `gif` `media`
- **Content:** `url` `forward` `email` `cashtag` `hashtag` `location` `contact`
- **Text filters:** `rtl` `cjk` `cyrillic` `zalgo` `emojionly`
- **Sticker types:** `stickeranimated` `premium`
- **Forward types:** `forwardbot` `forwardchannel` `forwardstory`
- **Other:** `externalreply` `all`

Example: `/lock url forward zalgo` → tap the button → pick the user.

## Contributing

Fork and open a PR. Run `deno fmt`, `deno lint`, and
`deno check --allow-import main.ts` before submitting.

## License

MIT — see [`LICENSE`](LICENSE).
