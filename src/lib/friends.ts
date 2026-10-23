/** Stable dictionary order in both locales, without mutating shared JSON. */
const dictionary = new Intl.Collator('en', { sensitivity: 'base', numeric: false })
export function sortFriends<T extends { name: string; link: string }>(friends: readonly T[]): T[] {
  return [...friends].sort((a, b) => dictionary.compare(a.name.normalize('NFKC'), b.name.normalize('NFKC'))
    || (a.link < b.link ? -1 : a.link > b.link ? 1 : 0))
}
