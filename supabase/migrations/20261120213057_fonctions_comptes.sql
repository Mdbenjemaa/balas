-- Outils internes ---------------------------------------------------------------------

create or replace function public.rr__norm(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Compte actif correspondant à un code personnel, sinon erreur (après une pause qui freine les essais).
create or replace function public.rr__compte(p_code text) returns public.comptes
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes;
begin
  select * into c from public.comptes where code_hash = public.rr__hash(public.rr__norm(p_code)) and actif;
  if c.id is null then
    perform pg_sleep(0.4);
    raise exception 'acces_refuse' using errcode = '28000', hint = 'Code inconnu ou compte désactivé';
  end if;
  return c;
end $$;

-- Longueur du code selon le rôle : administrateur 12, chef 10, agent 8 caractères.
create or replace function public.rr__nouveau_code(p_role text) returns text
language sql volatile set search_path = '' as $$
  select public.rr__code(case p_role when 'admin' then 12 when 'chef' then 10 else 8 end)
$$;

-- Chantier accessible au compte : le chef pour les siens, l'agent pour ceux où il est affecté.
create or replace function public.rr__chantier(c public.comptes, p_chantier uuid) returns public.chantiers
language plpgsql stable security definer set search_path = '' as $$
declare ch public.chantiers;
begin
  select * into ch from public.chantiers where id = p_chantier;
  if ch.id is null or not (
       c.role = 'admin'
       or (c.role = 'chef' and ch.chef_id = c.id)
       or (c.role = 'agent' and not ch.archive
           and exists (select 1 from public.affectations a where a.chantier_id = ch.id and a.agent_id = c.id))) then
    raise exception 'acces_refuse' using errcode = '28000', hint = 'Chantier non accessible';
  end if;
  return ch;
end $$;

create or replace function public.rr__gere(c public.comptes, ch public.chantiers) returns boolean
language sql stable set search_path = '' as $$
  select c.role = 'admin' or (c.role = 'chef' and ch.chef_id = c.id)
$$;

create or replace function public.rr__chantier_json(ch public.chantiers) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', ch.id, 'nom', ch.nom, 'entreprise', ch.entreprise, 'ligne', ch.ligne,
    'pk_debut', ch.pk_debut, 'pk_fin', ch.pk_fin, 'date_debut', ch.date_debut, 'date_fin', ch.date_fin,
    'archive', ch.archive, 'chef_nom', (select x.nom from public.comptes x where x.id = ch.chef_id),
    'nb_agents', (select count(*) from public.affectations a where a.chantier_id = ch.id))
$$;

-- Connexion ----------------------------------------------------------------------------

create or replace function public.rr_connexion(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes := public.rr__compte(p_code);
begin
  update public.comptes set derniere_connexion = now() where id = c.id;
  return jsonb_build_object(
    'compte', jsonb_build_object('id', c.id, 'nom', c.nom, 'role', c.role, 'entreprise', c.entreprise, 'fonction', c.fonction),
    'chantiers', coalesce((
      select jsonb_agg(public.rr__chantier_json(ch) order by ch.archive, ch.cree_le desc)
      from public.chantiers ch
      where (c.role = 'chef' and ch.chef_id = c.id)
         or (c.role = 'agent' and not ch.archive
             and exists (select 1 from public.affectations a where a.chantier_id = ch.id and a.agent_id = c.id))
    ), '[]'::jsonb));
end $$;

-- Administrateur : les chefs ----------------------------------------------------------------

create or replace function public.rr_admin_chefs(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes := public.rr__compte(p_code);
begin
  if c.role <> 'admin' then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'nom', x.nom, 'entreprise', x.entreprise, 'actif', x.actif, 'cree_le', x.cree_le,
      'derniere_connexion', x.derniere_connexion,
      'nb_chantiers', (select count(*) from public.chantiers ch where ch.chef_id = x.id and not ch.archive),
      'nb_agents', (select count(*) from public.comptes a where a.cree_par = x.id and a.role = 'agent' and a.actif))
      order by x.actif desc, x.cree_le desc)
    from public.comptes x where x.role = 'chef'), '[]'::jsonb);
end $$;

