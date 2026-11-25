// Cloudflare Worker: reicht Anfragen der Sport-App an die (inoffizielle) Yazio-API weiter,
// weil Yazio Browser-Anfragen von fremden Seiten blockiert (CORS).
// Speichert nichts und loggt keine Inhalte. Nur die unten erlaubten Pfade werden weitergeleitet.
const API = 'https://yzapi.yazio.com/v15';
// Öffentliche Client-Kennung der Yazio-App (aus dem Open-Source-Client juriadams/yazio)
const CLIENT_ID = '1_4hiybetvfksgw40o0sog4s884kwc840wwso8go4k8c04goo4c';
const CLIENT_SECRET = '6rok2m65xuskgkgogw40wkkk8sw0osg84s8cggsc4woos4s8o';
const ORIGINS = ['https://xconner.github.io', 'http://localhost:8000', 'http://localhost:8765'];
const READ_PATHS = [/^\/user\/widgets\/daily-summary$/, /^\/user\/consumed-items$/, /^\/user\/goals\/unmodified$/,
  /^\/user\/bodyvalues\/weight\/last$/, /^\/user\/water-intake$/, /^\/user\/exercises$/];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400', 'Vary': 'Origin', 'Cache-Control': 'no-store',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!ORIGINS.includes(origin)) return new Response('forbidden', { status: 403, headers: cors });
    const url = new URL(req.url);

    // Anmeldung (Passwort) oder Erneuerung (refresh_token) -> Tokens
    if (url.pathname === '/token' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return new Response('bad json', { status: 400, headers: cors }); }
      const body = b.refresh_token
        ? { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: b.refresh_token }
        : { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'password', username: b.username, password: b.password };
      const r = await fetch(API + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return new Response(await r.text(), { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Lesende Abfragen
    if (req.method === 'GET' && READ_PATHS.some(p => p.test(url.pathname))) {
      const auth = req.headers.get('Authorization') || '';
      if (!/^Bearer \S+$/.test(auth)) return new Response('no token', { status: 401, headers: cors });
      const r = await fetch(API + url.pathname + url.search, { headers: { Authorization: auth, Accept: 'application/json' } });
      return new Response(await r.text(), { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404, headers: cors });
  },
};
