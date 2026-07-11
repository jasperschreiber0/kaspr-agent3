const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const discord = require('./discord');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000; // refresh once within 2h of expiry
const IG_WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // warn 7 days before IG token dies

/**
 * TikTok access tokens are short-lived (~24h) but each grants a
 * refresh_token valid ~365 days. Without actively refreshing, TikTok
 * publishing would go silently dead about a day after each client
 * connects. Runs from the publisher's tick loop.
 */
async function refreshExpiringTikTokTokens() {
  const cutoff = new Date(Date.now() + TIKTOK_REFRESH_MARGIN_MS).toISOString();

  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, business_name, tiktok_refresh_token, tiktok_token_expires_at')
    .eq('active', true)
    .not('tiktok_refresh_token', 'is', null)
    .lte('tiktok_token_expires_at', cutoff);

  if (error) {
    console.warn('[tokenRefresh] TikTok lookup failed:', error.message);
    return;
  }
  if (!clients || clients.length === 0) return;

  for (const client of clients) {
    try {
      const resp = await axios.post(
        TIKTOK_TOKEN_URL,
        new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY,
          client_secret: process.env.TIKTOK_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: client.tiktok_refresh_token,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
      );

      const { access_token, refresh_token, expires_in } = resp.data || {};
      if (!access_token) {
        throw new Error(`No access_token in refresh response: ${JSON.stringify(resp.data)}`);
      }

      await supabase
        .from('clients')
        .update({
          tiktok_access_token: access_token,
          // TikTok rotates refresh tokens on use — fall back to the old
          // one only if a new one genuinely wasn't returned.
          tiktok_refresh_token: refresh_token || client.tiktok_refresh_token,
          tiktok_token_expires_at: new Date(Date.now() + (expires_in || 86400) * 1000).toISOString(),
        })
        .eq('id', client.id);

      console.log(`[tokenRefresh] Refreshed TikTok token for ${client.business_name}`);
    } catch (err) {
      console.error(`[tokenRefresh] TikTok refresh failed for ${client.business_name}:`, err.message);
      await discord.postFailed({
        businessName: client.business_name,
        clientId: client.id,
        platform: 'TikTok (token refresh)',
        error: err.message,
      });
    }
  }
}

/**
 * Instagram's long-lived (60-day) token can't be silently refreshed with
 * this OAuth flow — Meta requires the owner to click through consent
 * again. We can't automate that, so instead we warn well before it dies,
 * with the reconnect link right there, rather than discovering it when
 * DM replies start failing.
 */
async function warnExpiringInstagramTokens() {
  const cutoff = new Date(Date.now() + IG_WARNING_WINDOW_MS).toISOString();

  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, business_name, instagram_token_expires_at')
    .eq('active', true)
    .not('instagram_token_expires_at', 'is', null)
    .lte('instagram_token_expires_at', cutoff);

  if (error) {
    console.warn('[tokenRefresh] Instagram lookup failed:', error.message);
    return;
  }
  if (!clients || clients.length === 0) return;

  for (const client of clients) {
    console.warn(
      `[tokenRefresh] Instagram token for ${client.business_name} expires ${client.instagram_token_expires_at}`
    );
    await discord.postFailed({
      businessName: client.business_name,
      clientId: client.id,
      platform: 'Instagram (token expiring soon)',
      error:
        `Expires ${client.instagram_token_expires_at}. Send them ` +
        `/auth/instagram/connect?client_id=${client.id} on agent1 to reconnect before it dies.`,
    });
  }
}

let lastRunAt = 0;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly is plenty for both checks

/**
 * Call this from the publisher tick loop. No-ops unless an hour has
 * passed since the last run, so it doesn't hammer TikTok's refresh
 * endpoint or spam Discord every 30s tick.
 */
async function runTokenHealthChecks() {
  if (Date.now() - lastRunAt < CHECK_INTERVAL_MS) return;
  lastRunAt = Date.now();
  await refreshExpiringTikTokTokens();
  await warnExpiringInstagramTokens();
}

module.exports = { runTokenHealthChecks };
