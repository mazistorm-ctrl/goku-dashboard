// ===== データ管理 =====
const STORAGE_KEY = 'warikan-data';
const COLORS = ['#E8604C', '#3B82C4', '#2E9E6B', '#C4863B', '#7A5FB8', '#D6558E', '#4A9FA8', '#5B7A3C'];

function loadStore() {
  const data = localStorage.getItem(STORAGE_KEY);
  const store = data ? JSON.parse(data) : { events: [], currentEventId: null };
  // 「自分」マーク（イベントID→メンバーID）。端末内だけの情報で共有URLには乗らない
  store.meMap = store.meMap || {};
  store.events.forEach(migrateEvent);
  return store;
}

// 古い形式のデータを補完する（日付なし記録・絵文字時代のメンバー・単独払い専用だった頃の記録）
function migrateEvent(ev) {
  ev.expenses.forEach(x => {
    if (!x.date) x.date = new Date(x.createdAt).toISOString().slice(0, 10);
    if (!x.payers) {
      x.payers = x.payerId ? [{ memberId: x.payerId, amount: x.amount }] : [];
      delete x.payerId;
    }
  });
  ev.members.forEach((m, i) => {
    if (typeof m.c !== 'number') m.c = i % COLORS.length;
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

let store = loadStore();
let splitMode = 'even';      // 'even' | 'ratio' | 'exact'
let editingExpenseId = null;
// 支払い一覧の絞り込み（null = すべて）
let viewDate = null;
let viewMemberId = null;
// 入力途中の割り方（memberId -> {on, weight, exact}）
let draft = {};
// 払った人が複数のときの入力状態（memberId -> {on, exact}）
let payerMode = 'single';    // 'single' | 'multi'
let payerDraft = {};

function currentEvent() {
  return store.events.find(e => e.id === store.currentEventId) || null;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function yen(n) {
  return '¥' + n.toLocaleString();
}

function fmtDate(d) {
  return d ? d.replace(/-/g, '/') : '-';
}

const MODE_LABEL = { even: '均等', ratio: '傾斜', exact: '金額指定' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== イベント =====
function showNewEventRow() {
  document.getElementById('newEventRow').style.display = 'flex';
  const input = document.getElementById('newEventName');
  input.value = '';
  input.focus();
}

function cancelNewEvent() {
  document.getElementById('newEventRow').style.display = 'none';
}

// document.createEvent と衝突するので createEvent という名前は使わない
function confirmNewEvent() {
  const input = document.getElementById('newEventName');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }
  const ev = { id: uid(), name, roundUnit: 1, members: [], expenses: [] };
  store.events.push(ev);
  store.currentEventId = ev.id;
  saveStore();
  cancelNewEvent();
  switchPage('input');
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
  deleteEventById(ev.id);
}

// イベント履歴からの個別削除（全データ削除しなくても1件だけ消せる）
function deleteEventById(id) {
  const ev = store.events.find(e => e.id === id);
  if (!ev) return;
  if (!confirm(`「${ev.name}」を削除する？記録も全部消えるよ`)) return;
  store.events = store.events.filter(e => e.id !== id);
  delete store.meMap[id];
  if (store.currentEventId === id) {
    store.currentEventId = store.events.length ? store.events[0].id : null;
  }
  saveStore();
  renderAll();
  toast('イベントを削除したよ');
}

function switchEvent(id) {
  store.currentEventId = id;
  saveStore();
  editingExpenseId = null;
  draft = {};
  payerMode = 'single';
  payerDraft = {};
  viewDate = null;
  viewMemberId = null;
  cancelNewEvent();
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
  ev.members.push({ id: uid(), name, c: ev.members.length % COLORS.length });
  input.value = '';
  saveStore();
  renderAll();
}

function removeMember(id) {
  const ev = currentEvent();
  const used = ev.expenses.some(x =>
    x.payers.some(p => p.memberId === id) || x.shares.some(s => s.memberId === id));
  if (used) {
    alert('支払い記録で使われてるメンバーは消せないよ。先に記録を直してね');
    return;
  }
  if (!confirm('このメンバーを削除する？')) return;
  ev.members = ev.members.filter(m => m.id !== id);
  if (store.meMap[ev.id] === id) delete store.meMap[ev.id];
  delete draft[id];
  saveStore();
  renderAll();
}

function cycleColor(id) {
  const ev = currentEvent();
  const m = ev.members.find(m => m.id === id);
  m.c = (m.c + 1) % COLORS.length;
  saveStore();
  renderAll();
}

// このイベントでの「自分」をマークする（もう一度タップで解除）
function toggleMe(id) {
  const ev = currentEvent();
  if (store.meMap[ev.id] === id) {
    delete store.meMap[ev.id];
  } else {
    store.meMap[ev.id] = id;
    toast('自分としてマークしたよ。履歴タブに自分の使用額が集計される');
  }
  saveStore();
  renderMembers();
  renderMySummary();
}

function memberById(id) {
  const ev = currentEvent();
  return ev ? ev.members.find(m => m.id === id) : null;
}

function nameOf(id) {
  const m = memberById(id);
  return m ? m.name : '？';
}

// 色付きイニシャルのアバター
function avatar(m, extra) {
  if (!m) return '';
  return `<span class="avatar" style="background:${COLORS[m.c % COLORS.length]}" ${extra || ''}>${esc([...m.name][0])}</span>`;
}

function person(id) {
  const m = memberById(id);
  return m ? `<span class="person">${avatar(m)}${esc(m.name)}</span>` : '？';
}

// 複数人払いのとき「たけし(8000円)・ひろし(4000円)」のように表示
function payersLabel(payers) {
  if (!payers || payers.length === 0) return '？';
  if (payers.length === 1) return esc(nameOf(payers[0].memberId));
  return payers.map(p => `${esc(nameOf(p.memberId))}(${yen(p.amount)})`).join('・');
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
  const cur = (typeof d.weight === 'number' && d.weight > 0) ? d.weight : 1;
  d.weight = Math.max(0.1, Math.round((cur + delta) * 10) / 10);
  renderParticipants();
}

// 入力中のフォーカスを保つため、この2つは一覧を再描画しない
function setWeight(id, value) {
  ensureDraft(id).weight = parseFloat(value);
  updateSplitStatus();
}

function setExact(id, value) {
  ensureDraft(id).exact = value;
  updateSplitStatus();
}

// 金額指定モード: 支払額の残りを空欄の人に均等に割り振る
function fillRemainder() {
  const ev = currentEvent();
  if (!ev) return;
  const amount = parseInt(document.getElementById('expAmount').value, 10) || 0;
  if (!amount) {
    alert('先に支払いの金額を入れてね');
    return;
  }
  const on = ev.members.filter(m => ensureDraft(m.id).on);
  const blank = on.filter(m => draft[m.id].exact === '');
  if (blank.length === 0) {
    alert('空欄の人がいないよ。自動で埋めたい人の金額を空にしてね');
    return;
  }
  const sumFilled = on.filter(m => draft[m.id].exact !== '')
    .reduce((s, m) => s + (parseInt(draft[m.id].exact, 10) || 0), 0);
  const rest = amount - sumFilled;
  if (rest < 0) {
    alert(`入力済みの合計（${yen(sumFilled)}）が支払額（${yen(amount)}）を超えてるよ`);
    return;
  }
  computeShares(rest, blank.map(m => ({ id: m.id, w: 1 })))
    .forEach(s => draft[s.memberId].exact = String(s.amount));
  renderParticipants();
}

// ===== 払った人（複数人払い対応） =====
function togglePayerMode() {
  payerMode = payerMode === 'single' ? 'multi' : 'single';
  renderPayerUI();
}

function ensurePayerDraft(id) {
  if (!payerDraft[id]) payerDraft[id] = { on: false, exact: '' };
  return payerDraft[id];
}

function togglePayer(id) {
  ensurePayerDraft(id).on = !payerDraft[id].on;
  renderPayerList();
}

function setPayerAmount(id, value) {
  ensurePayerDraft(id).exact = value;
  updatePayerStatus();
}

// 払った人の残りを空欄の人で均等に割り振る（参加者側のfillRemainderと同じ考え方）
function fillPayerRemainder() {
  const amount = parseInt(document.getElementById('expAmount').value, 10) || 0;
  if (!amount) {
    alert('先に支払いの金額を入れてね');
    return;
  }
  const onIds = Object.keys(payerDraft).filter(id => payerDraft[id].on);
  const blank = onIds.filter(id => payerDraft[id].exact === '');
  if (blank.length === 0) {
    alert('空欄の人がいないよ。自動で埋めたい人の金額を空にしてね');
    return;
  }
  const sumFilled = onIds.filter(id => payerDraft[id].exact !== '')
    .reduce((s, id) => s + (parseInt(payerDraft[id].exact, 10) || 0), 0);
  const rest = amount - sumFilled;
  if (rest < 0) {
    alert(`入力済みの合計（${yen(sumFilled)}）が支払額（${yen(amount)}）を超えてるよ`);
    return;
  }
  computeShares(rest, blank.map(id => ({ id, w: 1 })))
    .forEach(s => payerDraft[s.memberId].exact = String(s.amount));
  renderPayerList();
}

function renderPayerUI() {
  const sel = document.getElementById('expPayer');
  const list = document.getElementById('payerList');
  const status = document.getElementById('payerStatus');
  const toggleBtn = document.getElementById('payerModeToggle');
  if (payerMode === 'single') {
    sel.style.display = '';
    list.style.display = 'none';
    status.style.display = 'none';
    toggleBtn.textContent = '複数人で払った';
  } else {
    sel.style.display = 'none';
    list.style.display = '';
    status.style.display = '';
    toggleBtn.textContent = '1人で払った';
    renderPayerList();
  }
}

function renderPayerList() {
  const ev = currentEvent();
  if (!ev) return;
  const box = document.getElementById('payerList');
  box.innerHTML = ev.members.map(m => {
    const d = ensurePayerDraft(m.id);
    return `
      <div class="participant-row ${d.on ? '' : 'off'}">
        <label>
          <input type="checkbox" ${d.on ? 'checked' : ''} onchange="togglePayer('${m.id}')">
          ${avatar(m)}${esc(m.name)}
        </label>
        ${d.on ? `<input type="number" class="exact-input" inputmode="numeric" placeholder="円"
                   value="${esc(d.exact)}" oninput="setPayerAmount('${m.id}', this.value)">` : ''}
      </div>`;
  }).join('') + `
      <div class="participant-row exact-tools">
        <button class="btn-secondary btn-sm" onclick="fillPayerRemainder()">残りを空欄の人で均等に</button>
      </div>`;
  updatePayerStatus();
}

function updatePayerStatus() {
  const amount = parseInt(document.getElementById('expAmount').value, 10) || 0;
  const sum = Object.keys(payerDraft).filter(id => payerDraft[id].on)
    .reduce((s, id) => s + (parseInt(payerDraft[id].exact, 10) || 0), 0);
  document.getElementById('payerStatus').textContent =
    `支払った合計 ${yen(sum)}／残り ${yen(amount - sum)}（残りを0にして記録してね）`;
}

// ===== 支払い =====
function saveExpense() {
  const ev = currentEvent();
  if (!ev) return;
  const title = document.getElementById('expTitle').value.trim();
  const amount = parseInt(document.getElementById('expAmount').value, 10);
  const date = document.getElementById('expDate').value;

  if (!title || !amount || amount <= 0 || !date) {
    alert('内容・金額・日付は必須だよ');
    return;
  }

  let payers;
  if (payerMode === 'single') {
    const payerId = document.getElementById('expPayer').value;
    if (!payerId) {
      alert('払った人を選んでね');
      return;
    }
    payers = [{ memberId: payerId, amount }];
  } else {
    const payerIds = ev.members.filter(m => payerDraft[m.id] && payerDraft[m.id].on);
    if (payerIds.length === 0) {
      alert('払った人を1人以上選んでね');
      return;
    }
    payers = payerIds.map(m => ({ memberId: m.id, amount: parseInt(payerDraft[m.id].exact, 10) || 0 }));
    const payerSum = payers.reduce((s, p) => s + p.amount, 0);
    if (payerSum !== amount) {
      alert(`支払った合計（${yen(payerSum)}）が支払額（${yen(amount)}）と合わないよ`);
      return;
    }
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
    if (splitMode === 'ratio' && weights.some(x => !(x.w > 0))) {
      alert('倍率は0より大きい数字で入れてね');
      return;
    }
    shares = computeShares(amount, weights);
  }

  const exp = {
    id: editingExpenseId || uid(),
    title, amount, date, payers,
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
  document.getElementById('expDate').value = exp.date;
  document.getElementById('expenseFormTitle').textContent = '支払いを編集中';
  document.getElementById('expSaveBtn').textContent = '更新する';
  document.getElementById('expCancelBtn').style.display = '';

  payerMode = exp.payers.length > 1 ? 'multi' : 'single';
  payerDraft = {};
  ev.members.forEach(m => {
    const p = exp.payers.find(p => p.memberId === m.id);
    payerDraft[m.id] = { on: !!p, exact: p ? String(p.amount) : '' };
  });
  if (payerMode === 'single' && exp.payers[0]) {
    document.getElementById('expPayer').value = exp.payers[0].memberId;
  }
  renderPayerUI();

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
  switchPage('input');
  document.getElementById('expTitle').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingExpenseId = null;
  draft = {};
  payerMode = 'single';
  payerDraft = {};
  document.getElementById('expTitle').value = '';
  document.getElementById('expAmount').value = '';
  document.getElementById('expDate').value = today();
  document.getElementById('expenseFormTitle').textContent = '支払いを記録';
  document.getElementById('expSaveBtn').textContent = '記録する';
  document.getElementById('expCancelBtn').style.display = 'none';
  renderPayerUI();
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
    x.payers.forEach(p => {
      if (bal[p.memberId]) bal[p.memberId].paid += p.amount;
    });
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
    migrateEvent(ev);
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
    `【${ev.name} の精算】`,
    `合計 ${yen(total)}（${ev.members.length}人）`,
    ''
  ];
  if (transfers.length === 0) {
    lines.push('精算なし！みんなピッタリ');
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
  renderPayerUI();
  renderParticipants();
  renderExpenses();
  renderSettlement();
  renderEventList();
  renderMySummary();
  renderHistoryMemberSelect();
  renderHistory();
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
  const meId = store.meMap[ev.id];
  box.innerHTML = ev.members.map(m => `
    <span class="chip ${m.id === meId ? 'me' : ''}">
      ${avatar(m, `onclick="cycleColor('${m.id}')" title="タップで色変更"`)}
      <button class="chip-name" onclick="toggleMe('${m.id}')" title="タップで自分としてマーク">${esc(m.name)}</button>
      ${m.id === meId ? '<span class="me-badge">自分</span>' : ''}
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
    `<option value="${m.id}">${esc(m.name)}</option>`
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
      const w = (typeof d.weight === 'number' && !isNaN(d.weight)) ? d.weight : '';
      control = `
        <span class="weight-control">
          <button onclick="stepWeight('${m.id}', -0.5)">−</button>
          <span class="weight-x">×</span><input type="number" class="weight-input" step="0.1" min="0.1"
            value="${w}" oninput="setWeight('${m.id}', this.value)">
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
          ${avatar(m)}${esc(m.name)}
        </label>
        ${control}
      </div>`;
  }).join('');
  if (splitMode === 'exact') {
    box.innerHTML += `
      <div class="participant-row exact-tools">
        <button class="btn-secondary btn-sm" onclick="fillRemainder()">残りを空欄の人で均等に</button>
      </div>`;
  }
  updateSplitStatus();
}

function updateSplitStatus() {
  const ev = currentEvent();
  const el = document.getElementById('splitStatus');
  if (!ev) { el.textContent = ''; return; }
  if (splitMode === 'exact') {
    const amount = parseInt(document.getElementById('expAmount').value, 10) || 0;
    const sum = ev.members
      .filter(m => draft[m.id] && draft[m.id].on)
      .reduce((s, m) => s + (parseInt(draft[m.id].exact, 10) || 0), 0);
    const rest = amount - sum;
    el.textContent = `指定合計 ${yen(sum)}／残り ${yen(rest)}（残りを0にして記録してね）`;
  } else if (splitMode === 'ratio') {
    el.textContent = '×2なら2人分、×0.5なら半人分。×1.3みたいに直接入力もできるよ';
  } else {
    el.textContent = 'チェックした人で均等に割るよ';
  }
}

function setViewDate(d) {
  viewDate = d || null;
  renderExpenses();
}

function setViewMember(id) {
  viewMemberId = id || null;
  renderExpenses();
}

function renderExpenses() {
  const ev = currentEvent();
  if (!ev) return;
  const box = document.getElementById('expenseList');
  const memberTabs = document.getElementById('memberTabs');
  const dateTabs = document.getElementById('dateTabs');
  const sorted = [...ev.expenses].sort((a, b) =>
    b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  if (sorted.length === 0) {
    memberTabs.innerHTML = '';
    dateTabs.innerHTML = '';
    box.innerHTML = '<p class="hint">まだ支払い記録がないよ</p>';
    document.getElementById('expenseTotal').textContent = '';
    return;
  }

  // タブの選択先が消えていたら「すべて」に戻す
  const dates = [...new Set(sorted.map(x => x.date))];
  if (viewDate && !dates.includes(viewDate)) viewDate = null;
  if (viewMemberId && !ev.members.some(m => m.id === viewMemberId)) viewMemberId = null;

  // メンバータブ（自分の名前を押すと自分が絡む記録だけ）
  const tab = (labelHtml, active, onclick) =>
    `<button class="view-tab ${active ? 'active' : ''}" onclick="${onclick}">${labelHtml}</button>`;
  memberTabs.innerHTML =
    tab('みんな', !viewMemberId, "setViewMember('')") +
    ev.members.map(m =>
      tab(esc(m.name), viewMemberId === m.id, `setViewMember('${m.id}')`)).join('');

  // 日付タブ（記録が2日以上あるときだけ表示）
  dateTabs.innerHTML = dates.length > 1
    ? tab('全日', !viewDate, "setViewDate('')") +
      dates.map(d =>
        tab(fmtDate(d).slice(5), viewDate === d, `setViewDate('${d}')`)).join('')
    : '';

  const shareOf = x => {
    const s = x.shares.find(s => s.memberId === viewMemberId);
    return s ? s.amount : 0;
  };
  const paidOf = x => {
    const p = x.payers.find(p => p.memberId === viewMemberId);
    return p ? p.amount : 0;
  };
  const list = sorted.filter(x =>
    (!viewDate || x.date === viewDate) &&
    (!viewMemberId || x.payers.some(p => p.memberId === viewMemberId) || x.shares.some(s => s.memberId === viewMemberId)));

  if (list.length === 0) {
    box.innerHTML = '<p class="hint">この条件の記録はないよ</p>';
    document.getElementById('expenseTotal').textContent = '';
    return;
  }

  box.innerHTML = list.map(x => `
    <div class="expense-item">
      <div class="expense-main">
        <div class="expense-title">${esc(x.title)} <span class="badge">${MODE_LABEL[x.mode]}</span></div>
        <div class="expense-sub">${fmtDate(x.date)}｜${payersLabel(x.payers)} が支払い → ${x.shares.map(s => esc(memberById(s.memberId)?.name || '？')).join('・')}</div>
      </div>
      <div class="expense-amount">${yen(x.amount)}
        ${viewMemberId ? `<div class="mine-share">負担 ${yen(shareOf(x))}</div>` : ''}
      </div>
      <div class="expense-btns">
        <button class="btn-secondary btn-sm" onclick="editExpense('${x.id}')">編集</button>
        <button class="btn-delete btn-sm" onclick="deleteExpense('${x.id}')">削除</button>
      </div>
    </div>
  `).join('');

  const totalEl = document.getElementById('expenseTotal');
  if (viewMemberId) {
    const m = memberById(viewMemberId);
    const owed = list.reduce((s, x) => s + shareOf(x), 0);
    const paid = list.reduce((s, x) => s + paidOf(x), 0);
    totalEl.textContent = `${m.name}：負担合計 ${yen(owed)}／立替合計 ${yen(paid)}`;
  } else {
    const total = list.reduce((s, x) => s + x.amount, 0);
    totalEl.textContent =
      `合計 ${yen(total)}／1人あたり平均 ${yen(Math.round(total / ev.members.length))}`;
  }
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
        <span class="person">${avatar(m)}${esc(m.name)}</span>
        <span class="balance-detail">払った ${yen(b.paid)}／負担 ${yen(b.owed)}</span>
        <span class="balance-diff ${cls}">${sign}${yen(diff).replace('¥-', '-¥')}</span>
      </div>`;
  }).join('');

  const transfers = computeSettlements(ev);
  const box = document.getElementById('settlementList');
  if (ev.expenses.length === 0) {
    box.innerHTML = '';
  } else if (transfers.length === 0) {
    box.innerHTML = '<p class="settle-done">精算なし！みんなピッタリ</p>';
  } else {
    box.innerHTML = transfers.map(t => `
      <div class="settle-row">
        ${person(t.from)}
        <span class="settle-arrow">→</span>
        ${person(t.to)}
        <span class="settle-amount">${yen(t.amount)}</span>
      </div>
    `).join('');
  }
}

// ===== ページタブ =====
function switchPage(p) {
  document.querySelectorAll('.page').forEach(el =>
    el.classList.toggle('active', el.id === 'page-' + p));
  document.querySelectorAll('.page-tab').forEach(el =>
    el.classList.toggle('active', el.dataset.page === p));
  window.scrollTo({ top: 0 });
}

// ===== イベント履歴（全イベントの羅列） =====
function openEvent(id) {
  switchEvent(id);
  switchPage('list');
}

function renderEventList() {
  const box = document.getElementById('eventListView');
  if (store.events.length === 0) {
    box.innerHTML = '<p class="hint">まだイベントがないよ</p>';
    return;
  }
  const rows = store.events.map(ev => {
    const dates = ev.expenses.map(x => x.date).sort();
    return {
      ev,
      total: ev.expenses.reduce((s, x) => s + x.amount, 0),
      from: dates[0] || null,
      to: dates[dates.length - 1] || null
    };
  }).sort((a, b) => (b.to || '').localeCompare(a.to || ''));

  box.innerHTML = rows.map(r => `
    <div class="expense-item my-event ${r.ev.id === store.currentEventId ? 'current' : ''}">
      <div class="expense-main" onclick="openEvent('${r.ev.id}')">
        <div class="expense-title">${esc(r.ev.name)}</div>
        <div class="expense-sub">${r.from ? fmtDate(r.from) + (r.from !== r.to ? '〜' + fmtDate(r.to).slice(5) : '') : '記録なし'}｜${r.ev.members.length}人・${r.ev.expenses.length}件</div>
      </div>
      <div class="expense-amount" onclick="openEvent('${r.ev.id}')">${yen(r.total)}</div>
      <div class="expense-btns">
        <button class="btn-delete btn-sm" onclick="deleteEventById('${r.ev.id}')">削除</button>
      </div>
    </div>
  `).join('');
}

// ===== じぶんのまとめ（自分マークしたイベントの集計） =====
function renderMySummary() {
  const box = document.getElementById('myEvents');
  const totalEl = document.getElementById('myTotal');

  const rows = [];
  store.events.forEach(ev => {
    const meId = store.meMap[ev.id];
    const me = meId && ev.members.find(m => m.id === meId);
    if (!me) return;
    const mine = ev.expenses.filter(x =>
      x.payers.some(p => p.memberId === me.id) || x.shares.some(s => s.memberId === me.id));
    if (mine.length === 0) return;
    const owed = mine.reduce((s, x) =>
      s + (x.shares.find(sh => sh.memberId === me.id)?.amount || 0), 0);
    const paid = mine.reduce((s, x) =>
      s + (x.payers.find(p => p.memberId === me.id)?.amount || 0), 0);
    const dates = mine.map(x => x.date).sort();
    rows.push({ ev, me, owed, paid, from: dates[0], to: dates[dates.length - 1] });
  });
  rows.sort((a, b) => b.to.localeCompare(a.to));

  if (rows.length === 0) {
    box.innerHTML = '<p class="hint">記録ページのメンバーで自分の名前をタップしてマークすると、参加したイベントの自分の使用額がここに溜まっていくよ</p>';
    totalEl.textContent = '';
    return;
  }

  box.innerHTML = rows.map(r => `
    <div class="expense-item my-event" onclick="openEvent('${r.ev.id}')">
      <div class="expense-main">
        <div class="expense-title">${esc(r.ev.name)}</div>
        <div class="expense-sub">${fmtDate(r.from)}${r.from !== r.to ? '〜' + fmtDate(r.to).slice(5) : ''}｜${esc(r.me.name)}として参加｜立替 ${yen(r.paid)}</div>
      </div>
      <div class="expense-amount">${yen(r.owed)}<div class="mine-share">自分の使用額</div></div>
    </div>
  `).join('');

  const owedTotal = rows.reduce((s, r) => s + r.owed, 0);
  totalEl.textContent = `参加イベント ${rows.length}件／使用額合計 ${yen(owedTotal)}`;
}

// ===== 記録の検索（全イベント横断） =====
function memberNameIn(ev, id) {
  const m = ev.members.find(m => m.id === id);
  return m ? m.name : '？';
}

// その人が「使った」＝負担した金額（払った額ではなく割り勘の自分の取り分）
function memberShareIn(ev, memberName, x) {
  const m = ev.members.find(m => m.name === memberName);
  if (!m) return 0;
  return x.shares.find(s => s.memberId === m.id)?.amount || 0;
}

// 全イベントの支払いを日付降順でフラットに
function allRecords() {
  const rows = [];
  store.events.forEach(ev => ev.expenses.forEach(x => rows.push({ ev, x })));
  rows.sort((a, b) =>
    b.x.date.localeCompare(a.x.date) || b.x.createdAt - a.x.createdAt);
  return rows;
}

function filteredRecords() {
  const kw = document.getElementById('histKeyword').value.trim().toLowerCase();
  const member = document.getElementById('histMember').value;
  const from = document.getElementById('histFrom').value;
  const to = document.getElementById('histTo').value;

  return allRecords().filter(({ ev, x }) => {
    if (kw && !(x.title.toLowerCase().includes(kw) || ev.name.toLowerCase().includes(kw))) return false;
    if (member) {
      const names = [...x.payers.map(p => memberNameIn(ev, p.memberId)), ...x.shares.map(s => memberNameIn(ev, s.memberId))];
      if (!names.includes(member)) return false;
    }
    if (from && x.date < from) return false;
    if (to && x.date > to) return false;
    return true;
  });
}

function renderHistoryMemberSelect() {
  const sel = document.getElementById('histMember');
  const prev = sel.value;
  const names = [...new Set(store.events.flatMap(ev => ev.members.map(m => m.name)))];
  sel.innerHTML = '<option value="">全員</option>' +
    names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if (names.includes(prev)) sel.value = prev;
}

// イベント×日付でまとめる（記録の検索は明細ではなくここまでの粒度でいい）
// メンバーで絞り込んでいるときは、そのメンバーが使った分（負担額）を合計する
function groupHistoryRows(rows, member) {
  const map = new Map();
  rows.forEach(({ ev, x }) => {
    const key = ev.id + '|' + x.date;
    if (!map.has(key)) map.set(key, { ev, date: x.date, total: 0, count: 0 });
    const g = map.get(key);
    g.total += member ? memberShareIn(ev, member, x) : x.amount;
    g.count += 1;
  });
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// 記録の検索からタップしたら、その日に絞ったイベント内訳に飛ぶ
function openEventOnDate(evId, date) {
  switchEvent(evId);
  viewDate = date;
  renderExpenses();
  switchPage('list');
}

function renderHistory() {
  const box = document.getElementById('historyList');
  const rows = filteredRecords();
  const member = document.getElementById('histMember').value;

  if (rows.length === 0) {
    box.innerHTML = '<p class="hint">該当する記録がないよ</p>';
    document.getElementById('historyTotal').textContent = '';
    return;
  }

  const groups = groupHistoryRows(rows, member);
  box.innerHTML = groups.map(g => `
    <div class="expense-item my-event" onclick="openEventOnDate('${g.ev.id}', '${g.date}')">
      <div class="expense-main">
        <div class="expense-title">${esc(g.ev.name)}</div>
        <div class="expense-sub">${fmtDate(g.date)}｜${g.count}件</div>
      </div>
      <div class="expense-amount">${yen(g.total)}</div>
    </div>
  `).join('');

  const total = member
    ? rows.reduce((s, r) => s + memberShareIn(r.ev, member, r.x), 0)
    : rows.reduce((s, r) => s + r.x.amount, 0);
  document.getElementById('historyTotal').textContent = member
    ? `${rows.length}件／${member}の使用額合計 ${yen(total)}`
    : `${rows.length}件／合計 ${yen(total)}`;
}

function exportHistoryCSV() {
  const rows = filteredRecords();
  if (rows.length === 0) {
    alert('エクスポートする記録がないよ');
    return;
  }

  const header = ['日付', 'イベント', '内容', '金額', '払った人', '対象', '割り方'];
  const body = rows.map(({ ev, x }) => [
    x.date,
    ev.name,
    x.title,
    x.amount,
    x.payers.map(p => `${memberNameIn(ev, p.memberId)}(${p.amount}円)`).join(' / '),
    x.shares.map(s => `${memberNameIn(ev, s.memberId)}(${s.amount}円)`).join(' / '),
    MODE_LABEL[x.mode]
  ]);

  const csv = [header, ...body]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `warikan-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== 全データ削除 =====
function resetAll() {
  if (!confirm('この端末に保存されたワリピタのデータ（全イベント・全記録）を削除する？')) return;
  if (!confirm('本当に削除する？元に戻せないよ')) return;
  localStorage.removeItem(STORAGE_KEY);
  store = loadStore();
  switchPage('input');
  renderAll();
  toast('データをすべて削除したよ');
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
  document.getElementById('expDate').value = today();
  renderAll();

  // PWA: ホーム画面に追加してアプリとして使えるようにする
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
