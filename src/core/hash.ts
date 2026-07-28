import { sha256 } from "js-sha256/build/sha256.min.js";

export function sha256Hex(value: string): string {
  return sha256(value);
}
