-- Fonctions internes ------------------------------------------------------------

create or replace function public.rr__hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.rr__code(n int) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(n);
  r text := '';
begin
  for i in 0..n - 1 loop
    r := r || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  return r;
end $$;

-- Membre actif correspondant à un jeton, sinon erreur.
create or replace function public.rr__membre(p_token text) returns public.membres
language plpgsql stable security definer set search_path = '' as $$
declare m public.membres;
begin
  select * into m from public.membres where token_hash = public.rr__hash(p_token) and actif;
  if m.id is null then
    raise exception 'acces_refuse' using errcode = '28000', hint = 'Jeton inconnu ou membre retiré du chantier';
  end if;
  return m;
end $$;

create or replace function public.rr__nouveau_jeton() returns text
language sql volatile set search_path = '' as $$
  select encode(extensions.gen_random_bytes(24), 'hex')
$$;

-- Créer un chantier (le créateur devient chef) ------------------------------------
create or replace function public.rr_creer_chantier(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.chantiers;
  tok text := public.rr__nouveau_jeton();
  m public.membres;
begin
  if length(trim(coalesce(p->>'nom', ''))) < 2 then raise exception 'Nom du chantier manquant'; end if;
  if length(trim(coalesce(p->>'chef_nom', ''))) < 2 then raise exception 'Ton nom est manquant'; end if;
  insert into public.chantiers (nom, entreprise, ligne, pk_debut, pk_fin, date_debut, date_fin, code_agent, code_chef)
  values (
    trim(p->>'nom'), nullif(trim(p->>'entreprise'), ''), nullif(trim(p->>'ligne'), ''),
    nullif(p->>'pk_debut', '')::numeric, nullif(p->>'pk_fin', '')::numeric,
    nullif(p->>'date_debut', '')::date, nullif(p->>'date_fin', '')::date,
    public.rr__code(6), public.rr__code(8)
  ) returning * into c;
  insert into public.membres (chantier_id, nom, fonction, role, token_hash)
  values (c.id, trim(p->>'chef_nom'), nullif(trim(p->>'fonction'), ''), 'chef', public.rr__hash(tok))
  returning * into m;
  return jsonb_build_object('token', tok, 'membre_id', m.id, 'chantier_id', c.id);
end $$;

-- Rejoindre avec le code agent (rôle agent) ou le code chef (rôle chef) ----------
create or replace function public.rr_rejoindre(p_code text, p_nom text, p_fonction text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  c public.chantiers;
  r text;
  tok text := public.rr__nouveau_jeton();
  m public.membres;
begin
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'Ton nom est manquant'; end if;
  select * into c from public.chantiers where code_agent = code;
  if c.id is not null then
    r := 'agent';
  else
    select * into c from public.chantiers where code_chef = code;
    if c.id is not null then r := 'chef'; end if;
  end if;
  if c.id is null then
    perform pg_sleep(0.6); -- freine les essais au hasard
    raise exception 'Code inconnu' using errcode = '28000';
  end if;
  insert into public.membres (chantier_id, nom, fonction, role, token_hash)
  values (c.id, trim(p_nom), nullif(trim(coalesce(p_fonction, '')), ''), r, public.rr__hash(tok))
  returning * into m;
  return jsonb_build_object('token', tok, 'membre_id', m.id, 'chantier_id', c.id, 'role', r);
end $$;

-- Tout l'état du chantier pour un membre -------------------------------------------
create or replace function public.rr_etat(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.membres := public.rr__membre(p_token);
  c public.chantiers;
  chef boolean := m.role = 'chef';
begin
  select * into c from public.chantiers where id = m.chantier_id;
  return jsonb_build_object(
    'chantier', jsonb_build_object(
      'id', c.id, 'nom', c.nom, 'entreprise', c.entreprise, 'ligne', c.ligne,
      'pk_debut', c.pk_debut, 'pk_fin', c.pk_fin, 'date_debut', c.date_debut, 'date_fin', c.date_fin,
      'code_agent', case when chef then c.code_agent end, 'code_chef', case when chef then c.code_chef end),
    'moi', jsonb_build_object('id', m.id, 'nom', m.nom, 'role', m.role, 'fonction', m.fonction),
    'membres', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nom', x.nom, 'role', x.role, 'fonction', x.fonction,
                  'actif', x.actif, 'rejoint_le', x.rejoint_le) order by x.rejoint_le), '[]'::jsonb)
                from public.membres x where x.chantier_id = c.id and (chef or x.actif)),
    'signalements', (select coalesce(jsonb_agg(to_jsonb(s) - 'chantier_id' order by s.cree_le desc), '[]'::jsonb)
                from public.signalements s where s.chantier_id = c.id),
    'reperes', (select coalesce(jsonb_agg(to_jsonb(r) - 'chantier_id' order by r.cree_le), '[]'::jsonb)
                from public.reperes r where r.chantier_id = c.id and not r.supprime),
    'rapports', case when chef then (select coalesce(jsonb_agg(to_jsonb(r) - 'chantier_id' - 'signature'
                order by r.date_poste desc, r.cree_le desc), '[]'::jsonb) from public.rapports r where r.chantier_id = c.id)
                else '[]'::jsonb end
  );
end $$;

-- Signalement (idempotent : l'appli renvoie le même id si l'envoi a été coupé) ----
create or replace function public.rr_signaler(p_token text, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  m public.membres := public.rr__membre(p_token);
  photos text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb))), '{}');
