# プラグイン開発ガイド

Foling はプロジェクトの `plugins/` フォルダ配下のプラグインを読み込みます。プラグインは 3 種類の機能を提供できます。

1. **エクスポータ** — HTFL ドキュメントを任意のテキスト形式へ変換(例: JSX、独自テンプレート)。
2. **クラス辞書** — フレームワークのユーティリティクラスを CLASSES 欄の候補として提供。
3. **スニペット** — CSS / 本文に挿入できる定型テキスト。

> ⚠ **セキュリティ:** エクスポータは任意の JavaScript を実行します。Web Worker 内で実行され DOM や Tauri API には触れませんが、`fetch` は使用可能で **完全なサンドボックスではありません**。信頼できる提供元のプラグインのみ使用してください。初回実行時に確認ダイアログが表示されます。

---

## 1. ディレクトリ構成

```
my-project/
└── plugins/
    └── my-plugin/
        ├── plugin.yaml     # マニフェスト(必須)
        └── exporter.js     # エクスポータの JS(exporters で参照する場合)
```

`plugins/` 直下の各サブフォルダが 1 プラグインです。**PLUGINS > 再読み込み** で再スキャンされます。

---

## 2. マニフェスト `plugin.yaml`

```yaml
name: My Plugin            # 表示名(必須)
version: 0.1.0             # 任意
description: 説明文         # 任意

exporters:                 # エクスポータ定義
  - id: jsx                # 一意な ID
    label: JSX で書き出し    # メニュー表示名
    script: jsx.js         # プラグインフォルダからの相対パス
    extension: jsx         # 保存ダイアログの既定拡張子(任意)

classes:                   # クラス辞書
  - name: flex
    description: "display: flex"
  - name: container
    description: "max-width コンテナ"

snippets:                  # スニペット
  - name: Flexbox 中央寄せ
    kind: css              # "css" | "content"(既定 "css")
    body: |
      display: flex;
      align-items: center;
      justify-content: center;

agents:                    # AI エージェント CLI
  - id: aider              # 一意な ID
    label: Aider           # メニュー表示名
    command: aider         # ターミナルで実行するコマンド
```

### フィールド

| セクション | フィールド | 説明 |
|---|---|---|
| (トップ) | `name` | プラグイン表示名(必須)。 |
| | `version` / `description` | 任意。 |
| `exporters[]` | `id` | 一意な識別子。 |
| | `label` | PLUGINS メニューに出る名前。 |
| | `script` | エクスポータ JS への相対パス。 |
| | `extension` | 保存時の既定拡張子(任意)。 |
| `classes[]` | `name` | クラス名。 |
| | `description` | 説明(任意)。 |
| `snippets[]` | `name` | スニペット名。 |
| | `kind` | `css` または `content`(既定 `css`)。 |
| | `body` | 挿入される本文。 |
| `agents[]` | `id` | 一意な識別子。 |
| | `label` | PLUGINS メニューの AI セクションに出る名前。 |
| | `command` | OS のターミナルで、**プロジェクトフォルダを作業ディレクトリに**実行されるコマンド。実行前にユーザーへコマンド全文が確認表示されます。HTFL はフォルダ＋YAML なので、Claude Code / Codex などのファイル編集エージェントがプロジェクトを直接編集できます。編集後は「プラグイン → ツリーを再読み込み」で取り込みます。Claude Code と Codex はビルトインで登録済みです。 |

---

## 3. エクスポータの書き方

エクスポータの JS は **ES モジュール** で、`doc` を受け取り文字列を返す **デフォルトエクスポート関数** を持ちます。

```js
// exporter.js
export default function (doc) {
  // ... doc を変換 ...
  return "出力テキスト";
}
```

- `async` 関数でも構いません(返り値は `await` されます)。
- 返り値は `String(...)` 化されます。
- 実行は **8 秒でタイムアウト**します。
- `default` の他に `exporter` / `convert` という名前のエクスポートも認識されます。

