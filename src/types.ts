export interface TreeNode {
  name: string;
  display_name: string;
  path: string;
  order: number | null;
  has_config: boolean;
  config: NodeConfig;
  children: TreeNode[];
}

export interface LinkEntry {
  rel: string;
  href: string;
  type?: string;
}

export interface NodeConfig {
  tag?: string;
  id?: string;
  classes: string[];
  available_classes?: string[];
  disabled_inherits?: string[];
  attributes: Record<string, string>;
  content?: string;
  css?: string;
  js?: string;
  links: LinkEntry[];
}

export interface ProjectConfig {
  doctype?: string;
  variables: Record<string, string>;
  class_file_targets?: Record<string, string>;
  /** When undefined or true, prepend the built-in CSS reset.
   *  When false, fall back to the browser's user-agent stylesheet. */
  css_reset?: boolean;
}

export interface NodeSnapshot {
  name: string;
  config: NodeConfig;
  children: NodeSnapshot[];
}

export interface ClassFile {
  name: string;
  content: string;
}

export interface ImageFolder {
  name: string;
  images: string[]; // paths relative to images/ (e.g., "icons/foo.png")
}

export interface ExporterDef {
  id: string;
  label: string;
  script: string;
  extension?: string;
}

export interface ClassDictEntry {
  name: string;
  description?: string;
}

export interface SnippetEntry {
  name: string;
  kind: string; // "css" | "content"
  body: string;
}

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  exporters?: ExporterDef[];
  classes?: ClassDictEntry[];
  snippets?: SnippetEntry[];
}

export interface LoadedPlugin {
  dir: string;
  dir_name: string;
  manifest: PluginManifest;
}

export type UndoAction =
  // `prevSelected` is the element that was selected *before* this node was
  // created, so undo can restore the user's prior selection instead of
  // clearing it.
  | { type: "create"; path: string; prevSelected?: string | null }
  | { type: "delete"; parentPath: string; snapshot: NodeSnapshot }
  | { type: "rename"; oldPath: string; newPath: string };

export const emptyConfig = (): NodeConfig => ({
  classes: [],
  attributes: {},
  links: [],
});
