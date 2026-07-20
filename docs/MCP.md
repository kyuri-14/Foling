# MCP サーバーガイド

Foling は **MCP (Model Context Protocol) サーバー**として動作します。Claude Code / Codex CLI などの AI エージェントが、**Foling 自身の操作**を通してプロジェクトを編集できます。

エージェントにフォルダを直接触らせる方式（PLUGINS → AI のターミナル連携）との違いは、**壊れた状態を作れない**ことです。`NN_` の連番採番、`config.yaml` の構造、ビルドの意味づけは、すべてアプリ側が担保します。エージェントは「2 行目の下に section を足す」と言うだけで、フォルダ名を考える必要がありません。

---

## 1. 2 つの接続方法

| | 起動中のエディタ (HTTP) | 単体起動 (stdio) |
|---|---|---|
| Foling の起動 | 必要 | 不要 |
| ツリーの自動反映 | ✅ される | ❌ 手動で **PLUGINS → ツリーを再読み込み** |
| 追加の入手物 | なし | `foling-mcp` 実行ファイル |
| 向いている場面 | エディタを見ながら一緒に作業 | バッチ処理・CI・エディタを開かない編集 |

どちらも同じツール群・同じ実装を使います。接続方法が違うだけです。

### 1-1. 起動中のエディタに繋ぐ (HTTP)

1. プロジェクトを開く
2. **PLUGINS → AI → MCP サーバーを起動**
3. 表示されたダイアログの **設定をコピー** を押す
4. **プロジェクトフォルダ直下**に `.mcp.json` を作って貼り付ける（Claude Code）

```json
{
  "mcpServers": {
    "foling": {
      "type": "http",
      "url": "http://127.0.0.1:53124/mcp",
      "headers": { "Authorization": "Bearer 8f3a…" }
    }
  }
}
```

ポートとトークンは**アプリの起動ごとに変わります**。繋がらなくなったら **MCP 接続情報...** を開き直してください。

コマンドで登録することもできます（`-s project` で `.mcp.json` に書き込まれます）:

```sh
claude mcp add --transport http foling http://127.0.0.1:53124/mcp \
  --header "Authorization: Bearer 8f3a…" -s project
```

> Codex CLI で HTTP トランスポートが使えるかはバージョン依存です。確実なのは次の stdio 方式です。

### 1-2. 単体で起動する (stdio)

`foling-mcp` を入手します。

- リリースページからダウンロード（`foling-mcp-windows-x86_64.exe` など）
- または自分でビルド: `cd src-tauri && cargo build --release --bin foling-mcp`

**Claude Code** — プロジェクト直下の `.mcp.json`:

```json
{
  "mcpServers": {
    "foling": {
      "command": "C:\\path\\to\\foling-mcp.exe",
      "args": ["--project", "C:\\path\\to\\my-site"]
    }
  }
}
```

**Codex CLI** — `~/.codex/config.toml`（形式が TOML で異なります）:

```toml
[mcp_servers.foling]
command = 'C:\path\to\foling-mcp.exe'
args = ['--project', 'C:\path\to\my-site']
```

> TOML の**シングルクォート**はリテラル文字列です。Windows のパスをバックスラッシュのまま書けるので、`\\` にエスケープする必要がありません。JSON 側は `\\` が必要です。

オプション:

| オプション | 意味 |
|---|---|
| `-p`, `--project <dir>` | HTFL プロジェクトのフォルダ（省略時はカレントディレクトリ） |
| `--read-only` | 読み取り系ツールのみ有効化し、すべての変更を拒否 |

> **stdout はプロトコル専用です。** ログはすべて stderr に出ます。

---

## 2. 要素の指し方（`ref`）

要素は 2 通りで指定でき、**どのツールでも両方使えます**。

| 形式 | 例 | 特徴 |
|---|---|---|
| 行番号 | `L12` | エディタ画面の行番号 = ビルドが出力する `id`。人間と会話が噛み合う |
| 相対パス | `02_body/01_header` | `HTML/` からの相対パス。他所を編集してもズレない |

`<body>` が **1 行目**です。ツールの戻り値には常に両方が含まれます。

> ⚠ **挿入・削除をすると行番号はズレます。** 構造を変えたら `htfl_get_tree` を読み直してください。

