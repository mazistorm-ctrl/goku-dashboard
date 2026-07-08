// ===== データ管理 =====
const STORAGE_KEY = 'warikan-data';
const EMOJIS = ['🍺','🍕','🍣','🎸','⚽','🎮','🐶','🐱','🦁','🐸','🍜','🍔','🎤','🏀','🚗','⛺'];

function loadStore() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : { events: [], currentEventId: null };
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

let store = loadStore();
let splitMode = 'even';      // 'even' | 'ratio' | 'exact'
let editingExpenseId = null;
// 入力途中の割り方（memberId -> {on, weight, exact}）
let draft = {};

function currentEvent() {
  return store.events.find(e => e.id === store.currentEventId) || null;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function yen(n) {
  return '¥' + n.toLocaleString();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== イベント =====
// document.createEvent と衝突するので createEvent という名前は使わない
function newEvent() {
  const name = prompt('イベント名は？（例：3/15 飲み会）');
  if (!name) return;
  const ev = { id: uid(), name: name.trim(), roundUnit: 1, members: [], expenses: [] };
  store.events.push(ev);
  store.currentEventId = ev.id;
  saveStore();
  renderAll();
}

function renameEvent() {
  const ev = currentEvent();
  if (!ev) return;
  const name = prompt('新しいイベント名は？', ev.name);
  if (!name) return;
  ev.name = name.trim();
  saveStore();
  renderAll();
}

function deleteEvent() {
  const ev = currentEvent();
  if (!ev) return;
  if (!confirm(`「${ev.name}」を削除する？記録も全部消えるよ`)) return;
  store.events = store.events.filter(e => e.id !== ev.id);
  store.currentEventId = store.events.length ? store.events[0].id : null;
  saveStore();
  renderAll();
}

function switchEvent(id) {
  store.currentEventId = id;
  saveStore();
  editingExpenseId = null;
  draft = {};
  renderAll();
}

// ===== メンバー =====
function addMember() {
  const ev = currentEvent();
  if (!ev) return;
  const input = document.getElementById('memberName');
  const name = input.value.trim();
  if (!name) return;
  if (ev.members.some(m => m.name === name)) {
    alert('同じ名前のメンバーがいるよ');
    return;
  }
  ev.members.push({ id: uid(), name, emoji: EMOJIS[ev.members.length % EMOJIS.length] });
  input.value = '';
  saveStore();
  renderAll();
}

function removeMember(id) {
  const ev = currentEvent();
  const used = ev.expenses.some(x => x.payerId === id || x.shares.some(s => s.memberId === id));
  if (used) {
    alert('支払い記録で使われてるメンバーは消せないよ。先に記録を直してね');
    return;
  }
  if (!confirm('このメンバーを削除する？')) return;
  ev.members = ev.members.filter(m => m.id !== id);
  delete draft[id];
  saveStore();
  renderAll();
}

function cycleEmoji(id) {
  const ev = currentEvent();
  const m = ev.members.find(m => m.id === id);
  m.emoji = EMOJIS[(EMOJIS.indexOf(m.emoji) + 1) % EMOJIS.length];
  saveStore();
  renderMembers();
  renderExpenses();
  renderSettlement();
}

function memberById(id) {
  const ev = currentEvent();
  return ev ? ev.members.find(m => m.id === id) : null;
}

function label(id) {
  const m = memberById(id);
  return m ? `${m.emoji} ${m.name}` : '？';
}

// ===== 割り方の計算 =====
// weights: [{id, w}] を金額に応じて整数円に配分（端数は小数部が大きい順に+1円）
function computeShares(amount, weights) {
  const total = weights.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return null;
  const rows = weights.map(x => {
    const raw = amount * x.w / total;
    return { id: x.id, val: Math.floor(raw), frac: raw - Math.floor(raw) };
  });
  let rem = amount - rows.reduce((s, x) => s + x.val, 0);
  const order = [...rows].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < rem; i++) order[i % order.length].val++;
  return rows.map(r => ({ memberId: r.id, amount: r.val }));
}

function setSplitMode(mode) {
  splitMode = mode;
  document.querySelectorAll('.split-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + mode).classList.add('active');
  renderParticipants();
}

function ensureDraft(id) {
  if (!draft[id]) draft[id] = { on: true, weight: 1, exact: '' };
  return draft[id];
}

function toggleParticipant(id) {
  ensureDraft(id).on = !draft[id].on;
  renderParticipants();
}

function stepWeight(id, delta) {
  const d = ensureDraft(id);
  d.weight = Math.max(0.5, Math.round((d.weight + delta) * 2) / 2);
  renderParticipants();
}

function setExact(id, value) {
  ensureDraft(id).exact = value;
  updateSplitStatus();
}

// ===== 支払い =====
function saveExpense() {
  const ev = currentEvent();
  if (!ev) return;
  const title = document.getElementById('expTitle').value.trim();
  const amount = parseInt(document.getElementById('expAmount').value, 10);
  const payerId = document.getElementById('expPayer').value;

  if (!title || !amount || amount <= 0 || !payerId) {
    alert('内容・金額・払った人は必須だよ');
    return;
  }

  const on = ev.members.filter(m => ensureDraft(m.id).on);
  if (on.length === 0) {
    alert('対象メンバーを1人以上選んでね');
    return;
  }

  let shares;
  if (splitMode === 'exact') {
    shares = on.map(m => ({ memberId: m.id, amount: parseInt(draft[m.id].exact, 10) || 0 }));
    const sum = shares.reduce((s, x) => s + x.amount, 0);
    if (sum !== amount) {
      alert(`金額指定の合計（${yen(sum)}）が支払額（${yen(amount)}）と合わないよ`);
      return;
    }
  } else {
    const weights = on.map(m => ({ id: m.id, w: splitMode === 'ratio' ? draft[m.id].weight : 1 }));
    shares = computeShares(amount, weights);
  }

  const exp = {
    id: editingExpenseId || uid(),
    title, amount, payerId,
    mode: splitMode,
    weights: splitMode === 'ratio' ? on.map(m => ({ memberId: m.id, w: draft[m.id].weight })) : null,
    shares,
    createdAt: editingExpenseId
      ? ev.expenses.find(x => x.id === editingExpenseId).createdAt
      : Date.now()
  };

  if (editingExpenseId) {
    const i = ev.expenses.findIndex(x => x.id === editingExpenseId);
    ev.expenses[i] = exp;
  } else {
    ev.expenses.push(exp);
  }

  saveStore();
  cancelEdit();
  renderAll();
  toast('記録したよ！');
}

function editExpense(id) {
  const ev = currentEvent();
  const exp = ev.expenses.find(x => x.id === id);
  if (!exp) return;
  editingExpenseId = id;
  document.getElementById('expTitle').value = exp.title;
  document.getElementById('expAmount').value = exp.amount;
  document.getElementById('expPayer').value = exp.payerId;
  document.getElementById('expenseFormTitle').textContent = '✏️ 支払いを編集中';
  document.getElementById('expSaveBtn').textContent = '💾 更新する';
  document.getElementById('expCancelBtn').style.display = '';

  draft = {};
  ev.members.forEach(m => {
    const share = exp.shares.find(s => s.memberId === m.id);
    const w = exp.weights ? exp.weights.find(x => x.memberId === m.id) : null;
    draft[m.id] = {
      on: !!share,
      weight: w ? w.w : 1,
      exact: share ? String(share.amount) : ''
    };
  });
  setSplitMode(exp.mode);
  document.getElementById('expTitle').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingExpenseId = null;
  draft = {};
  document.getElementById('expTitle').value = '';
  document.getElementById('expAmount').value = '';
  document.getElementById('expenseFormTitle').textContent = '📝 支払いを記録';
  document.getElementById('expSaveBtn').textContent = '💾 記録する';
  document.getElementById('expCancelBtn').style.display = 'none';
  setSplitMode('even');
}

function deleteExpense(id) {
  if (!confirm('この支払いを削除する？')) return;
  const ev = currentEvent();
  ev.expenses = ev.expenses.filter(x => x.id !== id);
  if (editingExpenseId === id) cancelEdit();
  saveStore();
  renderAll();
}

// ===== 精算計算 =====
// 各自の収支（払った額 - 負担額）
function computeBalances(ev) {
  const bal = {};
  ev.members.forEach(m => bal[m.id] = { paid: 0, owed: 0 });
  ev.expenses.forEach(x => {
    if (bal[x.payerId]) bal[x.payerId].paid += x.amount;
    x.shares.forEach(s => {
      if (bal[s.memberId]) bal[s.memberId].owed += s.amount;
    });
  });
  return bal;
}

// 最小回数になるように貪欲法で送金を組む（unit円単位に丸め）
function computeSettlements(ev) {
  const unit = ev.roundUnit || 1;
  const bal = computeBalances(ev);
  const arr = ev.members.map(m => ({
    id: m.id,
    u: Math.round((bal[m.id].paid - bal[m.id].owed) / unit)
  }));
  // 丸め誤差で合計がずれたら、絶対値が最大の人に寄せて合計0にする
  const sum = arr.reduce((s, x) => s + x.u, 0);
  if (sum !== 0 && arr.length) {
    arr.reduce((a, b) => Math.abs(a.u) >= Math.abs(b.u) ? a : b).u -= sum;
  }

  const debtors = arr.filter(x => x.u < 0).map(x => ({ ...x, u: -x.u }));
  const creditors = arr.filter(x => x.u > 0).map(x => ({ ...x }));
  const transfers = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.u - a.u);
    creditors.sort((a, b) => b.u - a.u);
    const d = debtors[0], c = creditors[0];
    const amt = Math.min(d.u, c.u);
    transfers.push({ from: d.id, to: c.id, amount: amt * unit });
    d.u -= amt; c.u -= amt;
    if (d.u === 0) debtors.shift();
    if (c.u === 0) creditors.shift();
  }
  return transfers;
}

