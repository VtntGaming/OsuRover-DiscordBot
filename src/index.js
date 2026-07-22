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
  .setDescription("Read all osu links in this channel and output one deduplicated file.");

function extractOsuLinksFromText(text) {
  if (!text) {
    return [];
  }

  const urlRegex = /https?:\/\/[\w.-]+\S*/gi;
  const allUrls = text.match(urlRegex) || [];

  return allUrls.filter((url) => {
    const normalized = url.replace(/[)>.,!?]+$/g, "");
    return /https?:\/\/(?:osu\.ppy\.sh|old\.ppy\.sh)\//i.test(normalized);
  }).map((url) => url.replace(/[)>.,!?]+$/g, ""));
}

async function collectAllOsuLinksFromChannel(channel) {
  const uniqueLinks = new Set();
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
      const links = extractOsuLinksFromText(message.content);
      for (const link of links) {
        uniqueLinks.add(link);
      }
    }

    beforeMessageId = messages.last().id;

    if (messages.size < 100) {
      break;
    }
  }

  return {
    uniqueLinks: Array.from(uniqueLinks),
    scannedMessages: fetchedCount
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
    const { uniqueLinks, scannedMessages } = await collectAllOsuLinksFromChannel(channel);

    if (uniqueLinks.length === 0) {
      await interaction.editReply(`Scanned ${scannedMessages} messages but found no osu links.`);
      return;
    }

    const sortedLinks = uniqueLinks.sort((a, b) => a.localeCompare(b));
    const fileContent = sortedLinks.join("\n");
    const fileBuffer = Buffer.from(fileContent, "utf-8");

    const attachment = new AttachmentBuilder(fileBuffer, {
      name: "osu_links_deduplicated.txt"
    });

    await interaction.editReply({
      content: `Done. Scanned ${scannedMessages} messages and found ${sortedLinks.length} unique osu links.`,
      files: [attachment]
    });
  } catch (error) {
    console.error("Error while collecting osu links:", error);
    await interaction.editReply("An error occurred while scanning this channel.");
  }
});

client.login(token);
