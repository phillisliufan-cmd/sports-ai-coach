// Forwards one chunk to Gemini resumable upload
// Each chunk ≤ 3 MB stays under Vercel's 4.5 MB infrastructure limit
export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const uploadUrl = req.headers['x-upload-url'];
  const offset    = req.headers['x-upload-offset'] || '0';
  const isLast    = req.headers['x-upload-is-last'] === 'true';

  if (!uploadUrl) return res.status(400).json({ error: 'x-upload-url header required' });

  try {
    const body = await readBody(req);

    const geminiRes = await fetch(uploadUrl, {
      method:  'POST',
      headers: {
        'Content-Length':        String(body.length),
        'X-Goog-Upload-Offset':  String(parseInt(offset, 10)),
        'X-Goog-Upload-Command': isLast ? 'upload, finalize' : 'upload',
      },
      body,
    });

    // 200/308 are success states for resumable uploads
    if (geminiRes.status !== 200 && geminiRes.status !== 308) {
      const txt = await geminiRes.text();
      return res.status(502).json({ error: `Gemini ${geminiRes.status}: ${txt}` });
    }

    if (isLast) {
      const data = await geminiRes.json();
      const uri  = data.file?.uri;
      const name = data.file?.name;
      if (!uri) return res.status(502).json({ error: 'No file URI from Gemini' });
      return res.json({ uri, name });
    }

    res.json({ ok: true });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}