create or replace function public.rr_admin_creer_chef(p_code text, p_nom text, p_entreprise text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  code text := public.rr__nouveau_code('chef');
  nid uuid;
begin
  if c.role <> 'admin' then raise exception 'Réservé à l''administrateur'; end if;
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'Nom du chef manquant'; end if;
  insert into public.comptes (nom, role, entreprise, code_hash, cree_par)
  values (trim(p_nom), 'chef', nullif(trim(coalesce(p_entreprise, '')), ''), public.rr__hash(code), c.id)
  returning id into nid;
  return jsonb_build_object('id', nid, 'code', code);
end $$;

-- Modifier un compte géré : l'admin gère les chefs, le chef gère les agents qu'il a créés.
-- p : nom, fonction, entreprise (admin), actif, regenerer (nouveau code renvoyé une seule fois).
create or replace function public.rr_compte_maj(p_code text, p_compte uuid, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  x public.comptes;
  code text;
begin
  select * into x from public.comptes where id = p_compte;
  if x.id is null or x.id = c.id or not (
       (c.role = 'admin' and x.role in ('chef', 'agent'))
       or (c.role = 'chef' and x.role = 'agent' and x.cree_par = c.id)) then
    raise exception 'acces_refuse' using errcode = '28000';
  end if;
  update public.comptes set
    nom = coalesce(nullif(trim(p->>'nom'), ''), nom),
    fonction = case when p ? 'fonction' then nullif(trim(p->>'fonction'), '') else fonction end,
    entreprise = case when c.role = 'admin' and p ? 'entreprise' then nullif(trim(p->>'entreprise'), '') else entreprise end,
    actif = coalesce((p->>'actif')::boolean, actif)
  where id = x.id;
  if coalesce((p->>'regenerer')::boolean, false) then
    code := public.rr__nouveau_code(x.role);
    update public.comptes set code_hash = public.rr__hash(code) where id = x.id;
    return jsonb_build_object('code', code);
  end if;
  return '{}'::jsonb;
end $$;

-- Chef : agents et chantiers ----------------------------------------------------------------

create or replace function public.rr_chef_agents(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes := public.rr__compte(p_code);
begin
  if c.role <> 'chef' then raise exception 'Réservé aux chefs de chantier'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'nom', x.nom, 'fonction', x.fonction, 'actif', x.actif, 'cree_le', x.cree_le,
      'derniere_connexion', x.derniere_connexion,
      'chantiers', coalesce((select jsonb_agg(a.chantier_id) from public.affectations a
                    join public.chantiers ch on ch.id = a.chantier_id
                    where a.agent_id = x.id and ch.chef_id = c.id), '[]'::jsonb))
      order by x.actif desc, x.nom)
    from public.comptes x where x.role = 'agent' and x.cree_par = c.id), '[]'::jsonb);
end $$;

