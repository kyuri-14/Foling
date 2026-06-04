# HTFL 言語仕様

**HTFL (HyperText Foldering Language)** は、HTML の DOM 構造を **ファイルシステムのフォルダ階層** で表現する言語です。1 フォルダ = 1 要素、フォルダ内の `config.yaml` がその要素の属性・CSS・本文などを保持します。

このドキュメントは Foling Editor が実装している HTFL の正式仕様です。

---

## 1. プロジェクト構成

```
my-project/
├── htfl.yaml              # プロジェクト設定(変数・doctype など)
├── HTML/                  # ドキュメントツリーのルート = <html>
│   ├── config.yaml        #   <html> 自身の設定
│   ├── 01_head/           #   <head>
│   │   ├── config.yaml
│   │   ├── 01_meta/
│   │   └── 02_title/
│   └── 02_body/           #   <body>
│       ├── config.yaml
│       ├── 01_header/
│       └── 02_article/
├── classes/               # プロジェクト共通の CSS クラスファイル
│   ├── 01_foundation.css
│   └── 02_component.css
├── images/                # 画像(サブフォルダ単位で管理)
│   └── icons/
└── plugins/               # 拡張機能(→ docs/PLUGINS.md)
    └── starter/
```

- **`HTML/`** フォルダがドキュメントの起点で、`<html>` 要素に対応します。
- `HTML/` の子フォルダ(通常 `head` と `body`)がそのまま `<html>` の子要素になります。
- `classes/` `images/` `plugins/` `htfl.yaml` は Foling Editor がプロジェクトを開いた際に自動生成されます。

---

## 2. フォルダ命名規則

各要素フォルダの名前は次のいずれかです。

| 形式 | 例 | タグ名 |
|---|---|---|
| `タグ名` | `header` | `header` |
| `NN_タグ名` | `02_section` | `section` |

- **`NN`**(先頭の数字 + アンダースコア)は **兄弟内での並び順**です。2 桁ゼロ埋め推奨(`01_`, `02_`, …)。出力時はこの順にソートされます。
- `NN_` プレフィックスは出力時に取り除かれ、残りがタグ名になります。
- プレフィックスのない `header` のような名前も有効です(順序は名前順)。

### タグ名の解決

- 既知の HTML タグ名(`div`, `section`, `ul`, `a` など)はそのまま出力されます。
- **ハイフンを含む名前**(例: `my-widget`)はカスタム要素としてそのまま出力されます。
- 上記以外の未知の名前は **`<div>` にフォールバック**します(エディタ上では点線と `⚠ div` バッジで警告)。

> 既知タグの一覧は実装の `KNOWN_HTML_TAGS`(`src-tauri/src/lib.rs`)を参照してください。

---

## 3. `config.yaml`(要素設定)

各要素フォルダ直下の `config.yaml` は次のフィールドを持ちます。**すべて任意**で、空の項目は省略されます。

```yaml
tag: div                  # タグ名の明示的な上書き(通常はフォルダ名から推定)
id: hero                  # id 属性
classes:                  # 出力される class(class="...")
  - container
  - flex-row
available_classes:        # この要素の CLASSES 欄に表示する候補(classes の上位集合)
  - container
  - flex-row
  - hidden
disabled_inherits:        # 無効化する継承 CSS プロパティ(prop: initial として出力)
  - color
attributes:               # 任意の HTML 属性(キー: 値)
  data-key: value
  aria-label: メニュー
content: |                # 要素内のテキスト
  本文テキスト
css: |                    # この要素自身の CSS(BASIN)
  padding: 1rem 2rem;
  background-color: $colorMain;
js: |                     # この要素に紐づく JavaScript
  el.addEventListener('click', () => console.log('clicked'));
links:                    # <link> 要素(通常は head 内で使用)
  - rel: stylesheet
    href: /styles/main.css
    type: text/css        # 任意
```

### フィールド詳細

| フィールド | 型 | 説明 |
|---|---|---|
| `tag` | string | フォルダ名から推定されるタグを上書き。通常は不要。 |
| `id` | string | `id` 属性。 |
| `classes` | string[] | 実際に出力される class。 |
| `available_classes` | string[] | エディタの CLASSES 欄に出す候補集合。`classes` を含む上位集合。UI でのトグルは `classes` の出し入れのみ。 |
| `disabled_inherits` | string[] | 親から継承される CSS のうち無効化したいプロパティ。ビルド時に `prop: initial;` としてインラインで出力。 |
| `attributes` | map | 任意の HTML 属性。値には変数(`$name`)を使用可。 |
| `content` | string | 要素内テキスト。変数を使用可。 |
| `css` | string | この要素の CSS 宣言群(セレクタ不要、宣言のみ)。変数を使用可。BASIN カスケードに参加。 |
| `js` | string | この要素のスクリプト。ビルド時に IIFE で包まれ、`el` がこの要素(`data-htfl-id` 経由)に束縛される。 |
| `links` | LinkEntry[] | `<link>` 要素。`rel` / `href`(必須)、`type`(任意)。 |

