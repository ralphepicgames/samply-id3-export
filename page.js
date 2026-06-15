// page.js — runs in PAGE world, reads Pinia, postMessages back to content script

(function poll(attempts) {
  try {
    const app = document.querySelector('#app').__vue_app__;
    const pinia = app.config.globalProperties.$pinia;
    const projectState = pinia.state.value['project'];
    if (!projectState || !projectState.boxSnaps || !projectState.boxSnaps.length) throw new Error('not ready');

    const AUDIO_EXTS = /\.(mp3|m4a|wav|aiff?|flac|ogg|opus|aac|wma)$/i;

    const GCS_BASE = 'https://storage.googleapis.com/samply-a03ff.appspot.com/';
    const orderMap = (projectState.projectData && projectState.projectData.order) || {};
    const boxSnaps = projectState.boxSnaps;
    const pName = (projectState.projectData && projectState.projectData.name) || '';

    const token = pinia._s.get('profile-auth-module').user.accessToken;

    // Build a lookup by Firestore document ID (last segment of path)
    const snapById = {};
    for (const snap of boxSnaps) {
      // snap.id is the document ID
      snapById[snap.id] = snap;
    }

    const fileTracks = [];
    const stackGroups = {};

    for (const snap of boxSnaps) {
      let d;
      try { d = snap.data(); } catch (e) { continue; }
      if (!d || d.trashed) continue;

      if (d.type === 'file') {
        // Standalone file (not inside a stack) — only include if not referenced by any stack
        const gcsPath = d.asset || (d.audio && d.audio.src && d.audio.src.compressed);
        if (!gcsPath) continue;
        let fileName;
        try { fileName = decodeURIComponent(d.name || snap.id); } catch (e) { fileName = d.name || snap.id; }
        if (!AUDIO_EXTS.test(fileName)) continue;
        fileTracks.push({
          id: snap.id,
          name: fileName,       // will be stripped of extension for display/ID3
          fileName,
          gcsPath,
          isStandaloneFile: true,
          trackNum: (orderMap[snap.id] != null) ? orderMap[snap.id] : 9999,
          downloadUrl: GCS_BASE + gcsPath,
        });
      } else if (d.type === 'stack') {
        // d.name is the user-set track title e.g. "Brain in Mouth"
        // d.children is { childKey: { name: 'v1', ref: DocumentRef }, ... }
        stackGroups[snap.id] = {
          stackId: snap.id,
          name: d.name || snap.id,
          children: d.children || {},
          trackNum: (orderMap[snap.id] != null) ? orderMap[snap.id] : 9999,
        };
      }
    }

    // Collect all doc IDs that belong to a stack so we can exclude them from standalone files
    const ownedByStack = new Set();
    for (const sid in stackGroups) {
      const stack = stackGroups[sid];
      for (const childKey in stack.children) {
        const child = stack.children[childKey];
        // Resolve the actual document ID from the ref path segments
        let docId = null;
        try {
          const segs = child.ref._key.path.segments;
          docId = segs[segs.length - 1]; // last segment is the doc ID
        } catch (e) {}
        if (docId) ownedByStack.add(docId);
      }
    }

    // Remove standalone files that are actually stack children
    for (let i = fileTracks.length - 1; i >= 0; i--) {
      if (ownedByStack.has(fileTracks[i].id)) {
        fileTracks.splice(i, 1);
      }
    }

    // For each stack, find the "main" version child and use the stack's name as title
    for (const sid in stackGroups) {
      const stack = stackGroups[sid];
      const childKeys = Object.keys(stack.children).sort(); // Firebase push IDs sort lexicographically by time
      // Last sorted key = most recent version
      const mainKey = childKeys[childKeys.length - 1];
      if (!mainKey) continue;

      const child = stack.children[mainKey];
      let docId = null;
      try {
        const segs = child.ref._key.path.segments;
        docId = segs[segs.length - 1];
      } catch (e) { continue; }

      const childSnap = snapById[docId] || boxSnaps.find(s => s.id === docId);
      if (!childSnap) continue;
      let d;
      try { d = childSnap.data(); } catch (e) { continue; }
      if (!d || d.trashed || d.type !== 'file') continue;

      const gcsPath = d.asset || (d.audio && d.audio.src && d.audio.src.compressed);
      if (!gcsPath) continue;

      let fileName;
      try { fileName = decodeURIComponent(d.name || docId); } catch (e) { fileName = d.name || docId; }
      if (!AUDIO_EXTS.test(fileName)) continue;

      const ext = (fileName.match(/\.[^.]+$/) || ['.mp3'])[0];

      fileTracks.push({
        id: docId,
        name: stack.name + ext,   // "Brain in Mouth.mp3" — stack title is the track name
        fileName: stack.name + ext,
        gcsPath,
        trackNum: stack.trackNum,
        downloadUrl: GCS_BASE + gcsPath,
      });
    }

    fileTracks.sort(function(a, b) { return a.trackNum - b.trackNum; });
    const numbered = fileTracks.map(function(t, i) { return Object.assign({}, t, { trackNum: i + 1 }); });

    window.postMessage({ type: '__samplyID3Data__', tracks: numbered, projectName: pName, token: token }, '*');

  } catch (e) {
    if (attempts > 100) {
      window.postMessage({ type: '__samplyID3Data__', error: 'Pinia not ready: ' + e.message }, '*');
      return;
    }
    setTimeout(function() { poll(attempts + 1); }, 300);
  }
})(0);

// Listen for token refresh requests from content script
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === '__samplyGetToken__') {
    try {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const token = pinia._s.get('profile-auth-module').user.accessToken;
      window.postMessage({ type: '__samplyToken__', token: token, trackId: e.data.trackId, url: e.data.url }, '*');
    } catch (err) {
      window.postMessage({ type: '__samplyToken__', error: err.message, trackId: e.data.trackId }, '*');
    }
  }
});
