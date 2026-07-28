import { sha256Hex } from "../../src/core/hash";
import { formatMarkdownLink } from "../../src/core/markdown";
import { canonicalizeWebUrl } from "../../src/core/url";

export function librarySmokeRun(): string {
  return JSON.stringify({
    url: canonicalizeWebUrl(" HTTPS://Münich.example:443/a b#fragment "),
    markdown: formatMarkdownLink("A [page]", "https://example.com/a_(b)"),
    hash: sha256Hex("abc")
  });
}
