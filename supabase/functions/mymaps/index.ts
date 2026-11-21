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
const MAX_BYTES = 15 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'methode' }, 405);
  let mid = '';
  try {
    mid = String((await req.json())?.mid ?? '');
  } catch {
    return json({ error: 'requete' }, 400);
  }
  if (!MID.test(mid)) return json({ error: 'identifiant' }, 400);
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
  return json({ kml: text });
});
