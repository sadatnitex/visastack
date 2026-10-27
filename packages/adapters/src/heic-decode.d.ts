// Types for `heic-decode` 2.1.0, which ships none. Only the parts heic-converter.ts uses.
declare module 'heic-decode' {
  interface DecodedHeicImage {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
  }
  interface DecodableHeicImage {
    readonly width: number;
    readonly height: number;
    decode(): Promise<DecodedHeicImage>;
  }
  type DecodeOne = (input: { readonly buffer: Uint8Array }) => Promise<DecodedHeicImage>;
  /** Every top-level image, each decoded only when asked; `dispose` frees the decoder. */
  type DecodeAll = (input: { readonly buffer: Uint8Array }) => Promise<
    DecodableHeicImage[] & { dispose(): void }
  >;
  const decode: DecodeOne & { readonly all: DecodeAll };
  export default decode;
}
