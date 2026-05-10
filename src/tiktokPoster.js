/**
 * tiktokPoster.js — Posts to TikTok via the Content Posting API.
 *
 * Supports: Photo posts, Video posts
 * Uses FILE_UPLOAD mode (not PULL_FROM_URL) to avoid domain verification requirement.
 */
const axios = require('axios');
const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

/**
 * Post a video to TikTok via file upload.
 */
async function postVideo({ accessToken, videoUrl, caption }) {
  // Step 1: Download video from Supabase
  console.log(`[tiktok] Downloading video from:`, videoUrl);
  const videoResp = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const videoBuffer = Buffer.from(videoResp.data);
  const videoSize = videoBuffer.length;
  console.log(`[tiktok] Video downloaded: ${videoSize} bytes`);

  // Step 2: Init upload
  let initResp;
  try {
    initResp = await axios.post(
     `${TIKTOK_API_BASE}/post/publish/inbox/video/init/`,
      {
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: 'SELF_ONLY',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
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
  const uploadUrl = initResp.data?.data?.upload_url;
  if (!publishId || !uploadUrl) throw new Error(`TikTok video init failed: ${JSON.stringify(initResp.data)}`);
  console.log(`[tiktok] Upload URL received, publish_id=${publishId}`);

  // Step 3: Upload video chunk
  try {
    await axios.put(uploadUrl, videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
        'Content-Length': videoSize,
      },
      timeout: 60000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    console.log(`[tiktok] Video chunk uploaded`);
  } catch (err) {
    console.error(`[tiktok] Video upload failed:`, JSON.stringify(err.response?.data));
    throw err;
  }

  // Step 4: Poll for completion
  await waitForTiktokPublish(accessToken, publishId);
  return publishId;
}

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
    if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') return;
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
