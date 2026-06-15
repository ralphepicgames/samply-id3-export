// content.js
(() => {
  'use strict';

  let tracks = [];
  let projectName = '';
  let panelIframe = null;

  function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page.js');
    script.onload = function() { script.remove(); };
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== '__samplyID3Data__') return;
    if (e.data.error) { console.error('[Samply ID3]', e.data.error); return; }
    tracks = e.data.tracks;
    projectName = e.data.projectName;
    injectButton();
  });

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== '__samplyToken__') return;
    const { trackId, url, token, error } = e.data;
    if (error) { sendToPanel({ type: 'audioError', trackId, error }); return; }
    fetchViaBackground(url, token)
      .then(bytes => {
        panelIframe.contentWindow.postMessage(
          { type: 'audioData', trackId, buffer: bytes.buffer }, '*', [bytes.buffer]
        );
      })
      .catch(err => sendToPanel({ type: 'audioError', trackId, error: err.message }));
  });

  window.addEventListener('message', function(e) {
    if (!panelIframe || e.source !== panelIframe.contentWindow) return;
    const msg = e.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'close') { panelIframe.style.display = 'none'; return; }
    if (msg.type === 'fetchAudio') {
      window.postMessage({ type: '__samplyGetToken__', trackId: msg.trackId, url: msg.url }, '*');
    }
  });

  function injectButton() {
    if (document.getElementById('samply-id3-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'samply-id3-btn';
    btn.textContent = `⬇ Export with ID3 (${tracks.length} track${tracks.length !== 1 ? 's' : ''})`;
    btn.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:2147483647;
      background:#C8FF00;color:#111;border:none;border-radius:8px;
      padding:11px 18px;font-size:13px;font-weight:700;
      font-family:system-ui,sans-serif;cursor:pointer;
      box-shadow:0 4px 20px rgba(0,0,0,0.35);letter-spacing:0.01em;
    `;
    btn.onclick = openPanel;
    document.body.appendChild(btn);
  }

  function openPanel() {
    if (panelIframe) {
      panelIframe.style.display = 'block';
      sendToPanel({ type: 'tracks', tracks, projectName });
      return;
    }
    panelIframe = document.createElement('iframe');
    panelIframe.src = chrome.runtime.getURL('panel.html');
    panelIframe.style.cssText = `
      position:fixed;bottom:80px;right:24px;width:420px;height:580px;
      z-index:2147483646;border:none;border-radius:14px;
      box-shadow:0 8px 40px rgba(0,0,0,0.55);
    `;
    document.body.appendChild(panelIframe);
    panelIframe.addEventListener('load', () => sendToPanel({ type: 'tracks', tracks, projectName }));
  }

  function sendToPanel(msg) { panelIframe?.contentWindow?.postMessage(msg, '*'); }

  function fetchViaBackground(url, token) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'fetchAudio', url, token }, response => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!response) { reject(new Error('no response from background')); return; }
        if (response.ok) { const bin = atob(response.b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); resolve(bytes); }
        else reject(new Error(response.error || 'fetch failed'));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPageScript);
  } else {
    injectPageScript();
  }
})();
