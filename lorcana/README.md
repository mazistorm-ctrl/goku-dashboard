# Lorcana Price Tracker

ディズニー・ロルカナの各店舗の**買取価格・販売価格**を定期的に収集し、カードごとに横断比較できる静的サイトです（[ink-research.net](https://ink-research.net) のようなサイトの構成例）。

## 仕組み

```
┌─────────────────┐   毎日6:00 JST    ┌──────────────────┐
│ GitHub Actions   │ ───────────────▶ │ scraper/scrape.mjs │
│ (cron)           │                  │  店舗別アダプタで取得  │
└─────────────────┘                  └────────┬─────────┘
                                              │ 正規化・突き合わせ
                                              ▼
                                     data/prices.json ──▶ index.html
                                     （コミットして更新）    （GitHub Pages等で公開）
```

- **サーバー不要**：スクレイピングは GitHub Actions 上で動き、結果を `data/prices.json` にコミットするだけ。サイト本体は静的ファイルなので GitHub Pages / Netlify / Cloudflare Pages で無料公開できます。
- **店舗の追加が簡単**：`scraper/shops/` に1ファイル追加して `scrape.mjs` に登録するだけ。

## 使い方

```bash
cd lorcana
npm install

# スクレイピング実行（data/prices.json を更新）
npm run scrape

# 特定店舗のみ
node scraper/scrape.mjs mercard

# ローカルでサイト確認
npm run serve   # → http://localhost:3000
```

## ファイル構成

| パス | 役割 |
|---|---|
| `index.html` / `app.js` / `style.css` | フロントエンド（検索・フィルタ・店舗横断の価格比較テーブル） |
| `data/prices.json` | 価格データ。**初期状態はサンプルデータ**（`sampleData: true`） |
| `scraper/scrape.mjs` | オーケストレータ。全店舗を順に実行し、カードを突き合わせて出力 |
| `scraper/shops/*.mjs` | 店舗別アダプタ（秋葉原メルカード / Clove / 古本市場） |
| `scraper/lib.mjs` | 共通処理（丁寧なフェッチ、円額パース、カードキー正規化） |
| `../.github/workflows/lorcana-scrape.yml` | 毎日自動実行するワークフロー |

## ⚠️ 実運用前の注意

1. **セレクタの調整が必要**：各店舗アダプタのHTMLセレクタは雛形です。多くのカードショップサイトはbot対策（Cloudflare等）をしているため、初回実行時に実際のHTMLを確認して調整してください。SPA構成の店舗（Clove等）はHTMLではなく内部のJSON APIを叩く方が安定します。それでも取得できない場合は Playwright（ヘッドレスブラウザ）への切り替えを検討してください。
2. **マナーと規約**：
   - 各店舗の利用規約・`robots.txt` を確認すること
   - アクセス間隔を空ける（本実装は店舗間5秒待機・1日1回）
   - User-Agent に連絡先を明示（`scraper/lib.mjs`）
   - 取得した価格を再掲載する場合は出典（店舗名・リンク）を明記
3. **カードの突き合わせ精度**：店舗ごとにカード名表記が揺れるため、カード番号（例 `207/204`）ベースの照合が最も確実です。番号を取得できない店舗は名前の正規化で照合しており、誤マッチの可能性があります。

## 今後の拡張アイデア

- 価格履歴の保存とグラフ表示（`data/history/` に日次スナップショット）
- 価格変動の通知（前日比±10%でDiscord/LINE通知）
- メルカリ・ヤフオク相場の追加（公式APIの利用を推奨）
- 英語版カード・海外ショップ対応
