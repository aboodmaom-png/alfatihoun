// المبلغ المجموع لكل صفحة: العامة بالشيكل، بو أحمد بالريال، أم أحمد بالشيكل (لكلٍّ هدف 7,000)
// GET  /api/amount            ← الصفحة العامة {goal, raised}
// GET  /api/amount?p=vip      ← صفحة بو أحمد  {goal, raised}
// GET  /api/amount?p=um       ← صفحة أم أحمد  {goal, raised}
// GET  /api/amount?p=all      ← صفحة الإدارة  {public:{...}, vip:{...}}
// POST /api/amount {pin, public?, vip?, um?}  ← تحديث من صفحة الإدارة
// يحتاج على Vercel: قاعدة Upstash Redis مربوطة بالمشروع + متغير ADMIN_PIN

const PAGES = {
  public: { key: 'fatihoun:raised-ils', goal: 7000 }, // شيكل
  vip:    { key: 'fatihoun:raised-sar', goal: 7000 }, // ريال
  um:     { key: 'fatihoun:raised-um',  goal: 7000 }, // شيكل
};

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(path) {
  const r = await fetch(URL_ + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}

async function read(name) {
  const { result } = await redis('/get/' + PAGES[name].key);
  return { goal: PAGES[name].goal, raised: Number(result) || 0 };
}

async function readAll() {
  const out = {};
  for (const name of Object.keys(PAGES)) out[name] = await read(name);
  return out;
}

function amount(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!URL_ || !TOKEN) {
    return res.status(500).json({ error: 'storage-not-connected' });
  }

  try {
    const p = (req.query && req.query.p) || 'public';

    if (req.method === 'GET') {
      if (p === 'all') return res.status(200).json(await readAll());
      return res.status(200).json(await read(PAGES[p] ? p : 'public'));
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (!process.env.ADMIN_PIN || String(body.pin || '') !== String(process.env.ADMIN_PIN)) {
        await new Promise(r => setTimeout(r, 800));
        return res.status(401).json({ error: 'wrong-pin' });
      }
      for (const name of Object.keys(PAGES)) {
        if (body[name] === undefined || body[name] === '') continue;
        const n = amount(body[name]);
        if (n === null) return res.status(400).json({ error: 'bad-amount', page: name });
        await redis('/set/' + PAGES[name].key + '/' + n);
      }
      return res.status(200).json(await readAll());
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
