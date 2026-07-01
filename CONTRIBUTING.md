# コントリビューションガイド

Foling への貢献をありがとうございます。
参加にあたっては [行動規範](CODE_OF_CONDUCT.md) の遵守をお願いします。
セキュリティ上の問題は公開 Issue ではなく [SECURITY.md](SECURITY.md) の手順で報告してください。

## 開発環境

- Node.js **24.18.0 以上を推奨**（リポジトリの `.node-version` で指定）。
  ※ Node 24.12.0 (Windows) はネイティブ再帰削除のバグで `vite build` が落ちるため回避推奨。
  ビルドは `scripts/clean-dist.mjs` で回避策を入れていますが、更新版の Node を推奨します。
- Rust (stable)
- Tauri 2 の前提条件(Windows: Microsoft Edge WebView2 Runtime)

```bash
npm install
npm run tauri dev      # 開発実行
```

## ビルド検証

PR を出す前に、以下がすべて通ることを確認してください。

```bash
npx tsc --noEmit                 # フロントエンドの型チェック
npm run build                    # tsc + vite ビルド
cd src-tauri && cargo check      # Rust のコンパイルチェック
```

## コーディング方針

- フロントエンド: React + TypeScript。UI 文言は日本語。
- バックエンド: Rust + Tauri 2。ファイル操作は `fs_lock` で直列化し、Windows の
  一時的なロック(error 5 / 32)は `retry_io` でリトライする方針です。
- ユーザー入力・壊れた YAML・権限エラーで **panic させない**(`Result` で扱う)。
- 破壊的な FS 操作(リネーム・削除)は既存ノードの `NN_` プレフィックスを尊重し、
  不要な一括リネームを避けてください(Windows でのアクセス拒否の原因になります)。

## コミット / PR

- コミットは論理単位で。メッセージは変更内容が分かるように。
- 関連する仕様変更がある場合は `docs/` と `CHANGELOG.md`(Unreleased)も更新してください。

## バグ報告

再現手順・OS・期待した挙動・実際の挙動を添えてください。
アクセス拒否やプレビュー周りは、画面下部のエラーメッセージや DevTools の
コンソール出力(CSP 違反など)も貼っていただけると原因特定が早まります。

## ライセンス

貢献いただいたコードは本プロジェクトと同じ **AGPL-3.0-or-later** で配布されます（inbound = outbound）。
