import { describe, expect, it } from 'vitest';
import { extractMentions } from './mentions.ts';

describe('extractMentions', () => {
  it('finds usernames and @everyone, once each, lowercased', () => {
    expect(extractMentions('Selam @omer ve @Ayse, @omer! @everyone')).toEqual({
      usernames: ['omer', 'ayse'],
      everyone: true,
    });
  });

  it('ends a mention at sentence punctuation', () => {
    expect(extractMentions('Geldin mi @kerem.yilmaz? Tamam @zeynep.')).toEqual({
      usernames: ['kerem.yilmaz', 'zeynep'],
      everyone: false,
    });
  });

  it('ignores email addresses and words with an @ inside', () => {
    expect(extractMentions('omer@example.com yaz, ya da a@@omer')).toEqual({
      usernames: [],
      everyone: false,
    });
  });

  it('ignores mentions inside code', () => {
    const body = 'Bak: `@omer` ve\n```ts\nconst x = "@everyone";\n```\nama @ayse gerçek';
    expect(extractMentions(body)).toEqual({ usernames: ['ayse'], everyone: false });
  });

  it('finds mentions in quotes and lists too', () => {
    expect(extractMentions('> @omer dedi ki\n- @ayse')).toEqual({
      usernames: ['omer', 'ayse'],
      everyone: false,
    });
  });

  it('ignores names that are too short or too long', () => {
    expect(extractMentions('@ab @abcdefghijklmnopqrstu')).toEqual({
      usernames: [],
      everyone: false,
    });
  });
});
