const GEMINI_KEY    = (process.env.GEMINI_API_KEY         || '').replace(/\s+/g, '');
const SUPA_URL      = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON     = (process.env.SUPABASE_ANON_KEY      || '').replace(/\s+/g, '');

async function verifyToken(token) {
  const res = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPA_ANON }
  });
  if (!res.ok) return null;
  return await res.json();
}

// Collect readable stream into a Buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });

  // Optional auth check
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (token) {
    const user = await verifyToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
  }

  const mimeType   = req.headers['x-mime-type']    || 'video/mp4';
  const fileSize   = req.headers['content-length'];

  if (!fileSize) return res.status(400).json({ error: 'content-length header required' });

  try {
    // ── Step 1: Start resumable upload with Gemini Files API ──────────────
    const initRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol':              'resumable',
          'X-Goog-Upload-Command':               'start',
          'X-Goog-Upload-Header-Content-Length': fileSize,
          'X-Goog-Upload-Header-Content-Type':   mimeType,
          'Content-Type':                        'application/json',
        },
        body: JSON.stringify({ file: { display_name: 'sports_video' } }),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      return res.status(502).json({ error: 'Gemini init failed: ' + err });
    }

    const uploadUrl = initRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) return res.status(502).json({ error: 'No upload URL from Gemini' });

    // ── Step 2: Buffer video from client and upload to Gemini ─────────────
    const videoBuffer = await streamToBuffer(req);

    const uploadRes = await fetch(uploadUrl, {
      method:  'POST',
      headers: {
        'Content-Length':        videoBuffer.length,
        'X-Goog-Upload-Offset':  '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: videoBuffer,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return res.status(502).json({ error: 'Gemini upload failed: ' + err });
    }

    const fileData = await uploadRes.json();
    const uri  = fileData.file?.uri;
    const name = fileData.file?.name;

    if (!uri) return res.status(502).json({ error: 'No file URI returned from Gemini' });

    return res.status(200).json({ uri, name, mimeType });

  } catch (err) {
    console.error('gemini-upload error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};
