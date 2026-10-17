// المبلغ المجموع: قراءة (GET) وتحديث من صفحة الإدارة (POST مع الرمز)
// يحتاج على Vercel: قاعدة Upstash Redis مربوطة بالمشروع + متغير ADMIN_PIN

const GOAL = 7000;
const KEY = 'fatihoun:raised';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(path) {
  const r = await fetch(URL_ + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!URL_ || !TOKEN) {
    return res.status(500).json({ error: 'storage-not-connected' });
  }

  try {
    if (req.method === 'GET') {
      const { result } = await redis('/get/' + KEY);
      return res.status(200).json({ goal: GOAL, raised: Number(result) || 0 });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (!process.env.ADMIN_PIN || String(body.pin || '') !== String(process.env.ADMIN_PIN)) {
        await new Promise(r => setTimeout(r, 800));
        return res.status(401).json({ error: 'wrong-pin' });
      }
      const raised = Math.round(Number(body.raised));
      if (!Number.isFinite(raised) || raised < 0 || raised > 1000000) {
        return res.status(400).json({ error: 'bad-amount' });
      }
      await redis('/set/' + KEY + '/' + raised);
      return res.status(200).json({ goal: GOAL, raised });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
