import * as cheerio from 'cheerio';
import { fetchHtml, parseYen } from '../lib.mjs';

// Clove Base：ロルカナ店舗買取ページ
// 注意：CloveはSPA構成の可能性が高い。HTMLに価格が無い場合は
// ブラウザのDevTools > Network でJSON APIのURLを特定し、
// fetchHtml の代わりにそのAPIを叩く実装へ切り替えること。
export default {
  id: 'clove',
  name: 'Clove Base',
  url: 'https://store.clove.jp/jp/buying/lorcana',

  async scrape() {
    const html = await fetchHtml(this.url);
    const $ = cheerio.load(html);
    const cards = [];

    // まず __NEXT_DATA__（Next.js）にデータが埋まっているか確認
    const nextData = $('script#__NEXT_DATA__').html();
    if (nextData) {
      try {
        const json = JSON.parse(nextData);
        const items = findBuyingItems(json);
        for (const item of items) {
          cards.push({
            name: item.name ?? item.title ?? null,
            rarity: item.rarity ?? null,
            set: item.expansion ?? item.set ?? null,
            number: item.number ?? item.cardNumber ?? null,
            buy: parseYen(item.buyPrice ?? item.price),
            sell: parseYen(item.sellPrice) ?? null,
          });
        }
        if (cards.length > 0) return cards.filter((c) => c.name && c.buy);
      } catch {
        // JSON構造が想定と違う場合はDOMパースにフォールバック
      }
    }

    $('[class*="item"], [class*="card"], table tr').each((_, el) => {
      const text = $(el).text();
      const buy = parseYen(text.match(/買取[：:\s]*([¥￥]?[\d,]+)/)?.[1]);
      const name = $(el).find('[class*="name"], td:first-child').first().text().trim();
      if (name && buy) {
        cards.push({ name, rarity: null, set: null, number: null, buy, sell: null });
      }
    });

    return cards;
  },
};

// __NEXT_DATA__ 内を再帰的に探索して買取アイテム配列らしきものを探す
function findBuyingItems(node, depth = 0) {
  if (depth > 8 || node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) {
    if (node.length > 3 && node.every((x) => x && typeof x === 'object' && ('buyPrice' in x || 'price' in x))) {
      return node;
    }
    return node.flatMap((x) => findBuyingItems(x, depth + 1));
  }
  return Object.values(node).flatMap((x) => findBuyingItems(x, depth + 1));
}
