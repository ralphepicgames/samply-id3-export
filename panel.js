// panel.js — runs inside the extension iframe
// content.js handles all Pinia reads and background fetches.
// Protocol:  content→panel: tracks | audioData | audioError
//            panel→content: close | fetchAudio

'use strict';

let tracks = [];
let projectName = '';
let artDataUrl = null;
let artMime = null;
let zipBlob = null;
let running = false;

// ── Wire up button event listeners (no inline handlers — CSP compliance) ────
document.getElementById('closeBtn').addEventListener('click', closePanel);
document.getElementById('runBtn').addEventListener('click', startExport);
document.getElementById('dlBtn').addEventListener('click', triggerDownload);
document.getElementById('artDrop').addEventListener('click', () => document.getElementById('artFile').click());

// ── Art upload ──────────────────────────────────────────────────────────────
document.getElementById('artFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    artDataUrl = ev.target.result;
    artMime = file.type || 'image/jpeg';
    document.getElementById('artDrop').classList.add('has-art');
    document.getElementById('artThumb').src = artDataUrl;
    document.getElementById('artLabel').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

// ── Audio fetch promises ────────────────────────────────────────────────────
const audioPromises = {}; // trackId -> { resolve, reject }

function requestAudio(trackId, url) {
  return new Promise((resolve, reject) => {
    audioPromises[trackId] = { resolve, reject };
    parent.postMessage({ type: 'fetchAudio', trackId, url }, '*');
  });
}

// ── Messages from content script ───────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  if (!msg?.type) return;

  if (msg.type === 'tracks') {
    tracks = msg.tracks || [];
    projectName = msg.projectName || '';
    if (projectName && !document.getElementById('album').value) {
      document.getElementById('album').value = projectName;
    }
    renderTracks();
  }

  if (msg.type === 'audioData') {
    const p = audioPromises[msg.trackId];
    if (p) { p.resolve(new Uint8Array(msg.buffer)); delete audioPromises[msg.trackId]; }
  }

  if (msg.type === 'audioError') {
    const p = audioPromises[msg.trackId];
    if (p) { p.reject(new Error(msg.error)); delete audioPromises[msg.trackId]; }
  }
});

// ── UI helpers ──────────────────────────────────────────────────────────────
function closePanel() { parent.postMessage({ type: 'close' }, '*'); }

