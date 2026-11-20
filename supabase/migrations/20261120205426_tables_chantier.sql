-- Repère Rail : chantiers partagés (signalements, repères, rapports).
-- Les tables ne sont jamais lues directement par l'appli : tout passe par les fonctions rr_*
-- qui vérifient le jeton du membre. RLS activée sans politique = accès direct refusé.

create table public.chantiers (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(nom) between 2 and 120),
  entreprise text check (length(entreprise) <= 120),
  ligne text check (ligne ~ '^[0-9]{6}$'),
  pk_debut numeric(9,3),
  pk_fin numeric(9,3),
  date_debut date,
  date_fin date,
  code_agent text not null unique,
  code_chef text not null unique,
  cree_le timestamptz not null default now()
);

create table public.membres (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  nom text not null check (length(nom) between 2 and 80),
  fonction text check (length(fonction) <= 60),
  role text not null check (role in ('chef', 'agent')),
  token_hash text not null unique,
  actif boolean not null default true,
  rejoint_le timestamptz not null default now()
);
create index membres_chantier_idx on public.membres (chantier_id);

create table public.signalements (
  id uuid primary key,
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  auteur_id uuid references public.membres(id) on delete set null,
  auteur_nom text not null,
  cree_le timestamptz not null,
  recu_le timestamptz not null default now(),
  lon double precision not null check (lon between -10 and 20),
  lat double precision not null check (lat between 35 and 55),
  precision_m real,
  ligne text,
  pk numeric(9,3),
  voie text check (length(voie) <= 40),
  nature text not null check (length(nature) between 1 and 60),
  gravite text not null check (gravite in ('info', 'a_traiter', 'urgent')),
  commentaire text check (length(commentaire) <= 2000),
  photos text[] not null default '{}' check (cardinality(photos) <= 6)
);
create index signalements_chantier_idx on public.signalements (chantier_id, cree_le desc);

create table public.reperes (
  id uuid primary key,
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  auteur_id uuid references public.membres(id) on delete set null,
  auteur_nom text not null,
  cree_le timestamptz not null,
  categorie text not null check (categorie in ('point', 'zone', 'panneau')),
  type text not null check (length(type) between 1 and 40),
  nom text check (length(nom) <= 120),
  commentaire text check (length(commentaire) <= 1000),
  lon double precision check (lon between -10 and 20),
  lat double precision check (lat between 35 and 55),
  ligne text,
  pk numeric(9,3),
  pk_fin numeric(9,3),
  voie text check (length(voie) <= 40),
  etat text check (etat in ('pose', 'retire')),
  retire_le timestamptz,
  retire_par text,
  supprime boolean not null default false,
  modifie_le timestamptz not null default now(),
  check (categorie <> 'zone' or (ligne is not null and pk is not null and pk_fin is not null)),
  check (categorie = 'zone' or (lon is not null and lat is not null))
);
create index reperes_chantier_idx on public.reperes (chantier_id);

create table public.rapports (
  id uuid primary key,
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  auteur_id uuid references public.membres(id) on delete set null,
  auteur_nom text not null,
  date_poste date not null,
  contenu jsonb not null check (pg_column_size(contenu) < 200000),
  signature text check (length(signature) < 300000),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);
create index rapports_chantier_idx on public.rapports (chantier_id, date_poste desc);

alter table public.chantiers enable row level security;
alter table public.membres enable row level security;
alter table public.signalements enable row level security;
alter table public.reperes enable row level security;
alter table public.rapports enable row level security;

revoke all on public.chantiers, public.membres, public.signalements, public.reperes, public.rapports from anon, authenticated;
