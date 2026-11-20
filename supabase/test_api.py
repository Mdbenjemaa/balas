"""Teste l'API avec comptes personnels : admin -> chef -> agents, droits et refus."""
import json, sys, uuid, urllib.request, urllib.error
URL = 'https://rlywthlidnrykiacfudz.supabase.co'
KEY = 'sb_publishable_HYRXnCPVXNCEkGlf3WxQ1g_0BUyMCLe'
ADMIN = sys.argv[1]

def call(path, body=None, method='POST', headers=None, raw=None):
    headers = headers if headers is not None else {'apikey': KEY, 'Content-Type': 'application/json'}
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(path if path.startswith('http') else URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            t = r.read()
            return r.status, (json.loads(t) if t and 'json' in r.headers.get('content-type', '') else t[:120])
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}').get('message') or 'erreur'

rpc = lambda fn, **a: call(f'/rest/v1/rpc/{fn}', a)
ok = lambda label, cond: print(('OK   ' if cond else 'ÉCHEC'), label)

s, r = rpc('rr_connexion', p_code=ADMIN); ok('admin se connecte', s == 200 and r['compte']['role'] == 'admin')
s, chef = rpc('rr_admin_creer_chef', p_code=ADMIN, p_nom='Chef Essai', p_entreprise='ETF Services'); ok('admin crée un chef', s == 200 and len(chef['code']) == 10)
s, chef2 = rpc('rr_admin_creer_chef', p_code=ADMIN, p_nom='Autre Chef', p_entreprise='Autre'); ok('admin crée un 2e chef', s == 200)
s, r = rpc('rr_connexion', p_code=chef['code'][:5] + '-' + chef['code'][5:].lower()); ok('chef se connecte (code avec tiret, minuscules)', s == 200 and r['compte']['role'] == 'chef')
s, ch = rpc('rr_chef_chantier', p_code=chef['code'], p={'nom': 'RVB essai', 'ligne': '830000', 'pk_debut': '44', 'pk_fin': '47'}); ok('chef crée un chantier', s == 200 and ch['entreprise'] == 'ETF Services')
s, ch2 = rpc('rr_chef_chantier', p_code=chef['code'], p={'nom': 'Deuxième chantier'}); ok('chef crée un 2e chantier', s == 200)
s, a1 = rpc('rr_chef_creer_agent', p_code=chef['code'], p_nom='Agent Un', p_fonction='Annonceur'); ok('chef crée agent 1 (code 8)', s == 200 and len(a1['code']) == 8)
s, a2 = rpc('rr_chef_creer_agent', p_code=chef['code'], p_nom='Agent Deux', p_fonction='Sentinelle'); ok('chef crée agent 2', s == 200)
s, r = rpc('rr_connexion', p_code=a1['code']); ok('agent sans affectation : aucun chantier', s == 200 and r['chantiers'] == [])
for c in (ch, ch2):
    s, _ = rpc('rr_chef_affecter', p_code=chef['code'], p_chantier=c['id'], p_agent=a1['id'], p_oui=True)
