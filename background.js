// background.js — MV3 service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ping') {
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'fetchAudio') {
    const { url, token } = msg;
    (async () => {
      try {
        const GCS_BASE = 'https://storage.googleapis.com/samply-a03ff.appspot.com/';
        let gcsPath = url.startsWith(GCS_BASE) ? url.slice(GCS_BASE.length) : url;

        const metaUrl = 'https://firebasestorage.googleapis.com/v0/b/samply-a03ff.appspot.com/o/'
          + encodeURIComponent(gcsPath);

        const metaRes = await fetch(metaUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!metaRes.ok) throw new Error(`metadata HTTP ${metaRes.status}`);
        const meta = await metaRes.json();

        const downloadToken = meta.downloadTokens?.split(',')[0];
        if (!downloadToken) throw new Error('no downloadTokens in metadata');

        const audioRes = await fetch(metaUrl + '?alt=media&token=' + downloadToken);
        if (!audioRes.ok) throw new Error(`audio HTTP ${audioRes.status}`);

        const buffer = await audioRes.arrayBuffer();
        // base64 ~1.33x size, well under 64MiB chrome message limit
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        sendResponse({ ok: true, b64: btoa(binary) });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});