function setRoundUnit(value) {
  const ev = currentEvent();
  if (!ev) return;
  ev.roundUnit = parseInt(value, 10);
  saveStore();
  renderSettlement();
}

// ===== 共有 =====
function encodeEvent(ev) {
  const json = JSON.stringify(ev);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeEvent(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function copyShareUrl() {
  const ev = currentEvent();
  if (!ev) return;
  const url = location.origin + location.pathname + '#d=' + encodeEvent(ev);
  copyText(url, '共有URLをコピーしたよ！LINEで送ろう');
}

function importFromHash() {
  if (!location.hash.startsWith('#d=')) return;
  try {
    const ev = decodeEvent(location.hash.slice(3));
    if (!ev.id || !Array.isArray(ev.members)) throw new Error('bad data');
    const exists = store.events.findIndex(e => e.id === ev.id);
    if (exists >= 0) {
      if (confirm(`「${ev.name}」は既にあるよ。共有された内容で上書きする？`)) {
        store.events[exists] = ev;
      }
    } else {
      store.events.push(ev);
    }
    store.currentEventId = ev.id;
    saveStore();
    toast(`「${ev.name}」を読み込んだよ！`);
  } catch (e) {
    alert('共有URLの読み込みに失敗したよ');
  }
  history.replaceState(null, '', location.pathname);
}

// ===== LINE用テキスト =====
function settlementText(ev) {
  const total = ev.expenses.reduce((s, x) => s + x.amount, 0);
  const transfers = computeSettlements(ev);
  const lines = [
    `🍻 ${ev.name} の精算`,
    `合計 ${yen(total)}（${ev.members.length}人）`,
    ''
  ];
  if (transfers.length === 0) {
    lines.push('精算なし！みんなピッタリ✨');
  } else {
    transfers.forEach(t => {
      const from = memberById(t.from), to = memberById(t.to);
      lines.push(`${from.name} → ${to.name}  ${yen(t.amount)}`);
    });
  }
  const unit = ev.roundUnit || 1;
  if (unit > 1) lines.push('', `※${unit}円単位でざっくり精算`);
  return lines.join('\n');
}

function copySettlementText() {
  const ev = currentEvent();
  if (!ev) return;
  copyText(settlementText(ev), '精算テキストをコピーしたよ！');
}

function copyText(text, message) {
  navigator.clipboard.writeText(text).then(
    () => toast(message),
    () => {
      // クリップボードが使えない環境向け
      prompt('コピーできなかったから手動でどうぞ', text);
    }
  );
}

// ===== 描画 =====
function renderAll() {
  renderEventSelect();
  renderMembers();
  renderPayerSelect();
  renderParticipants();
  renderExpenses();
  renderSettlement();
}

function renderEventSelect() {
  const sel = document.getElementById('eventSelect');
  sel.innerHTML = store.events.map(e =>
    `<option value="${e.id}" ${e.id === store.currentEventId ? 'selected' : ''}>${esc(e.name)}</option>`
  ).join('');
  const hasEvent = !!currentEvent();
  document.getElementById('appBody').style.display = hasEvent ? '' : 'none';
  document.getElementById('emptyState').style.display = hasEvent ? 'none' : '';
  if (hasEvent) {
    document.getElementById('roundUnit').value = currentEvent().roundUnit || 1;
  }
}

function renderMembers() {
  const ev = currentEvent();
  if (!ev) return;
  const box = document.getElementById('memberChips');
  if (ev.members.length === 0) {
    box.innerHTML = '<p class="hint">まずメンバーを追加しよう</p>';
    return;
  }
  box.innerHTML = ev.members.map(m => `
    <span class="chip">
      <button class="chip-emoji" onclick="cycleEmoji('${m.id}')">${m.emoji}</button>
      ${esc(m.name)}
      <button class="chip-del" onclick="removeMember('${m.id}')">×</button>
    </span>
  `).join('');
}

function renderPayerSelect() {
  const ev = currentEvent();
  if (!ev) return;
  const sel = document.getElementById('expPayer');
  const prev = sel.value;
  sel.innerHTML = ev.members.map(m =>
    `<option value="${m.id}">${m.emoji} ${esc(m.name)}</option>`
  ).join('');
  if (ev.members.some(m => m.id === prev)) sel.value = prev;
}

function renderParticipants() {
  const ev = currentEvent();
  if (!ev) return;
  const box = document.getElementById('participantList');
  box.innerHTML = ev.members.map(m => {
    const d = ensureDraft(m.id);
    let control = '';
    if (d.on && splitMode === 'ratio') {
      control = `
        <span class="weight-control">
          <button onclick="stepWeight('${m.id}', -0.5)">−</button>
          <b>×${d.weight}</b>
          <button onclick="stepWeight('${m.id}', 0.5)">＋</button>
        </span>`;
    } else if (d.on && splitMode === 'exact') {
      control = `<input type="number" class="exact-input" inputmode="numeric" placeholder="円"
                   value="${esc(d.exact)}" oninput="setExact('${m.id}', this.value)">`;
    }
    return `
      <div class="participant-row ${d.on ? '' : 'off'}">
        <label>
          <input type="checkbox" ${d.on ? 'checked' : ''} onchange="toggleParticipant('${m.id}')">
          ${m.emoji} ${esc(m.name)}
        </label>
        ${control}
      </div>`;
  }).join('');
  updateSplitStatus();
}

function updateSplitStatus() {
  const ev = currentEvent();
  const el = document.getElementById('splitStatus');
  if (!ev) { el.textContent = ''; return; }
  if (splitMode === 'exact') {
    const sum = ev.members
      .filter(m => draft[m.id] && draft[m.id].on)
      .reduce((s, m) => s + (parseInt(draft[m.id].exact, 10) || 0), 0);
    el.textContent = `指定合計：${yen(sum)}（支払額と一致させてね）`;
  } else if (splitMode === 'ratio') {
    el.textContent = '×2なら2人分、×0.5なら半人分の負担になるよ';
  } else {
    el.textContent = 'チェックした人で均等に割るよ';
  }
}

function renderExpenses() {
  const ev = currentEvent();
  if (!ev) return;
  const box = document.getElementById('expenseList');
  const sorted = [...ev.expenses].sort((a, b) => b.createdAt - a.createdAt);

  if (sorted.length === 0) {
    box.innerHTML = '<p class="hint">まだ支払い記録がないよ</p>';
    document.getElementById('expenseTotal').textContent = '';
    return;
  }

  const modeLabel = { even: '均等', ratio: '傾斜', exact: '金額指定' };
  box.innerHTML = sorted.map(x => `
    <div class="expense-item">
      <div class="expense-main">
        <div class="expense-title">${esc(x.title)} <span class="badge">${modeLabel[x.mode]}</span></div>
        <div class="expense-sub">${label(x.payerId)} が支払い → ${x.shares.map(s => esc(memberById(s.memberId)?.name || '？')).join('・')}</div>
      </div>
      <div class="expense-amount">${yen(x.amount)}</div>
      <div class="expense-btns">
        <button class="btn-secondary btn-sm" onclick="editExpense('${x.id}')">✏️</button>
        <button class="btn-delete btn-sm" onclick="deleteExpense('${x.id}')">削除</button>
      </div>
    </div>
  `).join('');

  const total = ev.expenses.reduce((s, x) => s + x.amount, 0);
  document.getElementById('expenseTotal').textContent =
    `合計 ${yen(total)}／1人あたり平均 ${yen(Math.round(total / ev.members.length))}`;
}

function renderSettlement() {
  const ev = currentEvent();
  if (!ev) return;
  const bal = computeBalances(ev);

  document.getElementById('balanceSummary').innerHTML = ev.members.map(m => {
    const b = bal[m.id];
    const diff = b.paid - b.owed;
    const cls = diff > 0 ? 'plus' : diff < 0 ? 'minus' : '';
    const sign = diff > 0 ? '+' : '';
    return `
      <div class="balance-row">
        <span>${m.emoji} ${esc(m.name)}</span>
        <span class="balance-detail">払った ${yen(b.paid)}／負担 ${yen(b.owed)}</span>
        <span class="balance-diff ${cls}">${sign}${yen(diff).replace('¥-', '-¥')}</span>
      </div>`;
  }).join('');

  const transfers = computeSettlements(ev);
  const box = document.getElementById('settlementList');
  if (ev.expenses.length === 0) {
    box.innerHTML = '';
  } else if (transfers.length === 0) {
    box.innerHTML = '<p class="settle-done">🎉 精算なし！みんなピッタリ</p>';
  } else {
    box.innerHTML = transfers.map(t => `
      <div class="settle-row">
        <span>${label(t.from)}</span>
        <span class="settle-arrow">→</span>
        <span>${label(t.to)}</span>
        <span class="settle-amount">${yen(t.amount)}</span>
      </div>
    `).join('');
  }
}

// ===== トースト =====
let toastTimer = null;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  importFromHash();
  if (!currentEvent() && store.events.length) {
    store.currentEventId = store.events[0].id;
  }
  renderAll();
});
