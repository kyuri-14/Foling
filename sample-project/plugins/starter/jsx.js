// Starter exporter: HTFL document -> a single JSX function component.
//
// `doc` shape:
//   doc.tree           : the HTML-root TreeNode
//   doc.tree.children  : top-level elements (head, body, ...)
//   node.display_name  : tag name (prefix stripped)
//   node.name          : folder name (e.g. "02_section")
//   node.config        : { id, classes, attributes, content, css, js, ... }
//   node.children      : child TreeNodes

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "source", "track", "wbr",
]);

function attrs(cfg) {
  const out = [];
  if (cfg.id) out.push(`id="${cfg.id}"`);
  if (cfg.classes && cfg.classes.length) {
    out.push(`className="${cfg.classes.join(" ")}"`);
  }
  for (const [k, v] of Object.entries(cfg.attributes || {})) {
    // React uses htmlFor / a few renamed attrs; keep it simple here.
    const name = k === "for" ? "htmlFor" : k;
    out.push(`${name}="${v}"`);
  }
  return out.length ? " " + out.join(" ") : "";
}

function walk(node, depth) {
  const pad = "  ".repeat(depth);
  const tag = node.display_name || node.name;
  const cfg = node.config || {};
  const a = attrs(cfg);

  if (VOID.has(tag)) return `${pad}<${tag}${a} />`;

  const kids = (node.children || [])
    .map((c) => walk(c, depth + 1))
    .filter(Boolean);
  const content = cfg.content ? `${pad}  ${cfg.content}` : "";
  const inner = [content, ...kids].filter(Boolean).join("\n");

  if (!inner) return `${pad}<${tag}${a} />`;
  return `${pad}<${tag}${a}>\n${inner}\n${pad}</${tag}>`;
}

export default function (doc) {
  const roots = (doc.tree && doc.tree.children) || [];
  // Prefer exporting the <body> subtree as the component body.
  const body =
    roots.find((n) => (n.display_name || n.name) === "body") || null;
  const nodes = body ? body.children || [] : roots;
  const jsx = nodes.map((n) => walk(n, 3)).join("\n");
  return (
    "export default function Page() {\n" +
    "  return (\n" +
    "    <>\n" +
    jsx +
    "\n    </>\n" +
    "  );\n" +
    "}\n"
  );
}
