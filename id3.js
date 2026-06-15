// ID3v2.3 writer — no dependencies

function encodeUtf16le(str) {
  // UTF-16 LE with BOM
  const buf = new Uint8Array(2 + str.length * 2);
  buf[0] = 0xFF; buf[1] = 0xFE; // BOM
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    buf[2 + i * 2] = c & 0xFF;
    buf[2 + i * 2 + 1] = (c >> 8) & 0xFF;
  }
  return buf;
}

function textFrame(id, text) {
  const encoded = encodeUtf16le(text);
  // 1 byte encoding flag + encoded bytes
  const frameData = new Uint8Array(1 + encoded.length);
  frameData[0] = 0x01; // UTF-16
  frameData.set(encoded, 1);

  const buf = new Uint8Array(10 + frameData.length);
  for (let i = 0; i < 4; i++) buf[i] = id.charCodeAt(i);
  const sz = frameData.length;
  buf[4] = (sz >> 24) & 0xFF;
  buf[5] = (sz >> 16) & 0xFF;
  buf[6] = (sz >> 8)  & 0xFF;
  buf[7] =  sz        & 0xFF;
  buf[8] = 0; buf[9] = 0; // flags
  buf.set(frameData, 10);
  return buf;
}

function apicFrame(dataUrl, mimeType) {
  const b64 = dataUrl.split(',')[1];
  const raw = atob(b64);
  const imgBytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) imgBytes[i] = raw.charCodeAt(i);

  const mime = new TextEncoder().encode(mimeType + '\0');
  // encoding(1) + mime + null + picType(1) + desc(null byte) + img
  const frameData = new Uint8Array(1 + mime.length + 1 + 1 + imgBytes.length);
  let o = 0;
  frameData[o++] = 0x00; // ISO-8859-1 encoding for mime/desc
  frameData.set(mime, o); o += mime.length;
  frameData[o++] = 0x03; // front cover
  frameData[o++] = 0x00; // empty description
  frameData.set(imgBytes, o);

  const buf = new Uint8Array(10 + frameData.length);
  const id = 'APIC';
  for (let i = 0; i < 4; i++) buf[i] = id.charCodeAt(i);
  const sz = frameData.length;
  buf[4] = (sz >> 24) & 0xFF;
  buf[5] = (sz >> 16) & 0xFF;
  buf[6] = (sz >> 8)  & 0xFF;
  buf[7] =  sz        & 0xFF;
  buf[8] = 0; buf[9] = 0;
  buf.set(frameData, 10);
  return buf;
}

function stripOldId3(bytes) {
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const sz =
      ((bytes[6] & 0x7F) << 21) |
      ((bytes[7] & 0x7F) << 14) |
      ((bytes[8] & 0x7F) << 7)  |
       (bytes[9] & 0x7F);
    return bytes.slice(10 + sz);
  }
  return bytes;
}

function buildId3(fields) {
  const frames = [];
  if (fields.title)    frames.push(textFrame('TIT2', fields.title));
  if (fields.artist)   frames.push(textFrame('TPE1', fields.artist));
  if (fields.album)    frames.push(textFrame('TALB', fields.album));
  if (fields.year)     frames.push(textFrame('TDRC', String(fields.year)));
  if (fields.track)    frames.push(textFrame('TRCK', `${fields.track}/${fields.total}`));
  if (fields.artDataUrl && fields.artMime) {
    frames.push(apicFrame(fields.artDataUrl, fields.artMime));
  }

  const framesSize = frames.reduce((s, f) => s + f.length, 0);

  // Syncsafe size
  const header = new Uint8Array(10);
  header[0] = 0x49; header[1] = 0x44; header[2] = 0x33; // "ID3"
  header[3] = 0x03; header[4] = 0x00; // v2.3.0
  header[5] = 0x00; // flags
  header[6] = (framesSize >> 21) & 0x7F;
  header[7] = (framesSize >> 14) & 0x7F;
  header[8] = (framesSize >> 7)  & 0x7F;
  header[9] =  framesSize        & 0x7F;

  const tag = new Uint8Array(10 + framesSize);
  tag.set(header, 0);
  let off = 10;
  for (const f of frames) { tag.set(f, off); off += f.length; }
  return tag;
}

function injectId3(audioBytes, fields) {
  const stripped = stripOldId3(audioBytes);
  const tag = buildId3(fields);
  const out = new Uint8Array(tag.length + stripped.length);
  out.set(tag, 0);
  out.set(stripped, tag.length);
  return out;
}

window.__id3 = { injectId3, buildId3 };
