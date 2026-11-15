/**
 * Turkish catalog: the primary language (DECISIONS A18).
 * Messages use ICU MessageFormat. Never attach Turkish case suffixes to dynamic
 * values such as room or person names; vowel harmony makes that wrong for most
 * names (ARCHITECTURE §4.3).
 */
export const tr = {
  'app.name': 'Hasbihal',
  'app.tagline': 'Aile ve dostlar',
  'connection.connecting': 'Bağlanıyor…',
  'connection.connected': 'Bağlı',
  'connection.offline': 'Sunucuya ulaşılamıyor',
  'connection.upgradeRequired': 'Yeni bir sürüm var. Devam etmek için lütfen indirip kurun.',
  'rooms.heading': 'Odalar',
  'members.heading': 'Üyeler',
  'members.count': '{count, plural, one {# üye} other {# üye}}',
  'composer.placeholder': 'Mesaj yaz · {room}',
  'placeholder.welcome': 'Hoş geldin. Odalar ve sohbet çok yakında burada olacak.',
} as const;

export type MessageKey = keyof typeof tr;