create or replace function public.rr_chef_creer_agent(p_code text, p_nom text, p_fonction text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  code text := public.rr__nouveau_code('agent');
  nid uuid;
begin
  if c.role <> 'chef' then raise exception 'Réservé aux chefs de chantier'; end if;
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'Nom de l''agent manquant'; end if;
  insert into public.comptes (nom, role, entreprise, fonction, code_hash, cree_par)
  values (trim(p_nom), 'agent', c.entreprise, nullif(trim(coalesce(p_fonction, '')), ''), public.rr__hash(code), c.id)
  returning id into nid;
  return jsonb_build_object('id', nid, 'code', code);
end $$;

-- Créer (sans id) ou modifier (avec id) un chantier du chef.
create or replace function public.rr_chef_chantier(p_code text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  ch public.chantiers;
begin
  if c.role <> 'chef' then raise exception 'Réservé aux chefs de chantier'; end if;
  if nullif(p->>'id', '') is not null then
    update public.chantiers set
      nom = coalesce(nullif(trim(p->>'nom'), ''), nom),
      entreprise = case when p ? 'entreprise' then nullif(trim(p->>'entreprise'), '') else entreprise end,
      ligne = case when p ? 'ligne' then nullif(trim(p->>'ligne'), '') else ligne end,
      pk_debut = case when p ? 'pk_debut' then nullif(p->>'pk_debut', '')::numeric else pk_debut end,
      pk_fin = case when p ? 'pk_fin' then nullif(p->>'pk_fin', '')::numeric else pk_fin end,
      date_debut = case when p ? 'date_debut' then nullif(p->>'date_debut', '')::date else date_debut end,
      date_fin = case when p ? 'date_fin' then nullif(p->>'date_fin', '')::date else date_fin end,
      archive = coalesce((p->>'archive')::boolean, archive)
    where id = (p->>'id')::uuid and chef_id = c.id
    returning * into ch;
    if ch.id is null then raise exception 'acces_refuse' using errcode = '28000'; end if;
  else
    if length(trim(coalesce(p->>'nom', ''))) < 2 then raise exception 'Nom du chantier manquant'; end if;
    insert into public.chantiers (chef_id, nom, entreprise, ligne, pk_debut, pk_fin, date_debut, date_fin)
    values (c.id, trim(p->>'nom'), coalesce(nullif(trim(p->>'entreprise'), ''), c.entreprise), nullif(trim(p->>'ligne'), ''),
            nullif(p->>'pk_debut', '')::numeric, nullif(p->>'pk_fin', '')::numeric,
            nullif(p->>'date_debut', '')::date, nullif(p->>'date_fin', '')::date)
    returning * into ch;
  end if;
  return public.rr__chantier_json(ch);
end $$;

create or replace function public.rr_chef_affecter(p_code text, p_chantier uuid, p_agent uuid, p_oui boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes := public.rr__compte(p_code);
begin
  if c.role <> 'chef'
     or not exists (select 1 from public.chantiers where id = p_chantier and chef_id = c.id)
     or not exists (select 1 from public.comptes where id = p_agent and role = 'agent' and cree_par = c.id) then
    raise exception 'acces_refuse' using errcode = '28000';
  end if;
  if p_oui then
    insert into public.affectations (chantier_id, agent_id) values (p_chantier, p_agent) on conflict do nothing;
  else
    delete from public.affectations where chantier_id = p_chantier and agent_id = p_agent;
  end if;
end $$;

-- Contenu d'un chantier ------------------------------------------------------------------------

create or replace function public.rr_etat(p_code text, p_chantier uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  ch public.chantiers := public.rr__chantier(c, p_chantier);
  gere boolean := public.rr__gere(c, ch);
begin
  return jsonb_build_object(
    'chantier', public.rr__chantier_json(ch),
    'moi', jsonb_build_object('id', c.id, 'nom', c.nom, 'role', c.role, 'fonction', c.fonction),
    'gere', gere,
    'membres', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'nom', x.nom, 'role', x.role, 'fonction', x.fonction)
             order by x.role, x.nom)
      from public.comptes x
      where x.actif and (x.id = ch.chef_id
            or exists (select 1 from public.affectations a where a.chantier_id = ch.id and a.agent_id = x.id))), '[]'::jsonb),
    'signalements', coalesce((select jsonb_agg(to_jsonb(s) - 'chantier_id' order by s.cree_le desc)
                    from public.signalements s where s.chantier_id = ch.id), '[]'::jsonb),
    'reperes', coalesce((select jsonb_agg(to_jsonb(r) - 'chantier_id' order by r.cree_le)
                    from public.reperes r where r.chantier_id = ch.id and not r.supprime), '[]'::jsonb),
    'rapports', case when gere then coalesce((select jsonb_agg(to_jsonb(r) - 'chantier_id' - 'signature'
                    order by r.date_poste desc, r.cree_le desc) from public.rapports r where r.chantier_id = ch.id), '[]'::jsonb)
                else '[]'::jsonb end
  );
end $$;

-- Signalement : chef ou agent du chantier (idempotent par id).
create or replace function public.rr_signaler(p_code text, p_chantier uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  ch public.chantiers := public.rr__chantier(c, p_chantier);
  photos text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb))), '{}');
begin
  if exists (select 1 from unnest(photos) x where x not like ch.id::text || '/%') then
    raise exception 'Photo hors du chantier';
  end if;
  insert into public.signalements (id, chantier_id, auteur_id, auteur_nom, cree_le, lon, lat, precision_m,
                                   ligne, pk, voie, nature, gravite, commentaire, photos)
  values ((p->>'id')::uuid, ch.id, c.id, c.nom, coalesce(nullif(p->>'cree_le', '')::timestamptz, now()),
          (p->>'lon')::float8, (p->>'lat')::float8, nullif(p->>'precision_m', '')::real,
          nullif(p->>'ligne', ''), nullif(p->>'pk', '')::numeric, nullif(p->>'voie', ''),
          p->>'nature', p->>'gravite', nullif(left(p->>'commentaire', 2000), ''), photos)
  on conflict (id) do nothing;
end $$;

