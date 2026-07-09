// data/prices.json を読み込んで価格比較テーブルを描画する
let DATA = null;

async function init() {
  const res = await fetch('data/prices.json');
  DATA = await res.json();

  document.getElementById('sampleBanner').hidden = !DATA.sampleData;

  const updated = new Date(DATA.generatedAt);
  document.getElementById('updatedAt').textContent =
    `最終更新: ${updated.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;

  buildFilters();
  buildShopList();
  render();

  for (const id of ['search', 'setFilter', 'rarityFilter', 'sortBy']) {
    document.getElementById(id).addEventListener('input', render);
  }
}

function buildFilters() {
  fillSelect('setFilter', unique(DATA.cards.map((c) => c.set)));
  fillSelect('rarityFilter', unique(DATA.cards.map((c) => c.rarity)));
}

function fillSelect(id, values) {
  const select = document.getElementById(id);
  for (const value of values) {
    const opt = document.createElement('option');
    opt.value = opt.textContent = value;
    select.appendChild(opt);
  }
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function buildShopList() {
  document.getElementById('shopList').innerHTML = DATA.shops
    .map(
      (s) =>
        `<li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a></li>`
    )
    .join('');
}

function bestBuy(card) {
  const buys = Object.values(card.prices).map((p) => p.buy).filter((v) => v != null);
  return buys.length ? Math.max(...buys) : null;
}

function bestSell(card) {
  const sells = Object.values(card.prices).map((p) => p.sell).filter((v) => v != null);
  return sells.length ? Math.min(...sells) : null; // 買う側にとって最安の販売価格
}

function spread(card) {
  const buy = bestBuy(card);
  const sell = bestSell(card);
  return buy != null && sell != null ? sell - buy : null;
}

function render() {
  const query = document.getElementById('search').value.trim().toLowerCase();
  const set = document.getElementById('setFilter').value;
  const rarity = document.getElementById('rarityFilter').value;
  const sortBy = document.getElementById('sortBy').value;

  let cards = DATA.cards.filter((c) => {
    if (set && c.set !== set) return false;
    if (rarity && c.rarity !== rarity) return false;
    if (query) {
      const haystack = `${c.name ?? ''} ${c.nameEn ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const sorters = {
    'buy-desc': (a, b) => (bestBuy(b) ?? -1) - (bestBuy(a) ?? -1),
    'buy-asc': (a, b) => (bestBuy(a) ?? Infinity) - (bestBuy(b) ?? Infinity),
    'spread-desc': (a, b) => (spread(b) ?? -Infinity) - (spread(a) ?? -Infinity),
    name: (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ja'),
  };
  cards.sort(sorters[sortBy]);

  document.getElementById('count').textContent = `${cards.length} 枚`;

  document.getElementById('tableHead').innerHTML = `
    <tr>
      <th>カード</th>
      <th>収録弾</th>
      <th>レアリティ</th>
      ${DATA.shops.map((s) => `<th class="num">${esc(s.name)}<br><small>買取</small></th>`).join('')}
      <th class="num">最安販売</th>
      <th class="num">差額</th>
    </tr>`;

  const tbody = document.getElementById('tableBody');
  if (cards.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${DATA.shops.length + 5}" class="empty">該当するカードがありません</td></tr>`;
    return;
  }

  tbody.innerHTML = cards
    .map((card) => {
      const top = bestBuy(card);
      const shopCells = DATA.shops
        .map((s) => {
          const buy = card.prices[s.id]?.buy;
          if (buy == null) return '<td class="num muted">—</td>';
          const isBest = buy === top;
          return `<td class="num ${isBest ? 'best' : ''}">${isBest ? '🏆 ' : ''}${yen(buy)}</td>`;
        })
        .join('');
      const sell = bestSell(card);
      const diff = spread(card);
      return `
        <tr>
          <td>
            <div class="card-name">${esc(card.name ?? '')}</div>
            <div class="card-sub">${esc(card.nameEn ?? '')}${card.number ? ` ・ ${esc(card.number)}` : ''}</div>
          </td>
          <td>${esc(card.set ?? '—')}</td>
          <td><span class="rarity rarity-${rarityClass(card.rarity)}">${esc(card.rarity ?? '—')}</span></td>
          ${shopCells}
          <td class="num">${sell != null ? yen(sell) : '—'}</td>
          <td class="num muted">${diff != null ? yen(diff) : '—'}</td>
        </tr>`;
    })
    .join('');
}

function yen(value) {
  return '¥' + value.toLocaleString('ja-JP');
}

function rarityClass(rarity) {
  if (!rarity) return 'none';
  if (rarity.includes('エンチャン')) return 'enchanted';
  if (rarity.includes('レジェンダリー')) return 'legendary';
  return 'other';
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

document.addEventListener('DOMContentLoaded', init);