絶対パスは受け付けませんし、返しません。`..` やシンボリックリンクでプロジェクト外に出ることもできません。

---

## 3. ツール一覧

### 読み取り

| ツール | 内容 |
|---|---|
| `htfl_get_tree` | ツリーを行番号付きインデントテキストで返す。`ref` / `depth` で範囲指定 |
| `htfl_get_element` | 1 要素の `config.yaml` 全体 |
| `htfl_get_project` | `htfl.yaml`（doctype / 変数 / output_mode / `<head>`）と `<html lang>` |
| `htfl_list_classes` | `classes/*.css` と各ファイルが定義するクラス名 |
| `htfl_read_class_file` | クラス CSS ファイルの中身 |
| `htfl_list_modules` | 利用可能なモジュール |
| `htfl_list_images` | `images/` 配下の画像 |

### 書き込み

| ツール | 内容 |
|---|---|
| `htfl_insert_element` | 子要素を作成。**`NN_` は自動採番**、途中挿入時のみ後続をリナンバ |
| `htfl_update_element` | 部分パッチ。属性はマージ（値 `null` で削除）、`content`/`css`/`js` は `null` でクリア |
| `htfl_rename_element` | タグ変更（連番・設定・子要素は保持） |
| `htfl_move_element` | 親・位置の変更（サブツリーごと移動） |
| `htfl_delete_element` | サブツリーごと削除 |
| `htfl_expand_module` | モジュール展開（バンドル CSS を `99_modules.css` へ追記） |
| `htfl_write_class_file` | `classes/` の CSS ファイルを書き込み（全文置換） |
| `htfl_update_project` | `htfl.yaml` の部分更新。**`<title>` や meta description はここ** |

### ビルド

| ツール | 内容 |
|---|---|
| `htfl_build` | HTML を生成して**診断**を返す。ファイルは書かない |
| `htfl_export_html` | プロジェクト内に単体 `.html` として書き出す |

`htfl_build` が報告する診断:

- 未知のタグ（`<div>` にフォールバックされる）
- 適用されているが `classes/` に定義がないクラス
- void 要素に付いた本文・子要素（出力されない）
- 空の `href` / `src`

いずれも「ビルドは通るが結果が間違っている」類の失敗です。編集後は必ず `htfl_build` を実行してください。

---

## 4. 公開していない機能

意図的に外してあります。

- 任意パスへのファイル書き込み（`write_text_file`）
- ターミナル起動（`open_terminal`）・ブラウザ起動（`open_in_browser`）
- プラグインスクリプトの読み取り・実行

エージェントに**ページを作らせる**ことはできますが、**ユーザーのマシンでコマンドを実行させる**ことはできません。

---

## 5. セキュリティ

### HTTP トランスポート

- `127.0.0.1` のみにバインド
- **Bearer トークン必須**（アプリ起動ごとに生成）
- ブラウザ由来の `Origin` ヘッダを持つリクエストは拒否（DNS リバインディング対策）
- プロジェクトが明示的にバインドされるまで `503`

エディタと同じローカルサーバー上にあるため、ユーザーが開いている Web ページから到達可能です。上記はそのための防御です。トークンは画面に表示されるので、**共有しないでください**。

### 同時編集

エディタと `foling-mcp` が同じプロジェクトを同時に触る場合に備え、`.foling/lock` によるプロセス間の排他ロックを取ります。ロックが取れない環境（読み取り専用ボリューム等）ではプロセス内ロックのみで続行します。ロックでエディタが固まることはありません。

プロジェクトを Git 管理している場合は、`.gitignore` に `.foling/` を追加してください。

---

## 6. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `401 missing or invalid bearer token` | アプリを再起動するとトークンが変わります。**MCP 接続情報...** で取り直してください |
| `503 no project is bound` | **PLUGINS → AI → MCP サーバーを起動** を実行してください |
| `not an HTFL project (no HTML/ directory)` | `--project` が HTFL プロジェクトではありません。`htfl.yaml` と `HTML/` があるフォルダを指定してください |
| エージェントの編集がツリーに出ない | stdio 接続では自動反映されません。**PLUGINS → ツリーを再読み込み** |
| 行番号がズレる | 挿入・削除の後は `htfl_get_tree` を読み直してください |