begin
  if exists (select 1 from unnest(photos) x where x not like m.chantier_id::text || '/%') then
    raise exception 'Photo hors du chantier';
  end if;
  insert into public.signalements (id, chantier_id, auteur_id, auteur_nom, cree_le, lon, lat, precision_m,
                                   ligne, pk, voie, nature, gravite, commentaire, photos)
  values ((p->>'id')::uuid, m.chantier_id, m.id, m.nom, coalesce(nullif(p->>'cree_le', '')::timestamptz, now()),
          (p->>'lon')::float8, (p->>'lat')::float8, nullif(p->>'precision_m', '')::real,
          nullif(p->>'ligne', ''), nullif(p->>'pk', '')::numeric, nullif(p->>'voie', ''),
          p->>'nature', p->>'gravite', nullif(left(p->>'commentaire', 2000), ''), photos)
  on conflict (id) do nothing;
end $$;

-- Repère : création, ou mise à jour (retiré, renommé, supprimé) -------------------
create or replace function public.rr_repere(p_token text, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  m public.membres := public.rr__membre(p_token);
  r public.reperes;
  rid uuid := (p->>'id')::uuid;
begin
  select * into r from public.reperes where id = rid;
  if r.id is not null then
    if r.chantier_id <> m.chantier_id then raise exception 'acces_refuse' using errcode = '28000'; end if;
    if coalesce((p->>'supprime')::boolean, false) and not (m.role = 'chef' or r.auteur_id = m.id) then
      raise exception 'Seul l''auteur ou le chef peut supprimer ce repère';
    end if;
    update public.reperes set
      nom = coalesce(p->>'nom', nom),
      commentaire = coalesce(p->>'commentaire', commentaire),
      etat = case when categorie = 'panneau' then coalesce(p->>'etat', etat) else etat end,
      retire_le = case when p->>'etat' = 'retire' and etat is distinct from 'retire' then now()
                       when p->>'etat' = 'pose' then null else retire_le end,
      retire_par = case when p->>'etat' = 'retire' and etat is distinct from 'retire' then m.nom
                        when p->>'etat' = 'pose' then null else retire_par end,
      supprime = coalesce((p->>'supprime')::boolean, supprime),
      modifie_le = now()
    where id = rid;
  else
    insert into public.reperes (id, chantier_id, auteur_id, auteur_nom, cree_le, categorie, type, nom, commentaire,
                                lon, lat, ligne, pk, pk_fin, voie, etat)
    values (rid, m.chantier_id, m.id, m.nom, coalesce(nullif(p->>'cree_le', '')::timestamptz, now()),
            p->>'categorie', p->>'type', nullif(trim(coalesce(p->>'nom', '')), ''), nullif(p->>'commentaire', ''),
            nullif(p->>'lon', '')::float8, nullif(p->>'lat', '')::float8, nullif(p->>'ligne', ''),
            nullif(p->>'pk', '')::numeric, nullif(p->>'pk_fin', '')::numeric, nullif(p->>'voie', ''),
            case when p->>'categorie' = 'panneau' then 'pose' end);
  end if;
end $$;

-- Rapport de fin de poste (chef) -----------------------------------------------------
create or replace function public.rr_rapport(p_token text, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  m public.membres := public.rr__membre(p_token);
  rid uuid := (p->>'id')::uuid;
  existing public.rapports;
begin
  if m.role <> 'chef' then raise exception 'Réservé au chef de chantier'; end if;
  select * into existing from public.rapports where id = rid;
  if existing.id is not null and existing.chantier_id <> m.chantier_id then
    raise exception 'acces_refuse' using errcode = '28000';
  end if;
  insert into public.rapports (id, chantier_id, auteur_id, auteur_nom, date_poste, contenu, signature)
  values (rid, m.chantier_id, m.id, m.nom, (p->>'date_poste')::date, p->'contenu', nullif(p->>'signature', ''))
  on conflict (id) do update set date_poste = excluded.date_poste, contenu = excluded.contenu,
    signature = excluded.signature, modifie_le = now();
end $$;

create or replace function public.rr_rapport_lire(p_token text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.membres := public.rr__membre(p_token);
  r public.rapports;
begin
  if m.role <> 'chef' then raise exception 'Réservé au chef de chantier'; end if;
  select * into r from public.rapports where id = p_id and chantier_id = m.chantier_id;
  if r.id is null then raise exception 'Rapport introuvable'; end if;
  return to_jsonb(r) - 'chantier_id';
end $$;

-- Le chef retire ou réintègre un membre -----------------------------------------------
create or replace function public.rr_membre_actif(p_token text, p_membre uuid, p_actif boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.membres := public.rr__membre(p_token);
begin
  if m.role <> 'chef' then raise exception 'Réservé au chef de chantier'; end if;
  if p_membre = m.id then raise exception 'Tu ne peux pas te retirer toi-même'; end if;
  update public.membres set actif = p_actif where id = p_membre and chantier_id = m.chantier_id;
end $$;

-- Droits : seules les fonctions publiques rr_* (sans « __ ») sont appelables ---------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.rr_creer_chantier(jsonb) to anon, authenticated;
grant execute on function public.rr_rejoindre(text, text, text) to anon, authenticated;
grant execute on function public.rr_etat(text) to anon, authenticated;
grant execute on function public.rr_signaler(text, jsonb) to anon, authenticated;
grant execute on function public.rr_repere(text, jsonb) to anon, authenticated;
grant execute on function public.rr_rapport(text, jsonb) to anon, authenticated;
grant execute on function public.rr_rapport_lire(text, uuid) to anon, authenticated;
grant execute on function public.rr_membre_actif(text, uuid, boolean) to anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Photos : bucket privé, accès uniquement par URL signées (fonction edge « photos »).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 6291456, array['image/jpeg'])
on conflict (id) do nothing;
