// Receives one chunk and forwards it to Gemini resumable upload
// Each chunk is ≤ 3 MB, well under Vercel's 4.5 MB body limit
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
    const chunk = await readBody(req);

    const uploadRes = await fetch(uploadUrl, {
      method:  'POST',
      headers: {
        'Content-Length':        String(chunk.length),
        'X-Goog-Upload-Offset':  offset,
        'X-Goog-Upload-Command': isLast ? 'upload, finalize' : 'upload',
      },
      body: chunk,
    });

    if (!uploadRes.ok && uploadRes.status !== 308) {
      const err = await uploadRes.text();
      return res.status(502).json({ error: 'Gemini chunk failed: ' + err });
    }

    if (isLast) {
      const fileData = await uploadRes.json();
      const uri  = fileData.file?.uri;
      const name = fileData.file?.name;
      if (!uri) return res.status(502).json({ error: 'No file URI from Gemini' });
      return res.json({ uri, name });
    }

    res.json({ ok: true });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}
