# アプリアイコンの再生成

`src-tauri/icons/` 配下の PNG / ICO / ICNS はすべて生成物です。ロゴを変えるときは
このフォルダの SVG を編集して、下記の **2 パス** を実行してください。

```sh
# 1. 全プラットフォーム分を生成
npx tauri icon src-tauri/icons/source/foling.svg

# 2. macOS 用だけ内寄せ版で上書き
npx tauri icon src-tauri/icons/source/foling-macos.svg -o /tmp/foling-icns
cp /tmp/foling-icns/icon.icns src-tauri/icons/icon.icns
```

## なぜ 2 回に分けるのか

**macOS はアプリアイコンを全面に描きません。** Big Sur 以降のアイコングリッドは
1024×1024 のキャンバスに対して本体を **824×824**（各辺 100pt の余白）に収める規約で、
Dock の影やホバー拡大のための領域です。

`tauri icon` は入力画像をそのまま各サイズへ縮小するだけで、この余白を足しません。
そのため全面（フルブリード）のソースから作った `.icns` は、Dock で隣に並ぶネイティブ
アプリより **約 24% 大きく** 見えます。v0.11.0 まではまさにその状態でした。

Windows / Linux にこの規約はなく、全面のままが正しいので、ソースを分けています。

| ファイル | 用途 | 本体サイズ |
|---|---|---|
| `foling.svg` | Windows / Linux / iOS / Android / Store | キャンバス全面 |
| `foling-macos.svg` | `icon.icns` のみ | 824/1024 = 80.5% |

## 元データについて

作画時の原本は A4 キャンバス（2481×3508）で、マーク本体は
`(487.433, 805.119)` を左上とする 1352.701 単位の正方形に収まっています。
`foling.svg` の `viewBox` はこの正方形をそのまま切り出したもので、
`foling-macos.svg` は同じ図形を `transform` で 80.5% に内寄せしています。
