// GET /api/health — czy funkcje stoją i czy są skonfigurowane.
//
// Celowo nie zdradza żadnej wartości: o kluczu mówi tylko „jest" albo „nie ma".
// Bez limitu zapytań i bez sprawdzania źródła, bo nie kosztuje nic i ma działać
// dla monitoringu.

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ blad: 'Ta funkcja przyjmuje tylko GET.', powod: 'zla_metoda' });
    return;
  }
  res.status(200).json({
    ok: true,
    klucz: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    czas: new Date().toISOString()
  });
}
