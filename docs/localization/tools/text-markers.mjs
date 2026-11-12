/**
 * Small, regex-free helpers for the localization tooling.
 *
 * The tooling reads English text that carries inline markers such as `<strong>..</strong>` and
 * rendered HTML from the preview. It only counts and compares that text; it never writes it into a
 * page. Regex tag stripping can leave a tag behind (`<scr<b>ipt>` becomes `<script>` after one
 * pass) and cannot match end tags such as `</script >`, so these helpers scan the characters
 * instead and repeat until nothing more can be removed.
 */

const isNameChar = (c) => /[A-Za-z0-9_.:-]/.test(c);

/** True when `s` starts a marker at index i: `<`, optional `/`, a name, optional `/`, `>`. Returns the end index or -1. */
function markerEnd(s, i) {
  if (s[i] !== '<') return -1;
  let j = i + 1;
  if (s[j] === '/') j++;
  const nameStart = j;
  while (j < s.length && isNameChar(s[j])) j++;
  if (j === nameStart) return -1;
  if (s[j] === '/') j++;
  return s[j] === '>' ? j + 1 : -1;
}

/** One pass only (exported for the test, which shows why a single pass is not enough). */
export function stripOnce(s) {
  const parts = [];
  let last = 0;
  let i = s.indexOf('<');
  while (i !== -1) {
    const end = markerEnd(s, i);
    if (end === -1) {
      i = s.indexOf('<', i + 1);
    } else {
      parts.push(s.slice(last, i));
      last = end;
      i = s.indexOf('<', end);
    }
  }
  parts.push(s.slice(last));
  return parts.join('');
}

/** Remove every inline marker, repeating until none is left (so nested pieces cannot rebuild a tag). */
export function stripMarkers(input) {
  let s = input;
  for (;;) {
    const next = stripOnce(s);
    if (next === s) return s;
    s = next;
  }
}

/** Split text into the runs between any `<...>` pieces (a `<` with a closing `>` and no other `<` between). */
export function splitOnTags(input) {
  const runs = [];
  let last = 0;
  let i = input.indexOf('<');
  while (i !== -1) {
    const close = input.indexOf('>', i + 1);
    if (close === -1) break;
    const inner = input.slice(i + 1, close);
    if (inner.length > 0 && !inner.includes('<')) {
      runs.push(input.slice(last, i));
      last = close + 1;
      i = input.indexOf('<', last);
    } else {
      i = input.indexOf('<', i + 1);
    }
  }
  runs.push(input.slice(last));
  return runs;
}

/** True if the text holds a tag-like piece. */
export function hasTag(input) {
  return splitOnTags(input).length > 1;
}

function isOpenAt(lower, i, tag) {
  if (!lower.startsWith(`<${tag}`, i)) return false;
  const next = lower[i + tag.length + 1];
  return next === undefined || next === '>' || next === '/' || /\s/.test(next);
}

/**
 * Remove every `<tag ...> ... </tag ...>` block (any case, whitespace allowed in the end tag).
 * `replacer(blockText)` may return text to leave behind instead of nothing. An unclosed block is
 * removed to the end, which is how a browser reads it.
 */
export function removeBlocks(input, tag, replacer = () => ' ') {
  const lower = input.toLowerCase();
  const parts = [];
  let last = 0;
  let i = input.indexOf('<');
  while (i !== -1) {
    if (isOpenAt(lower, i, tag)) {
      const close = findEndTag(lower, i, tag);
      let end = input.length;
      if (close !== -1) {
        const gt = lower.indexOf('>', close);
        end = gt === -1 ? input.length : gt + 1;
      }
      parts.push(input.slice(last, i), replacer(input.slice(i, end)));
      last = end;
      i = input.indexOf('<', end);
    } else {
      i = input.indexOf('<', i + 1);
    }
  }
  parts.push(input.slice(last));
  return parts.join('');
}

/** Index of the next `</tag` that really is that end tag (not `</tagname` of a longer name), or -1. */
function findEndTag(lower, from, tag) {
  let at = lower.indexOf(`</${tag}`, from);
  while (at !== -1) {
    const next = lower[at + tag.length + 2];
    if (next === undefined || next === '>' || next === '/' || /\s/.test(next)) return at;
    at = lower.indexOf(`</${tag}`, at + 1);
  }
  return -1;
}

/** Remove `<!-- ... -->` comments. An unclosed comment is removed to the end. */
export function removeComments(input) {
  const parts = [];
  let last = 0;
  let i = input.indexOf('<!--');
  while (i !== -1) {
    const close = input.indexOf('-->', i + 4);
    parts.push(input.slice(last, i));
    last = close === -1 ? input.length : close + 3;
    i = close === -1 ? -1 : input.indexOf('<!--', last);
  }
  parts.push(input.slice(last));
  return parts.join('');
}

/** Text of the first `<title>` inside a block, or ''. */
export function titleOf(block) {
  const lower = block.toLowerCase();
  const a = lower.indexOf('<title');
  if (a === -1) return '';
  const gt = lower.indexOf('>', a);
  const b = lower.indexOf('</title', gt);
  return gt === -1 || b === -1 ? '' : block.slice(gt + 1, b);
}

/**
 * A dotted message key such as consent.issuerContact.title: an identifier mapped elsewhere, not
 * English a person reads (owner decision D9, 2026-11-12). One linear pattern: three or more
 * dot-separated parts, a lower-case first word of three letters or more, and at least one capital
 * letter (so a host such as www.example.com, a version or "e.g." stays text).
 */
export function isMessageKey(text) {
  return /^(?=.*[A-Z])[a-z]{3,}(?:\.[a-z][A-Za-z0-9]*){2,}$/.test(text);
}
