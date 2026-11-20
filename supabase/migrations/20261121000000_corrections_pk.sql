-- Corrections de PK relevées sur le terrain devant une borne : proposées par n'importe quel utilisateur,
-- validées par l'administrateur, puis appliquées par l'appli de tout le monde.

create table public.corrections_pk (
  id uuid primary key,
  ligne text not null check (ligne ~ '^[0-9]{6}$'),
  lon double precision not null check (lon between -10 and 20),
  lat double precision not null check (lat between 35 and 55),
  precision_m real,
  pk_app numeric(9,3) not null,
  pk_vrai numeric(9,3) not null check (abs(pk_vrai - pk_app) <= 2),
  commentaire text check (length(commentaire) <= 500),
  auteur_nom text check (length(auteur_nom) <= 80),
  auteur_id uuid references public.comptes(id) on delete set null,
  statut text not null default 'proposee' check (statut in ('proposee', 'validee', 'refusee')),
  etendue text not null default 'portion' check (etendue in ('portion', 'ligne')),
  cree_le timestamptz not null default now(),
  traite_le timestamptz,
  traite_par text
);
create index corrections_pk_statut_idx on public.corrections_pk (statut, ligne);
alter table public.corrections_pk enable row level security;
revoke all on public.corrections_pk from anon, authenticated;

-- Proposer une correction (sans compte possible ; le code personnel, s'il est donné, signe la proposition).
create or replace function public.rr_correction_proposer(p jsonb, p_code text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes;
begin
  if (select count(*) from public.corrections_pk where cree_le > now() - interval '1 hour') > 200 then
    raise exception 'Trop de propositions en ce moment, réessaie plus tard';
  end if;
  if nullif(p_code, '') is not null then c := public.rr__compte(p_code); end if;
  insert into public.corrections_pk (id, ligne, lon, lat, precision_m, pk_app, pk_vrai, commentaire, auteur_nom, auteur_id)
  values ((p->>'id')::uuid, p->>'ligne', (p->>'lon')::float8, (p->>'lat')::float8, nullif(p->>'precision_m', '')::real,
          (p->>'pk_app')::numeric, (p->>'pk_vrai')::numeric, nullif(left(trim(coalesce(p->>'commentaire', '')), 500), ''),
          coalesce(c.nom, nullif(left(trim(coalesce(p->>'auteur_nom', '')), 80), '')), c.id)
  on conflict (id) do nothing;
end $$;

-- Corrections validées, pour toutes les applis (lecture publique, sans compte).
create or replace function public.rr_corrections() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ligne', ligne, 'pk_app', pk_app, 'pk_vrai', pk_vrai,
           'etendue', etendue, 'lon', lon, 'lat', lat, 'le', traite_le) order by ligne, pk_app), '[]'::jsonb)
  from public.corrections_pk where statut = 'validee'
$$;

-- Administrateur : liste et traitement des propositions.
create or replace function public.rr_admin_corrections(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes := public.rr__compte(p_code);
begin
  if c.role <> 'admin' then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) - 'auteur_id' order by (x.statut = 'proposee') desc, x.cree_le desc)
    from (select * from public.corrections_pk order by cree_le desc limit 500) x), '[]'::jsonb);
end $$;

create or replace function public.rr_admin_correction_traiter(p_code text, p_id uuid, p_statut text, p_etendue text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes := public.rr__compte(p_code);
begin
  if c.role <> 'admin' then raise exception 'Réservé à l''administrateur'; end if;
  if p_statut not in ('proposee', 'validee', 'refusee') or p_etendue not in ('portion', 'ligne') then
    raise exception 'Paramètres invalides';
  end if;
  update public.corrections_pk set statut = p_statut, etendue = p_etendue,
    traite_le = case when p_statut = 'proposee' then null else now() end,
    traite_par = case when p_statut = 'proposee' then null else c.nom end
  where id = p_id;
end $$;

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
  public.rr_rapport_lire(text, uuid, uuid),
  public.rr_correction_proposer(jsonb, text),
  public.rr_corrections(),
  public.rr_admin_corrections(text),
  public.rr_admin_correction_traiter(text, uuid, text, text)
to anon, authenticated;
