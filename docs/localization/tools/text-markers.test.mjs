// Run with: node --test docs/localization/tools/text-markers.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  removeBlocks,
  removeComments,
  splitOnTags,
  stripMarkers,
  stripOnce,
  titleOf,
} from './text-markers.mjs';

test('one pass can leave a tag behind (why stripMarkers repeats until nothing is left)', () => {
  assert.equal(stripOnce('<scr<b>ipt>x'), '<script>x');
  assert.equal(stripMarkers('<scr<b>ipt>x'), 'x');
});

test('stripMarkers leaves no tag even when pieces rebuild one', () => {
  for (const s of [
    '<scr<b>ipt>x',
    '<<b>b>x',
    'a <strong>b</strong> c',
    '<a/>x<br/>',
    '<<<i>i>i>',
  ]) {
    const out = stripMarkers(s);
    assert.ok(!/<\/?[A-Za-z]/.test(out), `${s} -> ${out}`);
  }
  assert.equal(stripMarkers('a <strong>b</strong> c'), 'a b c');
  assert.equal(stripMarkers('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2');
});

test('removeBlocks handles end tags with spaces, upper case and unclosed blocks', () => {
  assert.equal(removeBlocks('a<script>x</script >b', 'script'), 'a b');
  assert.equal(removeBlocks('a<SCRIPT type="x">x</SCRIPT\n>b', 'script'), 'a b');
  assert.equal(removeBlocks('a<script>never closed', 'script'), 'a ');
  assert.equal(
    removeBlocks('<scripture>kept</scripture>', 'script'),
    '<scripture>kept</scripture>',
  );
  assert.equal(removeBlocks('<script>a</script><script>b</script>c', 'script'), '  c');
  // an end tag of a longer name must not close the block
  assert.equal(removeBlocks('<script>x</scripture>y</script>z', 'script'), ' z');
});

test('comments, svg titles and tag splitting', () => {
  assert.equal(removeComments('a<!-- x -->b<!-- open'), 'ab');
  assert.equal(titleOf('<svg><title>Home</title><path/></svg>'), 'Home');
  assert.deepEqual(splitOnTags('one <b>two</b> three'), ['one ', 'two', ' three']);
  assert.deepEqual(splitOnTags('a < b'), ['a < b']);
});
