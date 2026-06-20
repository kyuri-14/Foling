// Tiny syntax highlighter for the code editors (CSS / JS). It turns source
// text into HTML where each token is wrapped in <span class="syn-…">, so an
// overlay <pre> can render colors behind a transparent <textarea>. Colors come
// from CSS variables (--syn-*) so themes can restyle without touching this.
//
// This is a lightweight regex lexer — "good enough / VSCode-ish", not a full
// parser. Pure & dependency-free (unit-testable).

export type SyntaxLang = "css" | "js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// [sticky regex, css-class | null]. Order matters (first match at the cursor
// wins). `null` class = emit the text without a span.
type Rule = [RegExp, string | null];

const CSS_RULES: Rule[] = [
  [/\/\*[\s\S]*?\*\//y, "comment"],
  [/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/y, "string"],
  [/\$[a-zA-Z0-9_-]+/y, "var"], // HTFL variable
  [/@[a-zA-Z-]+/y, "keyword"], // at-rules
  [/#[0-9a-fA-F]{3,8}\b/y, "color"],
  [
    /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax|fr|s|ms|deg|pt|ch|ex|cm|mm)?\b/y,
    "number",
  ],
  [/!important\b/y, "keyword"],
  [/[a-zA-Z-][a-zA-Z0-9-]*(?=\s*:)/y, "prop"], // property before ':'
  [/[.#&][a-zA-Z][\w-]*/y, "selector"], // .class / #id selectors
  [/[a-zA-Z-][a-zA-Z0-9-]*/y, "value"], // keywords / value identifiers
  [/[{}()[\];:,]/y, "punct"],
  [/\s+/y, null],
];

const JS_KEYWORDS =
  "const|let|var|function|return|if|else|for|while|do|switch|case|default|" +
  "break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|" +
  "catch|finally|throw|await|async|yield|delete|void|import|from|export";
const JS_LITERALS = "true|false|null|undefined|NaN|Infinity";

const JS_RULES: Rule[] = [
  [/\/\/[^\n]*/y, "comment"],
  [/\/\*[\s\S]*?\*\//y, "comment"],
  [/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/y, "string"],
  [/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy, "number"],
  [new RegExp(`\\b(?:${JS_KEYWORDS})\\b`, "y"), "keyword"],
  [new RegExp(`\\b(?:${JS_LITERALS})\\b`, "y"), "literal"],
  [/[a-zA-Z_$][\w$]*(?=\s*\()/y, "func"], // call / definition
  [/[a-zA-Z_$][\w$]*/y, "plain"],
  [/[{}()[\];:,.<>+\-*/%=&|!?~^]/y, "punct"],
  [/\s+/y, null],
];

/** Highlight `code` into HTML with <span class="syn-…"> tokens. */
export function highlight(code: string, lang: SyntaxLang): string {
  const rules = lang === "css" ? CSS_RULES : JS_RULES;
  let out = "";
  let i = 0;
  while (i < code.length) {
    let matched = false;
    for (const [re, cls] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i && m[0].length > 0) {
        out += cls ? `<span class="syn-${cls}">${esc(m[0])}</span>` : esc(m[0]);
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += esc(code[i]);
      i++;
    }
  }
  return out;
}
