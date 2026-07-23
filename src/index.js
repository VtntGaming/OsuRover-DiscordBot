require("dotenv").config();

const { AttachmentBuilder, Client, GatewayIntentBits, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in environment variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const commandDefinition = new SlashCommandBuilder()
  .setName("getlistofmapqueued")
  .setDescription("Read all osu links in this channel and output unique beatmapset IDs.");

function extractOsuReferencesFromText(text) {
  if (!text) {
    return {
      beatmapsetIds: new Set(),
      beatmapIdsToResolve: new Set()
    };
  }

  const urlRegex = /https?:\/\/[\w.-]+\S*/gi;
  const allUrls = text.match(urlRegex) || [];

  const beatmapsetIds = new Set();
  const beatmapIdsToResolve = new Set();

  for (const rawUrl of allUrls) {
    const normalized = rawUrl.replace(/[)>.,!?]+$/g, "");

    let parsed;
    try {
      parsed = new URL(normalized);
    } catch {
      continue;
    }

    if (!/^(?:osu\.ppy\.sh|old\.ppy\.sh)$/i.test(parsed.hostname)) {
      continue;
    }

    const beatmapsetsMatch = parsed.pathname.match(/^\/beatmapsets\/(\d+)/i);
    if (beatmapsetsMatch) {
      beatmapsetIds.add(beatmapsetsMatch[1]);
      continue;
    }

    const shortSetMatch = parsed.pathname.match(/^\/s\/(\d+)/i);
    if (shortSetMatch) {
      beatmapsetIds.add(shortSetMatch[1]);
      continue;
    }

    const shortBeatmapMatch = parsed.pathname.match(/^\/b\/(\d+)/i);
    if (shortBeatmapMatch) {
      beatmapIdsToResolve.add(shortBeatmapMatch[1]);
      continue;
    }
  }

  return {
    beatmapsetIds,
    beatmapIdsToResolve
  };
}

async function resolveBeatmapsetIdFromBeatmapId(beatmapId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    // `/b/<id>` typically redirects to `/beatmapsets/<setid>#osu/<id>`.
    const response = await fetch(`https://osu.ppy.sh/b/${beatmapId}`, {
      signal: controller.signal,
      redirect: "follow"
    });

    const finalUrl = new URL(response.url);
    const beatmapsetsMatch = finalUrl.pathname.match(/^\/beatmapsets\/(\d+)/i);
    if (beatmapsetsMatch) {
      return beatmapsetsMatch[1];
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function collectAllBeatmapsetIdsFromChannel(channel) {
  const uniqueBeatmapsetIds = new Set();
  const beatmapIdsToResolve = new Set();
  let beforeMessageId;
  let fetchedCount = 0;

  while (true) {
    const options = { limit: 100 };
    if (beforeMessageId) {
      options.before = beforeMessageId;
    }

    const messages = await channel.messages.fetch(options);

    if (messages.size === 0) {
      break;
    }

    fetchedCount += messages.size;

    for (const message of messages.values()) {
      const extracted = extractOsuReferencesFromText(message.content);
      for (const beatmapsetId of extracted.beatmapsetIds) {
        uniqueBeatmapsetIds.add(beatmapsetId);
      }
      for (const beatmapId of extracted.beatmapIdsToResolve) {
        beatmapIdsToResolve.add(beatmapId);
      }
    }

    beforeMessageId = messages.last().id;

    if (messages.size < 100) {
      break;
    }
  }

  let resolvedBeatmapIds = 0;
  for (const beatmapId of beatmapIdsToResolve) {
    const beatmapsetId = await resolveBeatmapsetIdFromBeatmapId(beatmapId);
    if (!beatmapsetId) {
      continue;
    }

    uniqueBeatmapsetIds.add(beatmapsetId);
    resolvedBeatmapIds++;
  }

  return {
    uniqueBeatmapsetIds: Array.from(uniqueBeatmapsetIds),
    scannedMessages: fetchedCount,
    attemptedBeatmapIdResolves: beatmapIdsToResolve.size,
    resolvedBeatmapIds
  };
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await client.application.commands.set([commandDefinition.toJSON()]);
    console.log("Slash command /getListOfMapQueued has been registered.");
  } catch (error) {
    console.error("Failed to register slash command:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName !== "getlistofmapqueued") {
    return;
  }

  await interaction.deferReply();

  const channel = interaction.channel;

  if (!channel || !channel.isTextBased() || typeof channel.messages?.fetch !== "function") {
    await interaction.editReply("This command only works in a text channel.");
    return;
  }

  try {
    const {
      uniqueBeatmapsetIds,
      scannedMessages,
      attemptedBeatmapIdResolves,
      resolvedBeatmapIds
    } = await collectAllBeatmapsetIdsFromChannel(channel);

    if (uniqueBeatmapsetIds.length === 0) {
      await interaction.editReply(`Scanned ${scannedMessages} messages but found no beatmapset IDs.`);
      return;
    }

    const sortedBeatmapsetIds = uniqueBeatmapsetIds.sort((a, b) => Number(a) - Number(b));
    const fileContent = sortedBeatmapsetIds.join("\n");
    const fileBuffer = Buffer.from(fileContent, "utf-8");

    const attachment = new AttachmentBuilder(fileBuffer, {
      name: "osu_beatmapset_ids_deduplicated.txt"
    });

    await interaction.editReply({
      content: `Done. Scanned ${scannedMessages} messages and found ${sortedBeatmapsetIds.length} unique beatmapset IDs. Resolved ${resolvedBeatmapIds}/${attemptedBeatmapIdResolves} beatmap ID-only links.`,
      files: [attachment]
    });
  } catch (error) {
    console.error("Error while collecting osu links:", error);
    await interaction.editReply("An error occurred while scanning this channel.");
  }
});

client.login(token);
