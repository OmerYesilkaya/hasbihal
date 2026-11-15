import { sql, type Kysely } from 'kysely';

// Full-text search across all rooms (ARCHITECTURE §3.5, DECISIONS A27).
//
// Text is folded before indexing, the same way as the app's `foldTurkish`: Turkish lower-casing
// (ICU, so I→ı and İ→i), then ı→i and accents dropped, so "çay"/"cay" and "Işık"/"isik" meet.
// Words are matched by prefix, which suits Turkish suffixes ("çay" finds "çaylar", "çayı")
// better than a stemmer would on folded text.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function hasbihal_fold(t text) returns text
    language sql immutable strict parallel safe
    return translate(
      lower(t collate "tr-x-icu"),
      'çğıöşüâîûéèêëáàäíìïóòôúùñ',
      'cgiosuaiueeeeaaaiiiooouun'
    )
  `.execute(db);
  await sql`
    alter table messages add column search_vector tsvector
    generated always as (to_tsvector('simple'::regconfig, hasbihal_fold(body))) stored
  `.execute(db);
  await sql`create index messages_search on messages using gin (search_vector)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index messages_search`.execute(db);
  await sql`alter table messages drop column search_vector`.execute(db);
  await sql`drop function hasbihal_fold(text)`.execute(db);
}
