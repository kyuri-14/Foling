# Foling Editor — 公開準備 TODO

現状調査(2026-06-05 時点)に基づく、一般公開までに不足している機能・実装の一覧。
優先度順: **P0(リリースブロッカー)** → **P4(保守性)**。

---

## P0 — 公開前に必須(これがないと配布できない / 重大な不備）

- [x] **Git リポジトリ初期化** — `git init`(`main` ブランチ)+ 初回コミット完了。
      ※ リモート(GitHub 等)の作成・push は別途。
- [x] **LICENSE ファイル** — GPL-3.0 全文を `LICENSE` に配置。
      `package.json` / `Cargo.toml` に `license: GPL-3.0-or-later` を追加。README にライセンス節を追加。
- [x] **bundle identifier の ASCII 化** — `com.大松雄斗.foling-editor` → `com.foling.editor`。
- [x] **Content-Security-Policy 設定** — `tauri.conf.json` の `security.csp` を設定済み
      (self + ローカルプレビュー 127.0.0.1 の img/connect + inline style + blob worker)。
      ⚠ **要動作確認**: `npm run tauri dev` で白画面/読み込み失敗が出ないこと。問題時は一旦 `null` に戻す。
- [ ] **アプリアイコンの差し替え(要・独自画像)** — 現状は **Tauri 既定ロゴのまま**。
      1024×1024 程度の PNG を用意し `npm run tauri icon path/to/icon.png` で全サイズ生成。
- [ ] **コード署名 / 公証(notarization)(要・証明書)** — 未署名のため Windows SmartScreen /
      macOS Gatekeeper が警告。README に注意書きは追記済み。正式配布時に証明書で署名。

---

## P1 — 品質・安全性(公開直後にユーザーが踏みやすい）

- [x] **React エラーバウンダリ** — `src/ErrorBoundary.tsx` を追加し `main.tsx` で全体をラップ。
      例外時はメッセージ + スタック + 「再読み込み / 続行」導線を表示(白画面化を防止)。
- [x] **Rust の `unwrap()` 監査** — ユーザー操作で到達し得る 2 箇所を堅牢化
      (`extra_head_styles` は `if let`、プレビューサーバの Content-Type は失敗時フォールバック)。
      残りは静的・不可侵(固定セレクタ/固定ヘッダ/`run().expect()`)のため据え置き。
- [x] **保存付き終了確認** — `onCloseRequested` で未保存(config / tree / class)を検出し、
      終了前に自動フラッシュしてから閉じる。保存失敗時は閉じずにエラー表示。
      (capability に `core:window:allow-close/destroy` を追加)
- [x] **自動保存(クラッシュ耐性)** — config / class ファイルは既に 500ms autosave 済み。
      加えて autosave のパス競合バグ(選択切替直後に旧 config を別要素へ書く)を `configPathRef` で修正。
- [x] **Redo 実装** — Undo/Redo を双方向スタック化(`performInverse`)。Ctrl+Y / Ctrl+Shift+Z 対応、
      EDIT メニューに「やり直し」追加。新規操作で redo 履歴をクリア。
- [x] **プラグイン実行の同意ゲート** — exporter(任意 JS 実行)の初回に警告つき確認を表示
      (`foling.pluginConsent`)。「Worker は完全な隔離ではない/信頼できる提供元のみ」と明示。
      ※ 真のサンドボックス化(権限制限・API 遮断)は今後の課題として残置。
- [ ] **自動アップデート(要・インフラ)** — Tauri updater は署名鍵 + 配信エンドポイントが必要なため未実装。
      当面は「手動ダウンロード更新」運用。導入時に `updater` プラグイン + 公開鍵を設定。

---

## P2 — UX / 機能の充実(実用エディタとして期待される）

- [x] **設定画面** — `SettingsModal`(WINDOW > 設定...)を追加。CSS リセット既定・
      プレビュー用ブラウザ・プラグイン実行許可のリセットを集約。
- [x] **ウィンドウ状態の記憶** — `tauri-plugin-window-state` を導入(サイズ/位置/最大化を保存)。
      capability に `window-state:default` を追加。
- [~] **プロジェクト全体の検索** — `SearchModal`(EDIT > 検索 / Ctrl+Shift+F)を追加。
      タグ名 / id / class / 本文 / CSS を横断検索し、クリックで該当要素へジャンプ。
      ※ **置換(replace)は未実装**(破壊的操作のため別途慎重に設計)。
- [x] **キーボードショートカット一覧** — `ShortcutsModal`(HELP > キーボードショートカット)。
- [x] **About ダイアログ** — `AboutModal`(HELP > Foling Editor について)。版・ライセンス・技術構成。
- [~] **アクセシビリティ(一部)** — 全モーダルに `role="dialog"` / `aria-modal` / Esc クローズ、
      通知に `role=alert/status` + `aria-live`、アイコンボタンに `aria-label` を付与。
      ※ ツリー/エディタ全体の網羅的な ARIA 対応・フォーカストラップは継続課題。
- [x] **通知 / エラー表示の改善** — info トーストは数秒で自動消去、error はクリックで消去(持続)。
      `aria-live` でスクリーンリーダー通知。
- [ ] **(任意)国際化(i18n）** — UI 文言が日本語ハードコード。海外公開する場合のみ対応。

---

## P3 — ドキュメント・配布

- [x] **HTFL 言語仕様書** — `docs/HTFL-SPEC.md`。フォルダ命名・`config.yaml` / `htfl.yaml`
      スキーマ・変数(`$name`)・CSS リセット・ビルド手順・予約名を実装どおりに記載。
- [x] **README 拡充** — 機能一覧・ドキュメントリンク・スクリーンショット枠・
      リリース/ライセンス節を追加(スクショ画像の差し込みは要対応)。
- [x] **プラグイン開発ドキュメント** — `docs/PLUGINS.md`。`plugin.yaml` スキーマ、exporter API、
      `doc`(tree / projectConfig / classFiles)の型、実行制約、サンプル解説。
- [x] **CHANGELOG.md** — Keep a Changelog 形式で作成。
- [x] **CONTRIBUTING.md** — 開発手順・検証・方針を記載。
- [ ] **(任意)Issue / PR テンプレート / 行動規範** — `.github/` 配下に追加(P4 の CI 整備と同時が効率的)。
- [ ] **スクリーンショット** — `docs/screenshot.png` を用意して README に差し込み(要・画像)。

---

## P4 — テスト・保守性(長期運用の土台）

- [ ] **CI/CD が未整備(`.github` なし）** — lint + 型チェック + ビルド、
      タグ push で各 OS バイナリを自動ビルド & Release。
- [ ] **テストが皆無** — Rust ユニット(`read_tree` / `build_html` / import / export / NN 採番 / 変数置換）、
      フロント(`rowsToParsedTree` / ツリー差分 / `syncRowsFromTree`)、最低限の E2E。
- [ ] **`App.tsx` が 5360 行の単一ファイル** — コンポーネント / フック / ユーティリティへ分割。
- [ ] **`bundle.targets: "all"` の見直し** — リリースする OS / 形式(msi, nsis, dmg, deb 等)を明示。

---

### 補足(調査メモ）
- プレビューサーバは `127.0.0.1:0`(ランダムポート, localhost 限定)で外部公開なし — 妥当。
- `dialog:allow-open` / `allow-save` のみ許可 — 最小権限で良好。
- 既知の設計上のトレードオフ: Alt+矢印の並べ替えはディスク上の `NN_` 順に即時反映されない
  (HTML 出力順と編集表示順が乖離しうる)。「整列」コマンドの追加を検討。