s, _ = rpc('rr_chef_affecter', p_code=chef['code'], p_chantier=ch['id'], p_agent=a2['id'], p_oui=True)
s, r = rpc('rr_connexion', p_code=a1['code']); ok('agent 1 voit ses 2 chantiers', len(r['chantiers']) == 2)
s, r = rpc('rr_chef_agents', p_code=chef['code']); ok('chef liste ses agents et affectations', len(r) == 2 and any(len(x['chantiers']) == 2 for x in r))
s, r = rpc('rr_repere', p_code=chef['code'], p_chantier=ch['id'], p={'id': str(uuid.uuid4()), 'categorie': 'zone', 'type': 'travaux', 'nom': 'Zone', 'ligne': '830000', 'pk': 44.5, 'pk_fin': 45.5}); ok('chef pose une zone', s == 204)
s, r = rpc('rr_reperes_import', p_code=chef['code'], p_chantier=ch['id'], p_items=[{'id': str(uuid.uuid4()), 'nom': f'Accès {i}', 'lon': 2.4 + i / 1000, 'lat': 48.8, 'ligne': '830000', 'pk': 44 + i / 10} for i in range(5)]); ok('chef importe 5 accès', r == 5)
s, r = rpc('rr_repere', p_code=a1['code'], p_chantier=ch['id'], p={'id': str(uuid.uuid4()), 'categorie': 'point', 'type': 'rdv', 'lon': 2.4, 'lat': 48.8}); ok('agent NE peut PAS poser de repère', s >= 400)
sid = str(uuid.uuid4())
s, up = call('/functions/v1/photos', {'code': a1['code'], 'chantier': ch['id'], 'op': 'upload', 'signalement': sid, 'n': 1}); ok('agent obtient une adresse photo', s == 200)
jpg = bytes.fromhex('ffd8ffe000104a4649460001') + bytes(40) + bytes.fromhex('ffd9')
s, _ = call(up['uploads'][0]['signedUrl'], raw=jpg, method='PUT', headers={'Content-Type': 'image/jpeg', 'x-upsert': 'true'}); ok('photo envoyée', s == 200)
s, _ = rpc('rr_signaler', p_code=a1['code'], p_chantier=ch['id'], p={'id': sid, 'lon': 2.4, 'lat': 48.8, 'ligne': '830000', 'pk': 45, 'nature': 'cloture', 'gravite': 'urgent', 'photos': [up['uploads'][0]['path']]}); ok('agent signale', s == 204)
s, e = rpc('rr_etat', p_code=a2['code'], p_chantier=ch['id']); ok('agent 2 voit le signalement de l agent 1 et la carte préparée', len(e['signalements']) == 1 and len(e['reperes']) == 6 and e['gere'] is False and e['rapports'] == [])
s, e = rpc('rr_etat', p_code=a2['code'], p_chantier=ch2['id']); ok('agent 2 NE voit PAS un chantier où il n est pas affecté', s >= 400)
s, r = call('/functions/v1/photos', {'code': a2['code'], 'chantier': ch['id'], 'op': 'read', 'paths': e and [up['uploads'][0]['path']]}); ok('agent 2 voit la photo', s == 200 and len(r['urls']) == 1)
# autre chef
s, r = rpc('rr_etat', p_code=chef2['code'], p_chantier=ch['id']); ok('autre chef NE voit PAS le chantier', s >= 400)
s, r = call('/functions/v1/photos', {'code': chef2['code'], 'chantier': ch['id'], 'op': 'read', 'paths': [up['uploads'][0]['path']]}); ok('autre chef NE voit PAS la photo', s == 403)
s, r = rpc('rr_chef_affecter', p_code=chef2['code'], p_chantier=ch['id'], p_agent=a1['id'], p_oui=True); ok('autre chef NE peut PAS affecter', s >= 400)
s, r = rpc('rr_compte_maj', p_code=chef2['code'], p_compte=a1['id'], p={'actif': False}); ok('autre chef NE peut PAS désactiver l agent', s >= 400)
s, r = rpc('rr_compte_maj', p_code=a1['code'], p_compte=a2['id'], p={'actif': False}); ok('agent NE peut PAS gérer un agent', s >= 400)
s, r = rpc('rr_admin_creer_chef', p_code=chef['code'], p_nom='Pirate', p_entreprise=''); ok('chef NE peut PAS créer de chef', s >= 400)
s, r = rpc('rr_rapport', p_code=a1['code'], p_chantier=ch['id'], p={'id': str(uuid.uuid4()), 'date_poste': '2026-11-20', 'contenu': {}}); ok('agent NE peut PAS faire de rapport', s >= 400)
s, r = rpc('rr_rapport', p_code=chef['code'], p_chantier=ch['id'], p={'id': str(uuid.uuid4()), 'date_poste': '2026-11-20', 'contenu': {'travaux': 'x'}}); ok('chef enregistre un rapport', s == 204)
# nouveau code et désactivation
s, r = rpc('rr_compte_maj', p_code=chef['code'], p_compte=a1['id'], p={'regenerer': True}); ok('chef renouvelle le code de l agent 1', s == 200 and len(r['code']) == 8)
s, _ = rpc('rr_connexion', p_code=a1['code']); ok('ancien code refusé', s >= 400)
s, _ = rpc('rr_connexion', p_code=r['code']); ok('nouveau code accepté', s == 200)
s, _ = rpc('rr_chef_chantier', p_code=chef['code'], p={'id': ch2['id'], 'archive': True})
s, rr = rpc('rr_connexion', p_code=r['code']); ok('chantier archivé caché à l agent', len(rr['chantiers']) == 1)
s, _ = rpc('rr_compte_maj', p_code=ADMIN, p_compte=chef['id'], p={'actif': False})
s, _ = rpc('rr_connexion', p_code=chef['code']); ok('chef désactivé par l admin : refusé', s >= 400)
for t in ('comptes', 'chantiers', 'affectations', 'signalements'):
    s, _ = call(f'/rest/v1/{t}?select=*', method='GET', headers={'apikey': KEY}); ok(f'lecture directe {t} refusée', s in (401, 403))
s, _ = rpc('rr__compte', p_code=ADMIN); ok('fonction interne refusée', s in (401, 403, 404))
s, _ = rpc('rr_connexion', p_code='AAAA-BBBB'); ok('code inconnu refusé', s >= 400)
