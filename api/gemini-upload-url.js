// Returns a Gemini resumable upload URL so the client can upload directly
// — video bytes never touch Vercel, bypassing the 4.5 MB body limit
const GEMINI_KEY = (process.env.GEMINI_API_KEY    || '').replace(/\s+/g, '');
const SUPA_URL   = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON  = (process.env.SUPABASE_ANON_KEY || '').replace(/\s+/g, '');

async function verifyToken(token) {
  const r = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPA_ANON }
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });

  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (token) {
    const user = await verifyToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
  }

  const { mimeType = 'video/mp4', fileSize } = req.body || {};
  if (!fileSize) return res.status(400).json({ error: 'fileSize required' });

  try {
    const initRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol':              'resumable',
          'X-Goog-Upload-Command':               'start',
          'X-Goog-Upload-Header-Content-Length': String(fileSize),
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

    res.json({ uploadUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
