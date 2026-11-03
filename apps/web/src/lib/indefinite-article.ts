/**
 * "a" or "an" before a kind's label, by how it sounds: "an ID Card", "a UK Visa Application",
 * "a Utility Bill", "an Hour Sheet". Letters of an initialism are read one by one.
 */
export function withArticle(label: string): string {
  const first = label.split(/\s+/)[0] ?? '';
  const initialism = first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first);
  const vowelSound = initialism
    ? /^[AEFHILMNORSX]/.test(first)
    : /^(?:[aeio]|u(?!ni|s[aeiu]|ti|ro|ri|ke)|hour|honou?r|hono)/i.test(first);
  return `${vowelSound ? 'an' : 'a'} ${label}`;
}