---

## 4. `htfl.yaml`(プロジェクト設定)

```yaml
doctype: <!DOCTYPE html>   # 出力 HTML 先頭の doctype(省略時は <!DOCTYPE html>)
variables:                 # プロジェクト変数($name で参照)
  colorMain: "#39b54a"
  colorFontSub: "#666666"
  shadow: "0 2px 8px rgba(0,0,0,0.15)"
class_file_targets:        # 任意: 各クラスファイルが対象とする要素(メタ情報)
  02_component.css: 02_body/02_article
css_reset: true            # CSS リセットの ON/OFF(省略時 true)
```

| フィールド | 型 | 説明 |
|---|---|---|
| `doctype` | string | 出力先頭の DOCTYPE 宣言。 |
| `variables` | map | プロジェクト変数。`$name` で `css` / `content` / `attributes` 内から参照。 |
| `class_file_targets` | map | `classes/` 内の各 CSS ファイルが「どの要素向けか」を示すメタ情報(キー=ファイル名、値=`HTML/` 配下の相対パス)。 |
| `css_reset` | bool | `true`(既定)でビルド時にリセット CSS を先頭に挿入。`false` でブラウザ既定スタイルを使用。 |

---

## 5. 変数

- 構文は **`$name`** です(`${...}` 形式はありません)。
- `name` に使える文字は英数字・`_`・`-` です。
- `htfl.yaml` の `variables` で定義された値に、ビルド時に **`css` / `content` / `attributes` の値** 内で置換されます。
- 未定義の変数(`$unknown`)はそのまま文字列として残ります。

```yaml
# htfl.yaml
variables:
  colorMain: "#39b54a"
```
```yaml
# 要素の config.yaml
css: |
  background-color: $colorMain;   # → background-color: #39b54a;
```

---

## 6. CSS の扱い(BASIN カスケード)

- 各要素の `css` は **宣言のみ**(セレクタ不要)を書きます。ビルド時に要素ごとの `data-htfl-id` を使ったセレクタが自動生成され、`<head>` の `<style>` にまとめて出力されます。
- `classes/` 配下の CSS ファイルはプロジェクト共通のクラス定義として出力に含まれます。
- `disabled_inherits` に挙げたプロパティは `prop: initial;` として打ち消されます。

### CSS リセット

`css_reset`(既定 `true`)が有効なとき、ビルド時に margin / padding / list-style / text-decoration / 見出しの font-size などを 0 化する小さなリセットが `<style>` 先頭に挿入されます。`htfl.yaml` で `css_reset: false`、またはエディタの **VIEW > CSS リセット** / **設定** で切り替えられます。

---

## 7. JavaScript の扱い

- 要素の `js` はビルド時に IIFE で包まれ、`el` 変数がその要素(`document.querySelector('[data-htfl-id="..."]')`)に束縛されます。
- 例:
  ```yaml
  js: |
    el.addEventListener('click', () => el.classList.toggle('open'));
  ```

---

## 8. ビルド(HTFL → HTML)

Foling Editor の **RUN / DEV** または **HTML エクスポート** で、以下の手順で 1 枚の HTML を生成します。

1. `htfl.yaml` の `doctype` を出力。
2. `HTML/` を再帰的に走査して要素ツリーを構築(`NN_` 順)。
3. `<head>` に CSS リセット(有効時)+ 各要素 CSS + `classes/` の CSS を `<style>` で出力。
4. 各要素を属性・class・content とともに出力。未知タグは `<div>` に変換。
5. `js` を持つ要素のスクリプトを末尾にまとめて出力。

---

## 9. 予約・特別扱い

| 名前 | 意味 |
|---|---|
| `HTML/` | ドキュメントルート = `<html>`。 |
| `head` / `body` | `HTML/` 直下の慣習的な子。エディタは BODY / HEAD ビューで切り替え表示。 |
| `classes/` `images/` `plugins/` | プロジェクト用の予約フォルダ(要素ではない)。 |
| `config.yaml` | 各フォルダの要素設定ファイル。 |
| `htfl.yaml` | プロジェクトルートの設定ファイル。 |

---

## 10. 最小例

```
htfl.yaml
HTML/
  config.yaml            # <html>
  01_head/
    config.yaml          # <head>
    01_title/config.yaml # <title> content: My Page
  02_body/
    config.yaml          # <body>
    01_h1/config.yaml    # <h1> content: こんにちは
```

```yaml
# HTML/02_body/01_h1/config.yaml
content: こんにちは
css: |
  color: $colorMain;
```

出力(概略):
```html
<!DOCTYPE html>
<html>
  <head>
    <style>/* reset + #...{color:#39b54a} */</style>
    <title>My Page</title>
  </head>
  <body>
    <h1 data-htfl-id="...">こんにちは</h1>
  </body>
</html>
```
