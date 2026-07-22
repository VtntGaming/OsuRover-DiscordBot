# OsuRoVer Discord Bot

Discord bot with slash command `/getListOfMapQueued`:
- Reads all messages in the current channel
- Extracts osu links (`osu.ppy.sh`, `old.ppy.sh`)
- Removes duplicates
- Sends back one output file: `osu_links_deduplicated.txt`

## Requirements

- Node.js 18.17+ (or newer)
- A Discord bot application with these scopes/permissions:
  - Scope: `bot`, `applications.commands`
  - Bot permissions: `Read Message History`, `View Channels`, `Send Messages`, `Attach Files`
- In Discord Developer Portal, enable **Message Content Intent** for the bot.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill values:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
```

3. Start bot:

```bash
npm start
```

When bot is online, it auto-registers slash command `/getlistofmapqueued`.

## How to use

1. Go to the channel you want to scan.
2. Run slash command `/getlistofmapqueued`.
3. Bot will reply with a deduplicated file of osu links.

## Notes

- Slash command names on Discord are lowercase, so command is registered as `/getlistofmapqueued`.
- Scanning very large channels may take a while due to paginated history fetches.
