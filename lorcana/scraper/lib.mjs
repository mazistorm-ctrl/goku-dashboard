// 共通ユーティリティ：丁寧なフェッチ（UA明示・リトライ・待機）と正規化
const USER_AGENT =
  'LorcanaPriceBot/0.1 (+https://github.com/mazistorm-ctrl/goku-dashboard; 個人利用の価格調査)';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTMLを取得する。相手サーバーに負荷をかけないよう、
 * 呼び出し側でページ間に必ず delay を挟むこと。
 */
export async function fetchHtml(url, { retries = 2, timeoutMs = 30000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'ja,en;q=0.8',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(2000 * (attempt + 1));
    }
  }
  throw lastError;
}

/** 「¥12,000」「12000円」などの表記から整数の円額を取り出す */
export function parseYen(text) {
  if (text == null) return null;
  const m = String(text).replace(/[,，¥￥\s円]/g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** カードを店舗横断で突き合わせるためのキーを作る */
export function cardKey({ set, number, name, rarity }) {
  const base = number
    ? `${set ?? ''}-${number}`
    : `${set ?? ''}-${name ?? ''}-${rarity ?? ''}`;
  return base
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[〜~\s・]/g, '')
    .replace(/[^a-z0-9぀-ヿ一-鿿/-]/g, '');
}
