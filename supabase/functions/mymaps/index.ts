// Repère Rail : récupère les points d'une carte Google My Maps.
// Les exports KMZ de My Maps contiennent souvent un simple « lien réseau » vers la carte, sans les points,
// et le navigateur ne peut pas lire Google directement (CORS). Cette fonction va chercher le KML complet
// de la carte demandée, et uniquement sur Google My Maps (pas de relais vers d'autres sites).
// Déployée avec verify_jwt = false : la carte doit être partagée « tous les utilisateurs disposant du lien ».
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MID = /^[A-Za-z0-9_-]{10,100}$/;
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const GOOGLE = /(^|\.)google\.[a-z.]{2,10}$/;

/**
 * Lien court partagé depuis le téléphone (maps.app.goo.gl/…) : on suit ses redirections
 * (uniquement vers Google) jusqu'à l'identifiant « mid » de la carte My Maps.
 */
async function midFromShortLink(link: string): Promise<string | null> {
  let url = link;
  for (let i = 0; i < 5; i++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:') return null;
    const mid = u.searchParams.get('mid');
    if (mid && MID.test(mid)) return mid;
    if (!SHORT_HOSTS.has(u.hostname)) return null;
    const res = await fetch(u.toString(), { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (RepereRail)' } }).catch(() => null);
    if (!res) return null;
    const loc = res.headers.get('location');
    if (loc) {
      const next = new URL(loc, u);
      if (!SHORT_HOSTS.has(next.hostname) && !GOOGLE.test(next.hostname)) return null;
      url = next.toString();
      continue;
    }
    // Certaines réponses redirigent par la page elle-même : on y cherche le lien de la carte.
    const html = (await res.text()).slice(0, 200_000);
    const m = /maps\/d\/[^"'\s<>]*?[?&](?:amp;)?mid=([A-Za-z0-9_-]{10,100})/.exec(html);
    return m ? m[1] : null;
  }
  return null;
}
const MAX_BYTES = 15 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'methode' }, 405);
  let mid = '';
  let link = '';
  try {
    const body = await req.json();
    mid = String(body?.mid ?? '');
    link = String(body?.link ?? '').slice(0, 500);
  } catch {
    return json({ error: 'requete' }, 400);
  }
  if (!mid && link) mid = (await midFromShortLink(link)) ?? '';
  if (!MID.test(mid)) return json({ error: link ? 'lien' : 'identifiant' }, 400);
  const res = await fetch(`https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (RepereRail)' },
  }).catch(() => null);
  if (!res) return json({ error: 'google' }, 502);
  if (res.status === 404) return json({ error: 'introuvable' }, 404);
  if (!res.ok) return json({ error: 'privee' }, 403);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) return json({ error: 'trop_gros' }, 413);
  const text = new TextDecoder().decode(buf);
  // Carte privée : Google renvoie une page de connexion au lieu du KML.
  if (!/<kml[\s>]/i.test(text.slice(0, 2000))) return json({ error: 'privee' }, 403);
  return json({ kml: text, mid });
});
