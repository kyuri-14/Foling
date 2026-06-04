# Changelog

このファイルは Foling Editor の主な変更点を記録します。
形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added
- 設定モーダル(CSS リセット既定 / プレビューブラウザ / プラグイン実行許可のリセット)。
- プロジェクト内検索(タグ名 / id / class / 本文 / CSS、Ctrl+Shift+F)。
- HELP メニュー: キーボードショートカット一覧、About ダイアログ。
- やり直し(Redo: Ctrl+Y / Ctrl+Shift+Z)。
- 終了時の保存(未保存の編集をフラッシュしてから閉じる)。
- ウィンドウのサイズ・位置・最大化状態の保存(`tauri-plugin-window-state`)。
- トップレベルのエラーバウンダリ(クラッシュ時に復帰画面を表示)。
- プラグイン実行前の同意ダイアログ。
- ドキュメント: HTFL 言語仕様(`docs/HTFL-SPEC.md`)、プラグイン開発ガイド(`docs/PLUGINS.md`)、本 CHANGELOG、CONTRIBUTING。
- 公開準備チェックリスト `RELEASE_TODO.md`、`LICENSE`(GPL-3.0)、`.gitattributes`。

### Changed
- 通知トースト: info は数秒で自動消去、error はクリックで消去。`aria-live` 対応。
- フォルダ命名を「兄弟内の連番(`NN_tag`)」に統一し、編集時の不要なリネームを抑制。
- バンドル識別子を ASCII 化(`com.foling.editor`)。
- 本番向け Content-Security-Policy を設定。

### Fixed
- 新規タグ作成時のアクセス拒否(OS error 5)とリネーム連鎖。
- 新規タグ・貼り付け要素が選択できない問題、貼り付け時に過去要素が混入する問題。
- 自動保存のパス競合(選択切替直後に別要素へ設定を書き込むおそれ)。
- ツリー入力でのコピー&ペーストと CSS などの文字コピーの競合。
- 空行・インデント 0 での Backspace 挙動。
- Rust 側の到達可能な `unwrap()` を堅牢化。

## [0.1.0] - 2026

- 初期バージョン。HTFL ツリー編集、CSS/CONTENT 編集、HTML インポート/エクスポート、
  dev モード(クリック→編集)、プラグイン基盤、CSS リセット。
