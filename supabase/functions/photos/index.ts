// Repère Rail : photos des signalements.
// Le bucket « photos » est privé. Cette fonction vérifie le code personnel et l'accès au chantier
// (chef du chantier, agent affecté, administrateur), puis donne des adresses signées pour envoyer
// (upload) ou afficher (read) les photos de CE chantier.
// Déployée avec verify_jwt = false : l'authentification se fait par le code personnel.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function canAccess(code: string, chantier: string): Promise<boolean> {
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { data: c } = await admin.from('comptes').select('id, role, actif').eq('code_hash', await sha256Hex(norm)).maybeSingle();
  if (!c || !c.actif) return false;
  if (c.role === 'admin') return true;
  const { data: ch } = await admin.from('chantiers').select('id, chef_id, archive').eq('id', chantier).maybeSingle();
  if (!ch) return false;
  if (c.role === 'chef') return ch.chef_id === c.id;
  if (ch.archive) return false;
  const { data: a } = await admin.from('affectations').select('agent_id').eq('chantier_id', chantier).eq('agent_id', c.id).maybeSingle();
  return !!a;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  let body: { code?: string; chantier?: string; op?: string; signalement?: string; n?: number; paths?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Requête illisible' }, 400);
  }
  if (typeof body.code !== 'string' || !UUID.test(body.chantier ?? '')) return json({ error: 'acces_refuse' }, 403);
  if (!(await canAccess(body.code, body.chantier!))) {
    await sleep(400);
    return json({ error: 'acces_refuse' }, 403);
  }
  const bucket = admin.storage.from('photos');
  const prefix = `${body.chantier}/`;

  if (body.op === 'upload') {
    const n = Number(body.n);
    if (!UUID.test(body.signalement ?? '') || !Number.isInteger(n) || n < 1 || n > 6) {
      return json({ error: 'Paramètres invalides' }, 400);
    }
    const uploads = [];
    for (let i = 0; i < n; i++) {
      const path = `${prefix}${body.signalement}/${i}.jpg`;
      const { data, error: e } = await bucket.createSignedUploadUrl(path, { upsert: true });
      if (e || !data) return json({ error: 'Envoi impossible' }, 500);
      uploads.push({ path, signedUrl: data.signedUrl });
    }
    return json({ uploads });
  }

  if (body.op === 'read') {
    const paths = (Array.isArray(body.paths) ? body.paths : [])
      .filter((p) => typeof p === 'string' && p.startsWith(prefix) && !p.includes('..'))
      .slice(0, 60);
    if (!paths.length) return json({ urls: [] });
    const { data, error: e } = await bucket.createSignedUrls(paths, 3600);
    if (e || !data) return json({ error: 'Lecture impossible' }, 500);
    return json({ urls: data.map((d) => ({ path: d.path, url: d.signedUrl })) });
  }

  return json({ error: 'Opération inconnue' }, 400);
});
