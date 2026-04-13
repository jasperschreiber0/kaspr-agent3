/**
 * notifier.js — WhatsApp notifications to clients via Twilio.
 * Agent 3 uses this to send scheduling confirmations and caption previews.
 */

const twilio = require('twilio');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

/**
 * Send a WhatsApp message to a specific phone number.
 */
async function send(to, message) {
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  try {
    await twilioClient.messages.create({ from: FROM, to: toFormatted, body: message });
    console.log(`[notifier] Sent WhatsApp to ${to}`);
  } catch (err) {
    console.warn(`[notifier] Failed to send to ${to}: ${err.message}`);
  }
}

/**
 * Notify all authorised staff numbers for a client.
 * Sends to the first number only (primary contact) to avoid spam.
 */
async function notifyClient(client, message) {
  const numbers = client.whatsapp_numbers || [];
  if (numbers.length === 0) {
    console.warn(`[notifier] No WhatsApp numbers for client ${client.id}`);
    return;
  }
  // Send to primary number only
  await send(numbers[0], message);
}

// ─── MESSAGE TEMPLATES ───────────────────────────────────────────────────────

function scheduledMessage(businessName, instagramTime, tiktokTime) {
  return (
    `✅ Content queued for *${businessName}*!\n\n` +
    `📸 Instagram: ${instagramTime}\n` +
    `🎵 TikTok: ${tiktokTime}\n\n` +
    `Reply *PREVIEW* to see the caption before it goes live.`
  );
}

function previewMessage(instagramCaption, instagramHashtags, tiktokCaption, tiktokHashtags) {
  const igTags = instagramHashtags.map(t => `#${t}`).join(' ');
  const ttTags = tiktokHashtags.map(t => `#${t}`).join(' ');

  return (
    `📋 *Caption Preview*\n\n` +
    `*Instagram:*\n${instagramCaption}\n${igTags}\n\n` +
    `*TikTok:*\n${tiktokCaption} ${ttTags}\n\n` +
    `Reply *GO* to confirm, or *EDIT [your changes]* to adjust ✏️`
  );
}

function postedMessage(businessName, platform, postUrl = null) {
  const urlLine = postUrl ? `\n🔗 ${postUrl}` : '';
  return `🚀 Just posted to *${platform}* for ${businessName}!${urlLine}`;
}

function errorMessage(businessName) {
  return (
    `⚠️ Something went wrong posting for *${businessName}*. ` +
    `Our team has been notified and will fix it ASAP.`
  );
}

module.exports = {
  notifyClient,
  send,
  scheduledMessage,
  previewMessage,
  postedMessage,
  errorMessage,
};