### `doc` オブジェクト

```ts
doc = {
  tree: TreeNode,            // ドキュメントルート(<html>)
  projectConfig: ProjectConfig,
  classFiles: ClassFile[],
}
```

#### `TreeNode`

```ts
interface TreeNode {
  name: string;          // フォルダ名(例 "02_section")
  display_name: string;  // タグ名(プレフィックス除去後、例 "section")
  path: string;          // ディスク上の絶対パス
  order: number | null;  // NN プレフィックスの数値(なければ null)
  has_config: boolean;
  config: NodeConfig;    // 要素設定(↓)
  children: TreeNode[];
}
```

#### `NodeConfig`

```ts
interface NodeConfig {
  tag?: string;
  id?: string;
  classes: string[];
  available_classes: string[];
  disabled_inherits: string[];
  attributes: Record<string, string>;
  content?: string;
  css?: string;
  js?: string;
  links: { rel: string; href: string; type?: string }[];
}
```

#### `ProjectConfig` / `ClassFile`

```ts
interface ProjectConfig {
  doctype?: string;
  variables: Record<string, string>;
  class_file_targets: Record<string, string>;
  css_reset?: boolean;
}
interface ClassFile { name: string; content: string; }
```

> ⚠ `doc` 内の変数(`$name`)は **未置換** です。必要ならエクスポータ側で `projectConfig.variables` を使って置換してください。

### 実行環境の制約

- DOM へのアクセス不可(Web Worker)。
- Tauri の `invoke` 不可(ファイルシステムに直接触れない)。
- `fetch` は可能(外部通信は利用者の責任)。
- 1 回の実行は 8 秒でタイムアウト。

---

## 4. エクスポータの完全な例

`sample-project/plugins/starter/jsx.js` が、HTFL ツリーを 1 つの JSX コンポーネントに変換する実例です。要点:

```js
const VOID = new Set(["br", "img", "input", "hr", "meta", "link", /* ... */]);

function attrs(cfg) {
  const out = [];
  if (cfg.id) out.push(`id="${cfg.id}"`);
  if (cfg.classes?.length) out.push(`className="${cfg.classes.join(" ")}"`);
  for (const [k, v] of Object.entries(cfg.attributes || {})) {
    out.push(`${k === "for" ? "htmlFor" : k}="${v}"`);
  }
  return out.length ? " " + out.join(" ") : "";
}

function walk(node, depth) {
  const tag = node.display_name || node.name;
  const cfg = node.config || {};
  const kids = (node.children || []).map((c) => walk(c, depth + 1));
  const inner = [cfg.content, ...kids].filter(Boolean).join("\n");
  if (VOID.has(tag)) return `<${tag}${attrs(cfg)} />`;
  return inner
    ? `<${tag}${attrs(cfg)}>\n${inner}\n</${tag}>`
    : `<${tag}${attrs(cfg)} />`;
}

export default function (doc) {
  const roots = doc.tree?.children || [];
  const body = roots.find((n) => (n.display_name || n.name) === "body");
  const nodes = body ? body.children : roots;
  return (
    "export default function Page() {\n  return (\n    <>\n" +
    nodes.map((n) => walk(n, 3)).join("\n") +
    "\n    </>\n  );\n}\n"
  );
}
```

---

## 5. クラス辞書とスニペット

- **クラス辞書** (`classes[]`) は、選択要素の **CLASSES** 欄に候補として現れ、ワンクリックで `classes` に追加できます。
- **スニペット** (`snippets[]`) は、PLUGINS の管理画面から CSS / 本文に挿入できます。

これらは JS を実行しないため安全です(同意ダイアログの対象外)。

---

## 6. 配布

- プラグインは単なるフォルダなので、`plugins/<name>/` ごと配布・コピーできます。
- 利用者は対象プロジェクトの `plugins/` に置いて **PLUGINS > 再読み込み** するだけです。
