-- Suivi des signalements : statut (nouveau, en cours, traité) et agent désigné.
alter table public.signalements
  add column if not exists statut text not null default 'nouveau' check (statut in ('nouveau', 'en_cours', 'traite')),
  add column if not exists assigne_id uuid references public.comptes(id) on delete set null,
  add column if not exists statut_le timestamptz,
  add column if not exists statut_par text check (length(statut_par) <= 80);
create index if not exists signalements_assigne_idx on public.signalements (assigne_id);

-- Changer le statut ou confier un signalement.
--  - confier (clé « assigne », uuid ou vide) : le chef du chantier (ou l'administrateur), à un membre du chantier ;
--  - statut : le chef, ou l'agent à qui le signalement est confié.
-- Confier un signalement « nouveau » le passe « en cours ».
create or replace function public.rr_signalement_suivi(p_code text, p_chantier uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.comptes := public.rr__compte(p_code);
  ch public.chantiers := public.rr__chantier(c, p_chantier);
  gere boolean := public.rr__gere(c, ch);
  s public.signalements;
  qui uuid;
begin
  select * into s from public.signalements where id = (p->>'id')::uuid and chantier_id = ch.id;
  if s.id is null then raise exception 'Signalement introuvable sur ce chantier'; end if;

  if p ? 'assigne' then
    if not gere then raise exception 'Seul le chef du chantier confie un signalement'; end if;
    qui := nullif(p->>'assigne', '')::uuid;
    if qui is not null and not (qui = ch.chef_id or exists (
         select 1 from public.affectations a join public.comptes x on x.id = a.agent_id
         where a.chantier_id = ch.id and a.agent_id = qui and x.actif)) then
      raise exception 'Cette personne ne fait pas partie du chantier';
    end if;
    update public.signalements set
      assigne_id = qui,
      statut = case when qui is not null and statut = 'nouveau' then 'en_cours' else statut end,
      statut_le = case when qui is not null and statut = 'nouveau' then now() else statut_le end,
      statut_par = case when qui is not null and statut = 'nouveau' then c.nom else statut_par end
    where id = s.id;
    select * into s from public.signalements where id = s.id;
  end if;

  if p ? 'statut' then
    if p->>'statut' not in ('nouveau', 'en_cours', 'traite') then raise exception 'Statut inconnu'; end if;
    if not (gere or coalesce(s.assigne_id = c.id, false)) then
      raise exception 'Seuls le chef et l’agent désigné font avancer ce signalement';
    end if;
    if s.statut is distinct from p->>'statut' then
      update public.signalements set statut = p->>'statut', statut_le = now(), statut_par = c.nom where id = s.id;
    end if;
  end if;
end $$;


-- État du chantier : les signalements portent le nom de la personne désignée.
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
    'signalements', coalesce((select jsonb_agg((to_jsonb(s) - 'chantier_id')
                      || jsonb_build_object('assigne_nom', (select x.nom from public.comptes x where x.id = s.assigne_id))
                      order by s.cree_le desc)
                    from public.signalements s where s.chantier_id = ch.id), '[]'::jsonb),
    'reperes', coalesce((select jsonb_agg(to_jsonb(r) - 'chantier_id' order by r.cree_le)
                    from public.reperes r where r.chantier_id = ch.id and not r.supprime), '[]'::jsonb),
    'rapports', case when gere then coalesce((select jsonb_agg(to_jsonb(r) - 'chantier_id' - 'signature'
                    order by r.date_poste desc, r.cree_le desc) from public.rapports r where r.chantier_id = ch.id), '[]'::jsonb)
                else '[]'::jsonb end
  );
end $$;

-- Droits : seules les fonctions publiques rr_* (sans « __ ») sont appelables.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.rr_signalement_suivi(text, uuid, jsonb),
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
