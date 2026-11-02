import { afterEach, describe, expect, it, vi } from 'vitest';
import { newUploadId } from './document-upload-client-id';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('a new upload id', () => {
  it('is a different version 4 id each time', () => {
    const a = newUploadId();
    expect(a).toMatch(V4);
    expect(newUploadId()).not.toBe(a);
  });

  it('is still a version 4 id in a browser without randomUUID', () => {
    let n = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xff - n++);
        return bytes;
      },
    });
    expect(newUploadId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(newUploadId()).toMatch(V4);
  });
});
