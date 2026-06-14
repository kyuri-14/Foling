import type { LocaleDict } from "../i18n";

// Japanese localization pack. Maps each English source string (the key used
// in t("...")) to its Japanese translation. English is the app default; this
// pack is activated via Settings → Language → 日本語.
export const ja: LocaleDict = {
  // Menu bar
  FILE: "ファイル",
  EDIT: "編集",
  VIEW: "表示",
  WINDOW: "ウィンドウ",
  HELP: "ヘルプ",
  "New Project...": "新規プロジェクト...",
  "Open Project...": "プロジェクトを開く...",
  "Save (Ctrl+S)": "保存 (Ctrl+S)",
  "Import HTML... (→ HTFL)": "HTML をインポート... (→ HTFL)",
  "Export HTML... (HTFL →)": "HTML をエクスポート... (HTFL →)",
  "DEFAULT (charset / viewport / lang)...":
    "DEFAULT (charset / viewport / lang)...",
  "PROJECT TAGS (title / description / OGP / favicon)...":
    "PROJECT TAGS (タイトル / 説明 / OGP / favicon)...",
  "Undo (Ctrl+Z)": "元に戻す (Ctrl+Z)",
  "Redo (Ctrl+Y)": "やり直し (Ctrl+Y)",
  "Add child...": "子要素を追加...",
  "Rename...": "リネーム...",
  "Delete...": "削除...",
  "Search... (Ctrl+Shift+F)": "検索... (Ctrl+Shift+F)",
  "Edit class files...": "クラスファイルを編集...",
  "Edit DOCTYPE...": "DOCTYPE を編集...",
  "Edit <html> attributes...": "<html> 属性を編集...",
  "Edit project variables...": "プロジェクト変数を編集...",
  Reload: "再読み込み",
  "Choose preview browser...": "プレビューブラウザを指定...",
  "Reset to default browser": "既定のブラウザに戻す",
  "Settings...": "設定...",
  PLUGINS: "プラグイン",
  "Manage plugins...": "プラグイン管理...",
  "Reload plugins": "プラグインを再読み込み",
  "Keyboard shortcuts...": "キーボードショートカット...",
  "Changelog...": "変更履歴...",
  "About Foling...": "Foling について...",

  // Editor tabs / panel
  CSS: "CSS",
  SCRIPT: "SCRIPT",
  CLASSES: "CLASSES",
  "Select an element from the DOM tree on the left":
    "左の DOM ツリーから要素を選択してください",
  "Select an element": "要素を選択してください",
  "● unsaved": "● 未保存",
  "Dev preview: click an element to jump to it in the editor":
    "開発プレビュー: 要素をクリックするとエディタの該当要素へ移動します",
  "HTFL (HyperText Foldering Language) project":
    "HTFL（HyperText Foldering Language）プロジェクト",
  "New project": "新規プロジェクト",
  "Open existing project": "既存プロジェクトを開く",

  // Element editor modal
  "Edit element — line": "要素を編集 — 行",
  "Select image (src)": "画像を選択 (src)",
  "Current:": "現在:",
  "Text (content)": "テキスト (content)",
  "Text shown inside this tag...": "タグ内に表示するテキスト...",
  "<{tag}> is a void element; it has no content. Edit attributes only.":
    "<{tag}> は内容を持たない要素です。属性のみ編集できます。",
  Attributes: "属性",
  "+ Add attribute": "+ 属性を追加",
  "Attribute name (e.g. href, alt, data-x)":
    "属性名 (例: href, alt, data-x)",
  "Alternative text": "代替テキスト",
  Delete: "削除",
  Done: "完了",

  // HEAD modals
  "HEAD — DEFAULT": "HEAD — DEFAULT",
  "HEAD — PROJECT TAGS": "HEAD — PROJECT TAGS",
  "Rarely-changed default head settings. Saved to htfl.yaml and emitted into <head> at build time.":
    "ほとんど変更しない既定の head 設定です。htfl.yaml に保存され、ビルド時に <head> へ出力されます。",
  "Head tags specific to this project.":
    "このプロジェクト固有の head タグです。",
  "Page title": "ページタイトル",
  "Page description": "ページの説明",
  "OGP (social share)": "OGP (SNS シェア)",
  Icon: "アイコン",
  Cancel: "キャンセル",
  Save: "保存",

  // Settings modal
  "Output mode": "出力モード",
  "SSR = static HTML only (no SCRIPT/JS — displays with JavaScript disabled). SSR + JS = also emits interactive JS (per project).":
    "SSR = 静的 HTML のみ (SCRIPT/JS を出力せず、JavaScript 無効でも表示)。SSR + JS = 対話用の JS も出力します (プロジェクト単位)。",
  "SSR (static)": "SSR (静的)",
  "SSR + JS (dynamic)": "SSR + JS (動的)",
  "CSS reset": "CSS リセット",
  "Disable browser default margin / padding / list-style etc. (per project).":
    "margin / padding / list-style 等のブラウザ既定を無効化します (プロジェクト単位)。",
  "ON ✓": "ON ✓",
  "OFF (browser default)": "OFF (ブラウザ既定)",
  "Preview browser": "プレビュー用ブラウザ",
  "(OS default browser)": "(OS の既定ブラウザ)",
  "Choose...": "指定...",
  "Reset to default": "既定に戻す",
  "Plugin execution permission": "プラグイン実行の許可",
  "Plugins run arbitrary JavaScript. Resetting will ask for confirmation again on next run.":
    "プラグインは任意の JavaScript を実行します。許可状態をリセットすると、次回実行時に再度確認します。",
  Reset: "リセット",
  Language: "言語",
  "Choose the UI language. English is the default; 日本語 is a language pack.":
    "UI の言語。English が既定、日本語は言語パックです。",
  Close: "閉じる",

  // About / Changelog
  "A desktop editor for HTFL (HyperText Foldering Language).":
    "HTFL (HyperText Foldering Language) 用のデスクトップエディター。",
  Version: "バージョン",
  License: "ライセンス",
  "Built with": "技術",
  "About Foling": "Foling について",
};
