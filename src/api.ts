import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  ClassFile,
  ImageFolder,
  LoadedPlugin,
  NodeConfig,
  NodeSnapshot,
  ProjectConfig,
  TreeNode,
} from "./types";

export async function pickProjectFolder(): Promise<string | null> {
  const sel = await open({ directory: true, multiple: false });
  if (typeof sel === "string") return sel;
  return null;
}

// Tauri 2 maps JS camelCase keys → Rust snake_case parameter names automatically.
export const readTree = (projectRoot: string) =>
  invoke<TreeNode>("read_tree", { projectRoot });

export const readNode = (nodePath: string) =>
  invoke<NodeConfig>("read_node", { nodePath });

export const writeNode = (nodePath: string, config: NodeConfig) =>
  invoke<void>("write_node", { nodePath, config });

export const createNode = (parentPath: string, name: string) =>
  invoke<string>("create_node", { parentPath, name });

export const deleteNode = (nodePath: string) =>
  invoke<void>("delete_node", { nodePath });

export const renameNode = (oldPath: string, newName: string) =>
  invoke<string>("rename_node", { oldPath, newName });

export const snapshotSubtree = (nodePath: string) =>
  invoke<NodeSnapshot>("snapshot_subtree", { nodePath });

export const restoreSubtree = (parentPath: string, snapshot: NodeSnapshot) =>
  invoke<string>("restore_subtree", { parentPath, snapshot });

export const readProjectConfig = (projectRoot: string) =>
  invoke<ProjectConfig>("read_project_config", { projectRoot });

export const writeProjectConfig = (
  projectRoot: string,
  config: ProjectConfig
) => invoke<void>("write_project_config", { projectRoot, config });

export const initProject = (projectRoot: string, doctype?: string) =>
  invoke<void>("init_project", { projectRoot, doctype: doctype ?? null });

export const readClassFiles = (projectRoot: string) =>
  invoke<ClassFile[]>("read_class_files", { projectRoot });

export const writeClassFile = (
  projectRoot: string,
  fileName: string,
  content: string
) => invoke<void>("write_class_file", { projectRoot, fileName, content });

export const deleteClassFile = (projectRoot: string, fileName: string) =>
  invoke<void>("delete_class_file", { projectRoot, fileName });

export const readImageFolders = (projectRoot: string) =>
  invoke<ImageFolder[]>("read_image_folders", { projectRoot });

export const buildHtml = (projectRoot: string, dev = false) =>
  invoke<string>("build_html", { projectRoot, dev });

export const previewUrl = () => invoke<string>("preview_url");

export interface SelectionInfo {
  version: number;
  path: string | null;
}

export const pollSelection = () =>
  invoke<SelectionInfo>("poll_selection");

export const exportHtml = (projectRoot: string, destFile: string) =>
  invoke<void>("export_html", { projectRoot, destFile });

export const importHtml = (htmlPath: string, destRoot: string) =>
  invoke<string>("import_html", { htmlPath, destRoot });

export async function pickHtmlFile(): Promise<string | null> {
  const sel = await open({
    multiple: false,
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
  return typeof sel === "string" ? sel : null;
}

export async function pickHtmlSaveTarget(): Promise<string | null> {
  const sel = await save({
    defaultPath: "index.html",
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  return sel ?? null;
}

export const readPlugins = (projectRoot: string) =>
  invoke<LoadedPlugin[]>("read_plugins", { projectRoot });

export const readPluginScript = (pluginDir: string, script: string) =>
  invoke<string>("read_plugin_script", { pluginDir, script });

export const writeTextFile = (dest: string, content: string) =>
  invoke<void>("write_text_file", { dest, content });

export async function pickSaveTarget(
  defaultName: string,
  ext: string
): Promise<string | null> {
  const sel = await save({
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  return sel ?? null;
}

export const openInBrowser = (url: string, browserPath: string | null) =>
  invoke<void>("open_in_browser", { url, browserPath });

// Picks an executable file (browser .exe / .app). Reuses the dialog plugin.
export async function pickBrowserExecutable(): Promise<string | null> {
  const sel = await open({
    title: "プレビューブラウザを選択",
    multiple: false,
    filters: [
      { name: "Executable", extensions: ["exe", "app"] },
      { name: "すべて", extensions: ["*"] },
    ],
  });
  if (typeof sel === "string") return sel;
  return null;
}
