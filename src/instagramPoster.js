/**
 * instagramPoster.js — Posts to Instagram via the Graph API.
 *
 * Flow for scheduled posts:
 *   1. Create media container (with scheduled_publish_time)
 *   2. Publish container at scheduled time (or Instagram auto-publishes)
 *
 * Supports: IMAGE, REELS
 * Requires: Instagram Business Account + Facebook App with instagram_basic,
 *           instagram_content_publish permissions.
 */

const axios = require('axios');

const IG_API_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Schedule a photo post to Instagram.
 * Returns the Instagram media container ID.
 */
async function scheduleImagePost({ accessToken, igUserId, imageUrl, caption, scheduledAt }) {
  // Step 1: Create media container
  const createResp = await axios.post(
    `${IG_API_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      },
      timeout: 15000,
    }
  );

  const containerId = createResp.data?.id;
  if (!containerId) throw new Error('Instagram: no container ID returned');

  console.log(`[instagram] Created media container: ${containerId}`);

  // Step 2: Publish (Instagram Graph API schedules via publish endpoint)
  // Note: Direct scheduling requires passing publish_time — only available
  // for creator studio / advanced access. For standard access, publish immediately.
  // We track scheduled_at in our DB and call publish at the right time.
  return containerId;
}

/**
 * Schedule a Reel to Instagram.
 */
async function scheduleReelPost({ accessToken, igUserId, videoUrl, caption, scheduledAt }) {
  const createResp = await axios.post(
    `${IG_API_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        access_token: accessToken,
      },
      timeout: 30000,
    }
  );

  const containerId = createResp.data?.id;
  if (!containerId) throw new Error('Instagram Reel: no container ID returned');

  // Poll until video is ready (status = FINISHED)
  await waitForVideoReady(accessToken, containerId);

  console.log(`[instagram] Reel container ready: ${containerId}`);
  return containerId;
}

/**
 * Actually publish a media container to Instagram.
 * Called by the publisher at scheduled_at time.
 */
async function publishContainer({ accessToken, igUserId, containerId }) {
  const resp = await axios.post(
    `${IG_API_BASE}/${igUserId}/media_publish`,
    null,
    {
      params: {
        creation_id: containerId,
        access_token: accessToken,
      },
      timeout: 15000,
    }
  );

  const postId = resp.data?.id;
  if (!postId) throw new Error('Instagram publish: no post ID returned');

  console.log(`[instagram] Published post: ${postId}`);
  return postId;
}

/**
 * Poll Instagram until a video container status is FINISHED or ERROR.
 */
async function waitForVideoReady(accessToken, containerId, maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(10000); // wait 10s between checks

    const resp = await axios.get(`${IG_API_BASE}/${containerId}`, {
      params: {
        fields: 'status_code',
        access_token: accessToken,
      },
      timeout: 10000,
    });

    const status = resp.data?.status_code;
    console.log(`[instagram] Video status (attempt ${i + 1}): ${status}`);

    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error('Instagram video processing failed');
  }

  throw new Error('Instagram video processing timed out');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { scheduleImagePost, scheduleReelPost, publishContainer };
