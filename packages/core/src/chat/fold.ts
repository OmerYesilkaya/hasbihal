/**
 * Folds Turkish text for matching (A27): lowercase with Turkish rules, then without accents, so
 * "Ömer", "OMER", and "omer" match, and so do "çay"/"cay" and "Işık"/"isik".
 */
export function foldTurkish(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}
