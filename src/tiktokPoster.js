/**
 * tiktokPoster.js — Posts to TikTok via the Content Posting API.
 *
 * Supports: Photo posts, Video posts
 * Requires: TikTok Developer App with video.publish scope.
 *
 * TikTok API flow:
 *   1. Init upload → get upload_url + publish_id
 *   2. Upload media to upload_url
 *   3. Check publish status
 */
const axios = require('axios');
const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

/**
 * Post a photo to TikTok.
 */
async function postPhoto({ accessToken, imageUrl, caption }) {
  let initResp;
  try {
    initResp = await axios.post(
      `${TIKTOK_API_BASE}/post/publish/content/init/`,
      {
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: [imageUrl],
        },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        timeout: 20000,
      }
    );
  } catch (err) {
    console.error(`[tiktok] Photo init failed:`, JSON.stringify(err.response?.data));
    throw err;
  }

  console.log(`[tiktok] Photo init response:`, JSON.stringify(initResp.data));
  const publishId = initResp.data?.data?.publish_id;
  if (!publishId) throw new Error(`TikTok photo init failed: ${JSON.stringify(initResp.data)}`);
  console.log(`[tiktok] Photo post initiated: publish_id=${publishId}`);
  await waitForTiktokPublish(accessToken, publishId);
  return publishId;
}

/**
 * Post a video to TikTok via URL pull.
 */
async function postVideo({ accessToken, videoUrl, caption }) {
  let initResp;
  try {
    initResp = await axios.post(
      `${TIKTOK_API_BASE}/post/publish/video/init/`,
      {
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: videoUrl,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        timeout: 20000,
      }
    );
  } catch (err) {
    console.error(`[tiktok] Video init failed:`, JSON.stringify(err.response?.data));
    throw err;
  }

  console.log(`[tiktok] Video init response:`, JSON.stringify(initResp.data));
  const publishId = initResp.data?.data?.publish_id;
  if (!publishId) throw new Error(`TikTok video init failed: ${JSON.stringify(initResp.data)}`);
  console.log(`[tiktok] Video post initiated: publish_id=${publishId}`);
  await waitForTiktokPublish(accessToken, publishId);
  return publishId;
}

/**
 * Poll TikTok publish status until PUBLISH_COMPLETE or FAILED.
 */
async function waitForTiktokPublish(accessToken, publishId, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(8000);
    let resp;
    try {
      resp = await axios.post(
        `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
        { publish_id: publishId },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          timeout: 10000,
        }
      );
    } catch (err) {
      console.error(`[tiktok] Status fetch failed:`, JSON.stringify(err.response?.data));
      throw err;
    }

    const status = resp.data?.data?.status;
    console.log(`[tiktok] Publish status (attempt ${i + 1}): ${status}`);
    if (status === 'PUBLISH_COMPLETE') return;
    if (status === 'FAILED') {
      const reason = resp.data?.data?.fail_reason || 'unknown';
      throw new Error(`TikTok publish failed: ${reason}`);
    }
  }
  throw new Error('TikTok publish timed out');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { postPhoto, postVideo };
