import "@kayahr/text-encoding/encodings/utf-8";
import {
  TextDecoder as TextDecoderPolyfill,
  TextEncoder as TextEncoderPolyfill
} from "@kayahr/text-encoding/no-encodings";

interface EncodingGlobals {
  TextEncoder?: typeof globalThis.TextEncoder;
  TextDecoder?: typeof globalThis.TextDecoder;
}

export function installTextEncoding(target: EncodingGlobals): void {
  if (typeof target.TextEncoder !== "function") {
    target.TextEncoder = TextEncoderPolyfill;
  }
  if (typeof target.TextDecoder !== "function") {
    target.TextDecoder = TextDecoderPolyfill;
  }
}

installTextEncoding(globalThis);
