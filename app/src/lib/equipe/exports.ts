import { fmtLine, fmtPk } from '../format';
import type { Chantier, Rapport, Repere, Signalement } from './api';
import { choice, GRAVITES, NATURES, PANNEAU_TYPES } from './catalog';

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
export const fmtHeure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const fmtDateHeure = (iso: string) => `${fmtDate(iso)} ${fmtHeure(iso)}`;

/** Partage un fichier (feuille de partage du téléphone), sinon le télécharge. */
export async function shareFile(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Signalements au format CSV pour Excel (séparateur « ; », accents conservés). */
export function signalementsCsv(chantier: Chantier, list: Signalement[]): Blob {
  const head = ['Date', 'Heure', 'Auteur', 'Nature', 'Gravité', 'Ligne', 'PK', 'Voie', 'Commentaire', 'Photos', 'Latitude', 'Longitude', 'Précision GPS (m)'];
  const rows = list.map((s) => [
    fmtDate(s.cree_le), fmtHeure(s.cree_le), s.auteur_nom, choice(NATURES, s.nature).label, choice(GRAVITES, s.gravite).label,
    s.ligne ?? '', s.pk !== null ? fmtPk(s.pk) : '', s.voie ?? '', s.commentaire ?? '', s.photos.length,
    s.lat.toFixed(6), s.lon.toFixed(6), s.precision_m ?? '',
  ]);
  const text = [[`Chantier : ${chantier.nom}`], head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  return new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
}

const POSTE = { jour: 'Jour', nuit: 'Nuit' } as const;

/** PDF du rapport de fin de poste. */
export async function rapportPdf(
  chantier: Chantier,
  r: Pick<Rapport, 'date_poste' | 'auteur_nom' | 'contenu' | 'signature'>,
  signalements: Signalement[],
  reperes: Repere[],
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 15;
  let y = 18;
  const c = r.contenu;
  const ensure = (h: number) => {
    if (y + h > 280) {
      doc.addPage();
      y = 18;
    }
  };
  const title = (t: string) => {
    ensure(12);
    y += 3;
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(17, 47, 84).text(t.toUpperCase(), M, y);
    doc.setDrawColor(200).line(M, y + 1.5, W - M, y + 1.5);
    y += 7;
    doc.setTextColor(20);
  };
  const para = (t: string) => {
    doc.setFont('helvetica', 'normal').setFontSize(10);
    for (const line of doc.splitTextToSize(t || '—', W - 2 * M) as string[]) {
      ensure(5);
      doc.text(line, M, y);
      y += 5;
    }
  };
  const field = (k: string, v: string) => {
    ensure(5);
    doc.setFont('helvetica', 'bold').setFontSize(10).text(`${k} :`, M, y);
    doc.setFont('helvetica', 'normal').text(v || '—', M + 42, y);
    y += 5.5;
  };

  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(17, 47, 84).text('Rapport de fin de poste', M, y);
  y += 7;
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(60).text(chantier.nom, M, y);
  y += 8;
  doc.setTextColor(20);
  field('Date du poste', `${fmtDate(r.date_poste)} · poste de ${POSTE[c.poste].toLowerCase()}`);
  field('Horaires', `${c.debut || '?'} – ${c.fin || '?'}`);
  field('Entreprise', chantier.entreprise ?? '');
  field('Ligne', chantier.ligne ? fmtLine(chantier.ligne) : '');
  field('PK', c.pk_debut || c.pk_fin ? `${c.pk_debut || '?'} à ${c.pk_fin || '?'}` : '');
  field('Chef d’équipe', r.auteur_nom);

  title('Équipe présente');
  if (c.equipe.length) for (const m of c.equipe) para(`• ${m.nom}${m.fonction ? ` — ${m.fonction}` : ''}`);
  else para('—');
  if (c.externes.trim()) para(`Extérieurs : ${c.externes}`);

  title('Travaux réalisés');
  para(c.travaux);
  title('Dispositif de sécurité');
  para(c.securite);

  title('Événements et signalements');
  const sigs = signalements.filter((s) => c.signalements.includes(s.id));
  for (const s of sigs) {
    para(`• ${fmtHeure(s.cree_le)} — ${choice(NATURES, s.nature).label} (${choice(GRAVITES, s.gravite).label})` +
      `${s.pk !== null ? ` — PK ${fmtPk(s.pk)}` : ''}${s.voie ? ` voie ${s.voie}` : ''} — ${s.auteur_nom}` +
      `${s.commentaire ? ` : ${s.commentaire}` : ''}${s.photos.length ? ` [${s.photos.length} photo(s)]` : ''}`);
  }
  if (c.evenements.trim()) para(c.evenements);
  if (!sigs.length && !c.evenements.trim()) para('Aucun événement signalé.');

  title('Panneaux et balisages');
  const pans = reperes.filter((x) => c.panneaux.includes(x.id));
  if (pans.length) {
    for (const p of pans) {
      para(`• ${choice(PANNEAU_TYPES, p.type).label}${p.nom ? ` « ${p.nom} »` : ''}${p.pk !== null ? ` — PK ${fmtPk(p.pk)}` : ''} — ` +
        (p.etat === 'retire' ? `retiré${p.retire_par ? ` par ${p.retire_par}` : ''}` : 'en place'));
    }
  } else para('—');

  title('Observations, à prévoir pour le poste suivant');
  para(c.observations);

  ensure(45);
  y += 4;
  doc.setFont('helvetica', 'bold').setFontSize(10).text('Signature du chef d’équipe', M, y);
  y += 3;
  if (r.signature) doc.addImage(r.signature, 'PNG', M, y, 70, 25, undefined, 'FAST');
  doc.setDrawColor(180).rect(M, y, 70, 25);
  y += 32;
  doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(110)
    .text('Document établi avec Repère Rail. Ne remplace pas les documents réglementaires du chantier.', M, 288);
  return doc.output('blob');
}
