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

- [ ] **React エラーバウンダリがない** — レンダリング例外で画面が真っ白になる。
      トップに ErrorBoundary を入れ、復帰/再読み込み導線を用意。
- [ ] **Rust の `unwrap()` / `expect()` 監査** — `lib.rs` に 5 箇所の `unwrap()`。
      ユーザー入力・壊れた YAML・権限エラーで panic しないか確認し `Result` 化。
- [ ] **未保存のまま終了する際の確認がない** — `onCloseRequested` で未保存変更を警告。
- [ ] **クラッシュ復旧 / 自動保存がない** — 編集中データ保護(ジャーナル or 定期スナップショット)。
- [ ] **Redo が未実装** — Undo はあるが Redo(Ctrl+Y / Ctrl+Shift+Z）がない。
- [ ] **プラグインのセキュリティ** — 任意 JS を Worker で実行中。Worker は完全なサンドボックスではない
      (fetch 等が可能)。導入時の警告・許可 UI、信頼できる配布元の明示、権限制限を検討。
- [ ] **自動アップデート** — Tauri updater(署名鍵 + 配信エンドポイント)を設定。
      導入しない場合は「手動ダウンロード更新」を README に明記。

---

## P2 — UX / 機能の充実(実用エディタとして期待される）

- [ ] **設定画面がない** — CSS リセット既定・プレビュー用ブラウザ・テーマ等が散在。
      設定モーダルへ集約し、永続化(現状 localStorage 断片的)。
- [ ] **ウィンドウ状態の記憶** — サイズ/位置の保存(`tauri-plugin-window-state`)。
- [ ] **プロジェクト全体の検索 / 置換** — 要素名・テキスト・クラスの横断検索。
- [ ] **キーボードショートカット一覧 / ヘルプ** — ショートカットが増えたので参照 UI を用意。
- [ ] **About ダイアログ** — バージョン・ライセンス・リポジトリリンクの表示。
- [ ] **アクセシビリティ** — `aria-*` / `role` が 0 箇所。フォーカス順序・スクリーンリーダー対応。
- [ ] **通知 / エラー表示の改善** — 現状 `setError`/`setInfo` の簡易表示。トースト・履歴・詳細化。
- [ ] **(任意)国際化(i18n）** — UI 文言が日本語ハードコード。海外公開するなら多言語対応。

---

## P3 — ドキュメント・配布

- [ ] **HTFL 言語仕様書** — タグ規則・`config.yaml` スキーマ・変数・リンク・予約名・命名規則の正式仕様。
- [ ] **README 拡充** — スクリーンショット、機能一覧、ビルド/リリース手順、ライセンス節を追加。
- [ ] **プラグイン開発ドキュメント** — exporter / snippet / class-dict の API、`doc` の型定義、
      サンプル(`sample-project/plugins/starter/`)の解説。
- [ ] **CHANGELOG.md** — バージョンごとの変更履歴。
- [ ] **(OSS 公開する場合)CONTRIBUTING / Issue・PR テンプレート / 行動規範**。

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