-- Repère (création, retiré, supprimé) : chef du chantier seulement.
create or replace function public.rr_repere(p_code text, p_chantier uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  ch public.chantiers := public.rr__chantier(c, p_chantier);
  r public.reperes;
  rid uuid := (p->>'id')::uuid;
begin
  if not public.rr__gere(c, ch) then raise exception 'Seul le chef du chantier prépare la carte'; end if;
  select * into r from public.reperes where id = rid;
  if r.id is not null then
    if r.chantier_id <> ch.id then raise exception 'acces_refuse' using errcode = '28000'; end if;
    update public.reperes set
      nom = coalesce(p->>'nom', nom),
      commentaire = coalesce(p->>'commentaire', commentaire),
      etat = case when categorie = 'panneau' then coalesce(p->>'etat', etat) else etat end,
      retire_le = case when p->>'etat' = 'retire' and etat is distinct from 'retire' then now()
                       when p->>'etat' = 'pose' then null else retire_le end,
      retire_par = case when p->>'etat' = 'retire' and etat is distinct from 'retire' then c.nom
                        when p->>'etat' = 'pose' then null else retire_par end,
      supprime = coalesce((p->>'supprime')::boolean, supprime),
      modifie_le = now()
    where id = rid;
  else
    insert into public.reperes (id, chantier_id, auteur_id, auteur_nom, cree_le, categorie, type, nom, commentaire,
                                lon, lat, ligne, pk, pk_fin, voie, etat)
    values (rid, ch.id, c.id, c.nom, coalesce(nullif(p->>'cree_le', '')::timestamptz, now()),
            p->>'categorie', p->>'type', nullif(trim(coalesce(p->>'nom', '')), ''), nullif(p->>'commentaire', ''),
            nullif(p->>'lon', '')::float8, nullif(p->>'lat', '')::float8, nullif(p->>'ligne', ''),
            nullif(p->>'pk', '')::numeric, nullif(p->>'pk_fin', '')::numeric, nullif(p->>'voie', ''),
            case when p->>'categorie' = 'panneau' then 'pose' end);
  end if;
end $$;

-- Import d'une carte d'accès (KML) : chef seulement, 500 points au plus par envoi.
create or replace function public.rr_reperes_import(p_code text, p_chantier uuid, p_items jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  ch public.chantiers := public.rr__chantier(c, p_chantier);
  n integer;
begin
  if not public.rr__gere(c, ch) then raise exception 'Seul le chef du chantier prépare la carte'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'Import trop volumineux'; end if;
  insert into public.reperes (id, chantier_id, auteur_id, auteur_nom, cree_le, categorie, type, nom, commentaire, lon, lat, ligne, pk, voie)
  select (i->>'id')::uuid, ch.id, c.id, c.nom, now(), 'point', coalesce(nullif(i->>'type', ''), 'acces'),
         left(nullif(trim(coalesce(i->>'nom', '')), ''), 120), left(nullif(i->>'commentaire', ''), 1000),
         (i->>'lon')::float8, (i->>'lat')::float8, nullif(i->>'ligne', ''), nullif(i->>'pk', '')::numeric, nullif(i->>'voie', '')
  from jsonb_array_elements(p_items) i
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Rapports de fin de poste : chef du chantier.
create or replace function public.rr_rapport(p_code text, p_chantier uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  ch public.chantiers := public.rr__chantier(c, p_chantier);
  rid uuid := (p->>'id')::uuid;
  existing public.rapports;
begin
  if not public.rr__gere(c, ch) then raise exception 'Réservé au chef du chantier'; end if;
  select * into existing from public.rapports where id = rid;
  if existing.id is not null and existing.chantier_id <> ch.id then
    raise exception 'acces_refuse' using errcode = '28000';
  end if;
  insert into public.rapports (id, chantier_id, auteur_id, auteur_nom, date_poste, contenu, signature)
  values (rid, ch.id, c.id, c.nom, (p->>'date_poste')::date, p->'contenu', nullif(p->>'signature', ''))
  on conflict (id) do update set date_poste = excluded.date_poste, contenu = excluded.contenu,
    signature = excluded.signature, modifie_le = now();
end $$;

create or replace function public.rr_rapport_lire(p_code text, p_chantier uuid, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  ch public.chantiers := public.rr__chantier(c, p_chantier);
  r public.rapports;
begin
  if not public.rr__gere(c, ch) then raise exception 'Réservé au chef du chantier'; end if;
  select * into r from public.rapports where id = p_id and chantier_id = ch.id;
  if r.id is null then raise exception 'Rapport introuvable'; end if;
  return to_jsonb(r) - 'chantier_id';
end $$;

-- Droits : seules les fonctions publiques rr_* (sans « __ ») sont appelables --------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.rr_connexion(text),
  public.rr_admin_chefs(text),
  public.rr_admin_creer_chef(text, text, text),
  public.rr_compte_maj(text, uuid, jsonb),
  public.rr_chef_agents(text),
  public.rr_chef_creer_agent(text, text, text),
  public.rr_chef_chantier(text, jsonb),
  public.rr_chef_affecter(text, uuid, uuid, boolean),
  public.rr_etat(text, uuid),
  public.rr_signaler(text, uuid, jsonb),
  public.rr_repere(text, uuid, jsonb),
  public.rr_reperes_import(text, uuid, jsonb),
  public.rr_rapport(text, uuid, jsonb),
  public.rr_rapport_lire(text, uuid, uuid)
to anon, authenticated;
