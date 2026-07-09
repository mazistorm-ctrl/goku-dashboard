import * as cheerio from 'cheerio';
import { fetchHtml, parseYen } from '../lib.mjs';

// 古本市場（ふるいち）：ロルカナ高価買取情報
// 注意：セレクタは初回の実走時に実HTMLを確認して調整すること。
export default {
  id: 'furu1',
  name: '古本市場',
  url: 'https://www.furu1.net/kaitori/sell_toreca/lorcana',

  async scrape() {
    const html = await fetchHtml(this.url);
    const $ = cheerio.load(html);
    const cards = [];

    $('table tr, li, [class*="item"]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      // 「カード名 ¥10,000」のような並びを想定
      const m = text.match(/^(.+?)\s*[¥￥]([\d,]+)\s*$/);
      if (!m) return;
      const name = m[1].trim();
      const buy = parseYen(m[2]);
      if (name.length < 2 || name.length > 60 || !buy) return;
      cards.push({ name, rarity: null, set: null, number: null, buy, sell: null });
    });

    return cards;
  },
};
