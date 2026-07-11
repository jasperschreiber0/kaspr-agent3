// tiktokAuth.js — TikTok OAuth flow for kaspr-agent3
// Routes: GET /auth/tiktok?client_id=UUID
//         GET /auth/callback
 
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
 
// Must match exactly what's registered in the TikTok developer portal
const REDIRECT_URI = 'https://kaspr-agent3-production.up.railway.app/auth/callback';
 
// Scopes — only what you actually use
const SCOPES = 'video.publish,video.upload';
 
// In-memory state store (survives the OAuth round-trip, ~10 min window)
// Fine for low-volume onboarding use case
const stateStore = new Map();
 
// ─── Step 1: Initiate OAuth ───────────────────────────────────────────────────
// Usage: https://kaspr-agent3.up.railway.app/auth/tiktok?client_id=<UUID>
router.get('/auth/tiktok', (req, res) => {
  const { client_id } = req.query;
 
  if (!client_id) {
    return res.status(400).send('Missing client_id parameter.');
  }
 
  // Generate a random state token, store client_id against it
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { client_id, createdAt: Date.now() });
 
  // Clean up states older than 10 minutes
  for (const [key, val] of stateStore.entries()) {
    if (Date.now() - val.createdAt > 10 * 60 * 1000) stateStore.delete(key);
  }
 
  const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
  authUrl.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
 
  res.redirect(authUrl.toString());
});
 
// ─── Step 2: OAuth Callback ───────────────────────────────────────────────────
router.get('/auth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
 
  // User denied or TikTok returned an error
  if (error) {
    console.error('[TikTok OAuth] Error returned:', error, error_description);
    return res.status(400).send(`TikTok auth failed: ${error_description || error}`);
  }
 
  // Validate state
  const stateData = stateStore.get(state);
  if (!stateData) {
    return res.status(400).send('Invalid or expired state. Please start the auth flow again.');
  }
  stateStore.delete(state);
 
  const { client_id } = stateData;
 
  // Exchange code for access token
  let tokenData;
  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });
 
    tokenData = await tokenRes.json();
 
    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }
  } catch (err) {
    console.error('[TikTok OAuth] Token exchange failed:', err.message);
    return res.status(500).send(`Token exchange failed: ${err.message}`);
  }
 
  const { access_token, refresh_token, expires_in, open_id } = tokenData;
  // TikTok access tokens are short-lived (~24h) — this expiry is what
  // tokenRefresh.js uses to know when to proactively refresh, and
  // refresh_token is what makes that refresh possible at all.
  const tokenExpiresAt = new Date(Date.now() + (expires_in || 86400) * 1000).toISOString();
 
  // Store in Supabase against the client row
  const { error: dbError } = await supabase
    .from('clients')
    .update({
      tiktok_access_token: access_token,
      tiktok_refresh_token: refresh_token,
      tiktok_token_expires_at: tokenExpiresAt,
      tiktok_account_id: open_id,
    })
    .eq('id', client_id);
 
  if (dbError) {
    console.error('[TikTok OAuth] Supabase update failed:', dbError.message);
    return res.status(500).send(`Failed to save TikTok credentials: ${dbError.message}`);
  }
 
  console.log(`[TikTok OAuth] Connected TikTok for client ${client_id} (open_id: ${open_id}), expires ${tokenExpiresAt}`);
 
  // Success — show a simple confirmation page
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>TikTok Connected — Kaspr</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff; }
          .box { text-align: center; }
          h1 { font-size: 2rem; margin-bottom: 0.5rem; }
          p { color: #aaa; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>✅ TikTok Connected</h1>
          <p>Your TikTok account has been linked to Kaspr.</p>
          <p>You can close this window.</p>
        </div>
      </body>
    </html>
  `);
});
 
module.exports = router;
