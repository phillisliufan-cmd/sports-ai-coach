export const config = { runtime: 'edge' };

const GEMINI_KEY = (process.env.GEMINI_API_KEY       || '').replace(/\s+/g, '');
const SUPA_URL   = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON  = (process.env.SUPABASE_ANON_KEY    || '').replace(/\s+/g, '');

async function verifyToken(token) {
  const r = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPA_ANON }
  });
  if (!r.ok) return null;
  return r.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!GEMINI_KEY) return json({ error: 'Gemini API key not configured' }, 500);

  // Optional auth check
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    const user = await verifyToken(token);
    if (!user) return json({ error: 'Invalid session' }, 401);
  }

  const mimeType = request.headers.get('x-mime-type') || 'video/mp4';
  const fileSize = request.headers.get('content-length');
  if (!fileSize) return json({ error: 'content-length header required' }, 400);

  try {
    // ── Step 1: Start resumable upload session with Gemini ────────────────
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
      return json({ error: 'Gemini init failed: ' + err }, 502);
    }

    const uploadUrl = initRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) return json({ error: 'No upload URL from Gemini' }, 502);

    // ── Step 2: Stream video body directly to Gemini (no buffering) ───────
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length':        fileSize,
        'X-Goog-Upload-Offset':  '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: request.body,   // ReadableStream — no buffering in memory
      // @ts-ignore duplex required for streaming request body
      duplex: 'half',
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return json({ error: 'Gemini upload failed: ' + err }, 502);
    }

    const fileData = await uploadRes.json();
    const uri  = fileData.file?.uri;
    const name = fileData.file?.name;
    if (!uri) return json({ error: 'No file URI returned from Gemini' }, 502);

    return json({ uri, name, mimeType });

  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
