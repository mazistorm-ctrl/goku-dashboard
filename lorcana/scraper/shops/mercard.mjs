import * as cheerio from 'cheerio';
import { fetchHtml, parseYen } from '../lib.mjs';

// 秋葉原メルカード：ロルカナ買取価格表
// 注意：セレクタは初回の実走時にページの実HTMLを見て調整すること。
// 多くのWordPress系買取表は table でカード名/買取価格を並べている。
export default {
  id: 'mercard',
  name: '秋葉原メルカード',
  url: 'https://akihabara-cardshop.com/lorcana-kaitori/',

  async scrape() {
    const html = await fetchHtml(this.url);
    const $ = cheerio.load(html);
    const cards = [];

    $('table tr').each((_, tr) => {
      const cells = $(tr)
        .find('td')
        .map((_, td) => $(td).text().trim())
        .get();
      if (cells.length < 2) return;

      const buy = parseYen(cells[cells.length - 1]);
      if (!buy) return;

      // 「カード名【レアリティ】(セット)」のような表記を分解
      const raw = cells[0];
      const rarity = raw.match(/【(.+?)】/)?.[1] ?? raw.match(/[（(](エンチャンテッド|レジェンダリー|スーパーレア)[）)]/)?.[1] ?? null;
      const name = raw.replace(/【.+?】/g, '').replace(/[（(].+?[）)]/g, '').trim();

      cards.push({ name, rarity, set: null, number: null, buy, sell: null });
    });

    return cards;
  },
};
