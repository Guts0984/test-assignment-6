// @vitest-environment node
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import uk from '../../../messages/uk.json';

type Tree = { [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});

const flatUk = flatten(uk as Tree);
const flatEn = flatten(en as Tree);
/**
 * Names of the arguments an ICU message uses, including ones nested in plural/select branches.
 * A tiny brace-walker: `{name}` and `{name, plural, one {...} other {...}}` are arguments; the `{`
 * that opens a branch body directly inside a plural/select is not.
 */
const argsOf = (message: string): string[] => {
  const names = new Set<string>();
  const stack: ('arg' | 'branch')[] = [];
  let i = 0;
  while (i < message.length) {
    const c = message[i];
    if (c === '{') {
      if (stack[stack.length - 1] === 'arg') {
        stack.push('branch');
        i += 1;
        continue;
      }
      const m = /^\{\s*(\w+)\s*([,}])/.exec(message.slice(i));
      if (!m) throw new Error(`malformed ICU message: ${message}`);
      names.add(m[1] as string);
      if (m[2] === ',') stack.push('arg');
      i += m[0].length;
      continue;
    }
    if (c === '}') stack.pop();
    i += 1;
  }
  if (stack.length > 0) throw new Error(`unbalanced braces in: ${message}`);
  return [...names].sort();
};

describe('argsOf (the ICU argument extractor used below)', () => {
  it.each([
    ['plain text', []],
    ['hello {name}', ['name']],
    ['{count} more', ['count']],
    ['{count, plural, one {# item} other {# items}}', ['count']],
    ['{date}: {count, plural, one {# event} other {# events}}', ['count', 'date']],
    ['{n, plural, one {{who} has one} other {{who} has many}}', ['n', 'who']],
    ['{a, select, x {{b}} other {c}}', ['a', 'b']],
  ])('%s', (message, expected) => {
    expect(argsOf(message)).toEqual(expected);
  });

  it('refuses broken messages instead of silently passing them', () => {
    expect(() => argsOf('oops {count')).toThrow();
    expect(() => argsOf('{ }')).toThrow();
  });
});

describe('message catalogs', () => {
  it('uk and en have exactly the same keys', () => {
    expect(Object.keys(flatUk).sort()).toEqual(Object.keys(flatEn).sort());
  });

  it('no message is empty', () => {
    for (const [k, v] of [...Object.entries(flatUk), ...Object.entries(flatEn)])
      expect(v.trim(), k).not.toBe('');
  });

  it('a message uses the same arguments in both languages (a renamed {placeholder} would render raw)', () => {
    for (const key of Object.keys(flatEn))
      expect(argsOf(flatUk[key]!), key).toEqual(argsOf(flatEn[key]!));
  });
});

describe('plural forms (#17: "3 встречи", "5 встреч")', () => {
  const t = (locale: 'uk' | 'en') =>
    createTranslator({ locale, messages: locale === 'uk' ? uk : en });

  it.each([
    [0, '0 зустрічей'],
    [1, '1 зустріч'],
    [2, '2 зустрічі'],
    [3, '3 зустрічі'],
    [4, '4 зустрічі'],
    [5, '5 зустрічей'],
    [11, '11 зустрічей'],
    [12, '12 зустрічей'],
    [14, '14 зустрічей'],
    [21, '21 зустріч'],
    [22, '22 зустрічі'],
    [25, '25 зустрічей'],
    [101, '101 зустріч'],
    [111, '111 зустрічей'],
    [1000, '1 000 зустрічей'],
  ])('uk: %i -> %s', (n, expected) => {
    expect(t('uk')('calendar.eventsCount', { count: n }).replace(/\s/g, ' ')).toBe(
      expected.replace(/^1000/, '1000'),
    );
  });

  it.each([
    [0, '0 events'],
    [1, '1 event'],
    [2, '2 events'],
    [21, '21 events'],
  ])('en: %i -> %s', (n, expected) => {
    expect(t('en')('calendar.eventsCount', { count: n })).toBe(expected);
  });

  it('sync indicator reads naturally for 1, 2, 5 changes in Ukrainian', () => {
    expect(t('uk')('sync.syncing', { count: 1 })).toBe('Синхронізація, 1 зміна');
    expect(t('uk')('sync.syncing', { count: 2 })).toBe('Синхронізація, 2 зміни');
    expect(t('uk')('sync.syncing', { count: 5 })).toBe('Синхронізація, 5 змін');
  });

  it('room count plurals', () => {
    expect(t('uk')('nav.roomsSelected', { count: 1 })).toBe('1 переговорна');
    expect(t('uk')('nav.roomsSelected', { count: 3 })).toBe('3 переговорні');
    expect(t('uk')('nav.roomsSelected', { count: 50 })).toBe('50 переговорних');
  });
});