function sanitize(s) { return s.replace(/[\\/:*?"<>|]/g, '_').trim(); }
function pad(n, len) { return String(n).padStart(len, '0'); }
function stripExt(s) { return s.replace(/\.[^.]+$/, ''); }
function getExt(s)   { return (s.match(/\.([^.]+)$/) || [,'mp3'])[1].toLowerCase(); }
function escHtml(s)  { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function outFilename(num, total, artist, title, ext) {
  const parts = [pad(num, String(total).length)];
  if (artist) parts.push(sanitize(artist));
  parts.push(sanitize(title));
  return parts.join(' - ') + '.' + ext;
}

let trackEls = [];

function renderTracks() {
  const list  = document.getElementById('trackList');
  const label = document.getElementById('trackCountLabel');
  label.textContent = `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;

  if (!tracks.length) {
    list.innerHTML = '<p class="empty-msg">No tracks found in this project.</p>';
    return;
  }

  list.innerHTML = '';
  trackEls = [];
  const artist = document.getElementById('artist').value.trim();

  tracks.forEach((t, i) => {
    // t.name is the display title (may or may not have extension)
    // t.fileName is the original filename (used for extension)
    const ext   = getExt(t.fileName || t.name);
    const title = stripExt(t.name);
    const fname = outFilename(i + 1, tracks.length, artist, title, ext);
    const div   = document.createElement('div');
    div.className = 'track';
    div.innerHTML = `
      <span class="tn">${pad(i + 1, String(tracks.length).length)}</span>
      <span class="tname">${escHtml(title)}<span class="tout">${escHtml(fname)}</span></span>
      <span class="tst waiting">–</span>
    `;
    list.appendChild(div);
    trackEls.push(div);
  });
}

function setTrackState(i, state, label) {
  if (!trackEls[i]) return;
  trackEls[i].className = `track ${state}`;
  const st = trackEls[i].querySelector('.tst');
  if (st) { st.className = `tst ${state}`; st.textContent = label; }
}

function setProgress(done, total) {
  document.getElementById('progBar').style.width =
    total ? Math.round(done / total * 100) + '%' : '0%';
}

function setStatus(msg) { document.getElementById('statusLine').textContent = msg; }

function log(msg) {
  const el = document.getElementById('logEl');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}

// ── Export ──────────────────────────────────────────────────────────────────
async function startExport() {
  if (running) return;
  if (!tracks.length) { setStatus('No tracks found.'); return; }

  running = true;
  renderTracks();
  document.getElementById('runBtn').disabled = true;
  document.getElementById('dlBtn').classList.remove('visible');
  document.getElementById('progWrap').style.display = 'block';
  document.getElementById('logEl').textContent = '';
  zipBlob = null;

  const artist = document.getElementById('artist').value.trim();
  const album  = document.getElementById('album').value.trim();
  const year   = document.getElementById('year').value.trim();

  const zip = new JSZip();
  let done = 0;
  setProgress(0, tracks.length);

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const ext   = getExt(track.fileName || track.name);
    const title = stripExt(track.name);
    const fname = outFilename(i + 1, tracks.length, artist, title, ext);

    setTrackState(i, 'downloading', 'dl…');
    setStatus(`[${i + 1}/${tracks.length}] Downloading "${title}"…`);

    let bytes;
    try {
      bytes = await requestAudio(track.id, track.downloadUrl);
    } catch (err) {
      setTrackState(i, 'error', 'err');
      log(`✗ ${track.name}: ${err.message}`);
      done++; setProgress(done, tracks.length);
      continue;
    }

    let outBytes;
    if (ext === 'mp3') {
      setTrackState(i, 'tagging', 'tag…');
      try {
        outBytes = window.__id3.injectId3(bytes, {
          title,
          artist:     artist     || undefined,
          album:      album      || undefined,
          year:       year       || undefined,
          track:      i + 1,
          total:      tracks.length,
          artDataUrl: artDataUrl || undefined,
          artMime:    artMime    || undefined,
        });
      } catch (err) {
        log(`⚠ ${track.name}: ID3 failed (${err.message}), included raw`);
        outBytes = bytes;
      }
    } else {
      outBytes = bytes;
      log(`ℹ ${track.name}: not MP3, skipped tagging`);
    }

    zip.file(fname, outBytes);
    setTrackState(i, 'done', '✓');
    done++; setProgress(done, tracks.length);
  }

  // Generate M3U playlist
  const m3uLines = ['#EXTM3U'];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const ext = getExt(track.fileName || track.name);
    const title = stripExt(track.name);
    const fname = outFilename(i + 1, tracks.length, artist, title, ext);
    const durationSecs = track.duration ? Math.round(track.duration) : -1;
    const extinfArtist = artist ? `${artist} - ${title}` : title;
    m3uLines.push(`#EXTINF:${durationSecs},${extinfArtist}`);
    m3uLines.push(fname);
  }
  zip.file((sanitize(album || projectName || 'playlist')) + '.m3u', m3uLines.join('\n'));

  setStatus('Compressing…');
  zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });

  const successCount = trackEls.filter(el => el.classList.contains('done')).length;
  setStatus(`✓ ${successCount}/${tracks.length} tracks · ${(zipBlob.size / 1048576).toFixed(1)} MB`);
  setProgress(tracks.length, tracks.length);

  const albumName = album || projectName || 'samply-export';
  document.getElementById('dlBtn').textContent = `⬇ Save ${sanitize(albumName)}.zip`;
  document.getElementById('dlBtn').classList.add('visible');
  document.getElementById('runBtn').disabled = false;
  running = false;
}

function triggerDownload() {
  if (!zipBlob) return;
  const name = sanitize(document.getElementById('album').value.trim() || projectName || 'samply-export') + '.zip';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zipBlob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

document.getElementById('artist').addEventListener('input', () => {
  if (tracks.length && !running) renderTracks();
});
