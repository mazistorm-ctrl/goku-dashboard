#!/usr/bin/env node
// ロルカナ価格スクレイパー：各店舗アダプタを順番に実行し、
// カードを突き合わせて data/prices.json に出力する。
//
// 使い方:
//   node scraper/scrape.mjs           … 全店舗をスクレイピング
//   node scraper/scrape.mjs mercard   … 指定店舗のみ
//
// 失敗した店舗はスキップし、前回データ（prices.json）の価格を維持する。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sleep, cardKey } from './lib.mjs';
import mercard from './shops/mercard.mjs';
import clove from './shops/clove.mjs';
import furu1 from './shops/furu1.mjs';

const SHOPS = [mercard, clove, furu1];
const DELAY_BETWEEN_SHOPS_MS = 5000; // 連続アクセスを避ける

const dataPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'prices.json'
);

async function main() {
  const only = process.argv[2];
  const shops = only ? SHOPS.filter((s) => s.id === only) : SHOPS;
  if (shops.length === 0) {
    console.error(`不明な店舗ID: ${only}（利用可能: ${SHOPS.map((s) => s.id).join(', ')}）`);
    process.exit(1);
  }

  // 前回データを読み込み（初回やサンプルデータでも動く）
  let previous = { cards: [] };
  try {
    previous = JSON.parse(await readFile(dataPath, 'utf8'));
  } catch {
    /* 初回実行 */
  }

  const cardMap = new Map();
  // サンプルデータでなければ前回の実データを引き継ぐ
  if (!previous.sampleData) {
    for (const card of previous.cards ?? []) cardMap.set(card.key, card);
  }

  const succeeded = [];
  for (const shop of shops) {
    try {
      console.log(`[${shop.id}] ${shop.url} を取得中…`);
      const items = await shop.scrape();
      console.log(`[${shop.id}] ${items.length} 件取得`);
      if (items.length === 0) throw new Error('0件（セレクタ要確認）');

      for (const item of items) {
        const key = cardKey(item);
        const card = cardMap.get(key) ?? {
          key,
          name: item.name,
          nameEn: item.nameEn ?? null,
          set: item.set ?? null,
          number: item.number ?? null,
          rarity: item.rarity ?? null,
          prices: {},
        };
        // 情報が欠けているフィールドは新データで補完
        card.set ??= item.set ?? null;
        card.number ??= item.number ?? null;
        card.rarity ??= item.rarity ?? null;
        card.prices[shop.id] = { buy: item.buy ?? null, sell: item.sell ?? null };
        cardMap.set(key, card);
      }
      succeeded.push(shop);
    } catch (err) {
      console.error(`[${shop.id}] 失敗（スキップ）: ${err.message}`);
    }
    if (shop !== shops[shops.length - 1]) await sleep(DELAY_BETWEEN_SHOPS_MS);
  }

  if (succeeded.length === 0) {
    console.error('全店舗の取得に失敗したため、prices.json は更新しません。');
    process.exit(1);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sampleData: false,
    shops: SHOPS.map(({ id, name, url }) => ({ id, name, url })),
    cards: [...cardMap.values()].sort(
      (a, b) => maxBuy(b) - maxBuy(a)
    ),
  };

  await writeFile(dataPath, JSON.stringify(output, null, 2) + '\n');
  console.log(
    `完了: ${output.cards.length} 枚 / 成功店舗: ${succeeded.map((s) => s.id).join(', ')}`
  );
}

function maxBuy(card) {
  return Math.max(0, ...Object.values(card.prices).map((p) => p.buy ?? 0));
}

main();
