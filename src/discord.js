/**
 * discord.js — Discord webhook notifications for kaspr-agent3.
 */

const axios = require('axios');

const LOGS = process.env.DISCORD_WEBHOOK_KASPR_LOGS;
const ERRORS = process.env.DISCORD_WEBHOOK_KASPR_ERRORS;
const POSTS = process.env.DISCORD_WEBHOOK_KASPR_POSTS;

async function post(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, payload, { timeout: 8000 });
  } catch (err) {
    console.warn('[discord] Webhook failed:', err.message);
  }
}

function embed(title, fields, color = 0x4ade80) {
  return {
    embeds: [{ title, color, fields, timestamp: new Date().toISOString() }],
  };
}

async function postScheduled({ businessName, clientId, scheduledAt, platform, postId }) {
  await post(POSTS, embed(
    '📅 Post Scheduled',
    [
      { name: 'Business', value: businessName, inline: true },
      { name: 'Platform', value: platform, inline: true },
      { name: 'Scheduled', value: scheduledAt, inline: false },
      { name: 'Post ID', value: postId, inline: true },
      { name: 'Client ID', value: clientId, inline: true },
    ],
    0x818cf8
  ));
}

async function postPublished({ businessName, platform, postId }) {
  await post(POSTS, embed(
    '🚀 Post Published',
    [
      { name: 'Business', value: businessName, inline: true },
      { name: 'Platform', value: platform, inline: true },
      { name: 'Post ID', value: postId, inline: true },
    ],
    0x4ade80
  ));
}

async function postFailed({ businessName, clientId, platform, error }) {
  await post(ERRORS, embed(
    '🚨 Post Failed',
    [
      { name: 'Business', value: businessName, inline: true },
      { name: 'Platform', value: platform, inline: true },
      { name: 'Error', value: error, inline: false },
      { name: 'Client ID', value: clientId, inline: true },
    ],
    0xef4444
  ));
}

async function captionGenFailed({ businessName, clientId, error }) {
  await post(ERRORS, embed(
    '🚨 Caption Gen Failed',
    [
      { name: 'Business', value: businessName, inline: true },
      { name: 'Error', value: error, inline: false },
      { name: 'Client ID', value: clientId, inline: true },
    ],
    0xf59e0b
  ));
}

module.exports = { postScheduled, postPublished, postFailed, captionGenFailed };
