/* ============================================================
   誕生日祝福受付システム
   ここだけ書き換えれば設定は変わります
   ============================================================ */
const CONFIG = {
  // 誕生日の主役の表示名
  personName: 'KOKI',

  // DMを書いた場合の推定所要時間（工数削減率の分母）
  dmBaselineSeconds: 90,

  // タップで選べるメッセージ
  templates: [
    '誕生日おめでとう🎉',
    'おめでとう！今年もよろしく',
    'いつもストーリー見てます👀',
    '今度ごはん行こう🍽',
    'AIで作ったの普通にすごい',
    '健康に気をつけてね',
  ],

  // @入力のサジェスト候補（フォロワーのハンドルを入れておくと入力が楽になる）
  handleSuggestions: [],
};

const SUPABASE = {
  url: 'https://lqdsglqprmiatlhevcul.supabase.co',
  key: 'sb_publishable_lcsgCEG67RpZ8cpaPohjdw_xzSLeGvk',
  table: 'birthday_wishes',
};

const LS_HANDLE = 'bd-handle';
const LS_LOCAL_WISHES = 'bd-local-wishes';
const PALETTE = ['#ff5c8a', '#5b8dff', '#ffc93f', '#35d6bd', '#a97cff', '#ff8a5c'];

const pageOpenedAt = Date.now();
let submitted = false;

/* ============================================================
   分析ロジック（ハンドルから決定論的に生成するので、
   同じ人には毎回同じ結果が出る）
   ============================================================ */
const PERSONAS = [
  '通知即レス型', '既読スルー職人', '深夜テンション同期型',
  '飲み会召喚装置', '安定供給型フォロワー', 'ストーリー全視聴・無言型',
  '一年一回の律儀枠', '呼べば必ず来る型', '静かな最古参',
  '情報収集特化型', '語彙が渋滞するタイプ', '突発的爆笑供給型',
];

const PHASES = [
  '第1章「観測期」', '第2章「安定期」', '第2章「再燃期」',
  '第3章「相互依存期」', '第4章「盟友期」', '第5章「殿堂入り」',
];

const OPENERS = [
  'あなたの祝福には、過剰な説明を省く合理性が見られます。',
  'テンプレートを選ぶ速度から、迷いのなさが検出されました。',
  'メッセージの短さに反して、送信までの決断は極めて速いです。',
  'あなたは言葉数で愛情を表現しないタイプに分類されます。',
  '祝福の内容よりも、送信したという事実に価値を置く傾向があります。',
];

const MIDDLES = [
  '普段は静かに見ていて、必要なときだけ現れる観測者型の関わり方です。',
  '連絡頻度は低めでも、関係の耐久性は上位に入ります。',
  '距離感の調整が上手く、踏み込みすぎない安定した関係を維持しています。',
  '反応の量ではなく、タイミングの正確さで信頼を積んでいます。',
  '相手の変化に気づくのが早く、言わないだけでちゃんと見ています。',
];

const CLOSERS = [
  '今年は一度、テキストではなく声で会話することを推奨します。',
  '次の接触は3ヶ月以内が最適と算出されました。',
  'この関係は放置しても劣化しにくいので、安心して放置してください。',
  '近いうちに飲みに行く確率は、統計上かなり高めです。',
  '今回の送信により、関係性スコアが微増しました。',
];

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function analyze(handle) {
  const h = hashString(handle.toLowerCase());
  const score = 78 + (h % 22); // 78〜99
  return {
    score,
    persona: PERSONAS[h % PERSONAS.length],
    phase: PHASES[(h >> 3) % PHASES.length],
    heat: `${Math.round(score * 1.37)} kcal相当`,
    comment: [
      OPENERS[(h >> 5) % OPENERS.length],
      MIDDLES[(h >> 8) % MIDDLES.length],
      CLOSERS[(h >> 11) % CLOSERS.length],
    ].join(''),
    color: PALETTE[h % PALETTE.length],
  };
}

/* ============================================================
   保存層（Supabase。失敗したらlocalStorageに退避）
   ============================================================ */
function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE.key,
    Authorization: `Bearer ${SUPABASE.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function insertWish(row) {
  const res = await fetch(`${SUPABASE.url}/rest/v1/${SUPABASE.table}`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json[0];
}

async function fetchWishes() {
  const url = `${SUPABASE.url}/rest/v1/${SUPABASE.table}`
    + '?select=handle,message,elapsed_ms,compat_score,created_at'
    + '&order=created_at.desc&limit=200';
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return res.json();
}

function loadLocalWishes() {
  try {
    return JSON.parse(localStorage.getItem(LS_LOCAL_WISHES) || '[]');
  } catch {
    return [];
  }
}

function pushLocalWish(row) {
  const list = loadLocalWishes();
  list.unshift({ ...row, created_at: new Date().toISOString() });
  try {
    localStorage.setItem(LS_LOCAL_WISHES, JSON.stringify(list.slice(0, 200)));
  } catch { /* 容量超過は無視 */ }
}

/* ============================================================
   背景バルーン
   ============================================================ */
function renderBalloons() {
  const wrap = document.querySelector('.balloons');
  const count = window.innerWidth < 480 ? 9 : 14;
  const frag = document.createDocumentFragment();

  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'balloon';
    const size = 38 + Math.round(Math.random() * 54);
    b.style.setProperty('--size', `${size}px`);
    b.style.setProperty('--c', PALETTE[i % PALETTE.length]);
    b.style.setProperty('--dur', `${16 + Math.random() * 16}s`);
    b.style.setProperty('--delay', `${-Math.random() * 24}s`);
    b.style.left = `${Math.random() * 92}%`;
    b.appendChild(document.createElement('i'));
    frag.appendChild(b);
  }
  wrap.appendChild(frag);
}

/* ============================================================
   フォーム
   ============================================================ */
function renderTemplates() {
  const wrap = document.getElementById('chips');
  const input = document.getElementById('message');

  CONFIG.templates.forEach(text => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      input.value = text;
    });
    wrap.appendChild(btn);
  });
}

function renderHandleSuggestions() {
  const list = document.getElementById('handleList');
  CONFIG.handleSuggestions.forEach(h => {
    const opt = document.createElement('option');
    opt.value = normalizeHandle(h);
    list.appendChild(opt);
  });
}

function normalizeHandle(raw) {
  return raw.trim().replace(/^@+/, '').toLowerCase().slice(0, 40);
}

function restoreHandle() {
  const saved = localStorage.getItem(LS_HANDLE);
  if (saved) document.getElementById('handle').value = saved;
}

/* ============================================================
   送信
   ============================================================ */
async function handleSubmit() {
  if (submitted) return;

  const handle = normalizeHandle(document.getElementById('handle').value);
  const message = document.getElementById('message').value.trim();
  const btn = document.getElementById('submitBtn');

  if (!handle) {
    alert('Instagramのユーザーネームを入れてください（@は不要）');
    return;
  }
  if (!/^[a-z0-9._]+$/.test(handle)) {
    alert('ユーザーネームは半角英数字と . _ のみ使えます');
    return;
  }
  if (!message) {
    alert('メッセージをタップまたは入力してください');
    return;
  }

  submitted = true;
  btn.disabled = true;
  btn.textContent = '送信中…';

  const elapsedMs = Math.max(0, Date.now() - pageOpenedAt);
  const result = analyze(handle);

  const row = {
    handle,
    message: message.slice(0, 200),
    elapsed_ms: elapsedMs,
    compat_score: result.score,
    persona: result.persona,
  };

  try {
    localStorage.setItem(LS_HANDLE, handle);
  } catch { /* プライベートモード等は無視 */ }

  // 解析演出とDB書き込みを並行して進める
  const savePromise = insertWish(row).catch(err => {
    console.warn('Supabaseへの保存に失敗、ローカルに退避します', err);
    pushLocalWish(row);
    return null;
  });

  showScreen('screenAnalyzing');
  await Promise.all([runAnalysisAnimation(), savePromise]);

  await showResult({ handle, message, elapsedMs, result });
}

const ANALYSIS_STEPS = [
  'Instagramハンドルを照会',
  '過去のリアクション傾向を推定',
  '関係性フェーズを判定',
  '相性スコアを算出',
  '証明書を生成',
];

function runAnalysisAnimation() {
  const ul = document.getElementById('analysisSteps');
  ul.innerHTML = '';

  const items = ANALYSIS_STEPS.map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
    return li;
  });

  return new Promise(resolve => {
    items.forEach((li, i) => {
      setTimeout(() => li.classList.add('show'), i * 320);
      setTimeout(() => li.classList.add('done'), i * 320 + 260);
    });
    setTimeout(resolve, items.length * 320 + 320);
  });
}

/* ============================================================
   結果表示
   ============================================================ */
function showScreen(id) {
  ['screenForm', 'screenAnalyzing', 'screenResult'].forEach(s => {
    document.getElementById(s).hidden = (s !== id);
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function showResult({ handle, message, elapsedMs, result }) {
  const elapsedSec = elapsedMs / 1000;
  const baseline = CONFIG.dmBaselineSeconds;
  const savingRate = Math.max(0, Math.min(99.9, (1 - elapsedSec / baseline) * 100));

  document.getElementById('resultHandle').textContent = '@' + handle;
  document.getElementById('elapsedVal').textContent = `${elapsedSec.toFixed(1)}秒`;
  document.getElementById('savingBar').style.width =
    `${Math.max(2, Math.min(100, (elapsedSec / baseline) * 100))}%`;
  document.getElementById('savingRate').textContent = `${savingRate.toFixed(1)}%`;

  document.getElementById('scoreNum').textContent = result.score;
  const ring = document.getElementById('scoreRing');
  ring.style.setProperty('--pct', `${result.score}%`);
  ring.style.setProperty('--ring', result.color);
  document.getElementById('personaVal').textContent = result.persona;
  document.getElementById('phaseVal').textContent = result.phase;
  document.getElementById('heatVal').textContent = result.heat;
  document.getElementById('aiComment').textContent = result.comment;

  showScreen('screenResult');
  fireConfetti();

  // 集計はネットワーク次第なので、画面表示を待たせない
  const stats = await loadStats();
  const rank = stats.rankByHandle.get(handle) ?? stats.total;
  document.getElementById('receiptNo').textContent = `#${String(rank).padStart(3, '0')}`;

  drawCertificate({ handle, message, elapsedSec, savingRate, result, rank });
}

async function loadStats() {
  let rows = [];
  let isRemote = true;

  try {
    rows = await fetchWishes();
  } catch (err) {
    console.warn('祝福一覧の取得に失敗、ローカルデータを表示します', err);
    rows = loadLocalWishes();
    isRemote = false;
  }

  const total = rows.length;
  const avgSec = total
    ? rows.reduce((s, r) => s + (r.elapsed_ms || 0), 0) / total / 1000
    : 0;
  const bestSec = total
    ? Math.min(...rows.map(r => (r.elapsed_ms || 0))) / 1000
    : 0;

  // 古い順に受付番号を振る
  const rankByHandle = new Map();
  [...rows].reverse().forEach((r, i) => {
    if (!rankByHandle.has(r.handle)) rankByHandle.set(r.handle, i + 1);
  });

  document.getElementById('kpiCount').textContent = total;
  document.getElementById('kpiAvg').textContent = total ? avgSec.toFixed(1) : '—';
  document.getElementById('kpiBest').textContent = total ? bestSec.toFixed(1) : '—';

  renderWall(rows);
  document.getElementById('wallNote').textContent = isRemote
    ? ''
    : '※ 通信できなかったため、この端末の記録のみ表示しています';

  return { total, avgSec, bestSec, rankByHandle };
}

function renderWall(rows) {
  const ul = document.getElementById('wall');
  ul.innerHTML = '';

  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'wall-empty';
    li.textContent = 'まだ祝福がありません';
    ul.appendChild(li);
    return;
  }

  rows.slice(0, 50).forEach(r => {
    const li = document.createElement('li');

    const av = document.createElement('span');
    av.className = 'wall-av';
    av.style.background = PALETTE[hashString(r.handle) % PALETTE.length];
    av.textContent = (r.handle[0] || '?').toUpperCase();

    const body = document.createElement('div');
    body.className = 'wall-body';

    const handle = document.createElement('div');
    handle.className = 'wall-handle';
    handle.textContent = '@' + r.handle;

    const msg = document.createElement('div');
    msg.className = 'wall-msg';
    msg.textContent = r.message;

    const meta = document.createElement('div');
    meta.className = 'wall-meta';
    const t = new Date(r.created_at).toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit',
    });
    meta.textContent = `${t} ・ 所要 ${((r.elapsed_ms || 0) / 1000).toFixed(1)}秒`;

    body.append(handle, msg, meta);
    li.append(av, body);
    ul.appendChild(li);
  });
}

/* ============================================================
   証明書（ストーリー用 1080×1920）
   ============================================================ */
function drawCertificate({ handle, message, elapsedSec, savingRate, result, rank }) {
  const canvas = document.getElementById('certCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // 背景
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#fff4f9');
  bg.addColorStop(0.5, '#f4f2ff');
  bg.addColorStop(1, '#eef7ff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 装飾バルーン
  const decor = [
    [140, 250, 78, '#ff5c8a'], [935, 330, 62, '#5b8dff'],
    [190, 1640, 66, '#ffc93f'], [905, 1560, 74, '#35d6bd'],
    [1010, 950, 50, '#a97cff'], [70, 1010, 44, '#ff8a5c'],
  ];
  decor.forEach(([x, y, r, c]) => drawBalloon(ctx, x, y, r, c));

  ctx.textAlign = 'center';

  // ヘッダー
  ctx.fillStyle = '#9a9ab0';
  ctx.font = '600 30px sans-serif';
  ctx.fillText('BIRTHDAY WISH INTAKE SYSTEM', W / 2, 210);

  ctx.fillStyle = '#2b2b3a';
  ctx.font = '800 54px sans-serif';
  ctx.fillText('祝 福 証 明 書', W / 2, 300);

  // ハンドル（長い場合は収まるまで縮める）
  ctx.fillStyle = result.color;
  let handleSize = 76;
  ctx.font = `800 ${handleSize}px sans-serif`;
  while (ctx.measureText('@' + handle).width > W - 140 && handleSize > 32) {
    handleSize -= 4;
    ctx.font = `800 ${handleSize}px sans-serif`;
  }
  ctx.fillText('@' + handle, W / 2, 470);

  ctx.fillStyle = '#6d6d85';
  ctx.font = '400 34px sans-serif';
  ctx.fillText(`${CONFIG.personName} への祝福を確かに受理しました`, W / 2, 530);

  // スコアリング
  drawScoreRing(ctx, W / 2, 780, 165, result.score, result.color);
  ctx.fillStyle = '#9a9ab0';
  ctx.font = '600 30px sans-serif';
  ctx.fillText('相 性 ス コ ア', W / 2, 1000);

  // タイプ
  roundRect(ctx, W / 2 - 330, 1055, 660, 110, 55);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#9a9ab0';
  ctx.font = '600 26px sans-serif';
  ctx.fillText('あなたのタイプ', W / 2, 1100);
  ctx.fillStyle = '#2b2b3a';
  ctx.font = '800 42px sans-serif';
  ctx.fillText(result.persona, W / 2, 1145);

  // メッセージ
  ctx.fillStyle = '#6d6d85';
  ctx.font = 'italic 400 36px sans-serif';
  wrapText(ctx, `「${message}」`, W / 2, 1275, W - 220, 52, 2);

  // 指標
  const metrics = [
    ['所要時間', `${elapsedSec.toFixed(1)}秒`],
    ['工数削減率', `${savingRate.toFixed(1)}%`],
    ['受付番号', `#${String(rank).padStart(3, '0')}`],
  ];
  const boxW = 290;
  const gap = 20;
  const startX = W / 2 - (boxW * 3 + gap * 2) / 2;

  metrics.forEach(([label, value], i) => {
    const x = startX + i * (boxW + gap);
    roundRect(ctx, x, 1420, boxW, 160, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.fillStyle = '#9a9ab0';
    ctx.font = '600 26px sans-serif';
    ctx.fillText(label, x + boxW / 2, 1478);
    ctx.fillStyle = '#2b2b3a';
    ctx.font = '800 46px sans-serif';
    ctx.fillText(value, x + boxW / 2, 1535);
  });

  // フッター
  ctx.fillStyle = '#9a9ab0';
  ctx.font = '400 28px sans-serif';
  ctx.fillText(new Date().toLocaleString('ja-JP'), W / 2, 1740);
  ctx.font = '600 28px sans-serif';
  ctx.fillText('このシステムはAIと一緒に1日で作られました', W / 2, 1790);
}

function drawBalloon(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 1.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 1.18);
  ctx.quadraticCurveTo(cx + r * 0.4, cy + r * 1.7, cx, cy + r * 2.2);
  ctx.stroke();
  ctx.restore();
}

function drawScoreRing(ctx, cx, cy, r, score, color) {
  const start = -Math.PI / 2;
  const end = start + (score / 100) * Math.PI * 2;

  ctx.save();
  ctx.lineWidth = 34;
  ctx.lineCap = 'round';

  ctx.strokeStyle = '#eae7f5';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.stroke();
  ctx.restore();

  // 数字と % をまとめて中央に置く
  ctx.fillStyle = color;
  ctx.font = '800 130px sans-serif';
  const numWidth = ctx.measureText(String(score)).width;
  ctx.font = '800 46px sans-serif';
  const pctWidth = ctx.measureText('%').width;
  const totalWidth = numWidth + 12 + pctWidth;

  ctx.textAlign = 'left';
  const left = cx - totalWidth / 2;
  ctx.font = '800 130px sans-serif';
  ctx.fillText(String(score), left, cy + 34);
  ctx.font = '800 46px sans-serif';
  ctx.fillText('%', left + numWidth + 12, cy + 34);
  ctx.textAlign = 'center';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = [];
  let line = '';

  for (const char of text.split('')) {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line += char;
    }
  }
  if (line) lines.push(line);

  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

document.getElementById('downloadBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'birthday-certificate.png';
  link.href = document.getElementById('certCanvas').toDataURL('image/png');
  link.click();
});

/* ============================================================
   紙吹雪
   ============================================================ */
function fireConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = Array.from({ length: 130 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.4,
    size: 5 + Math.random() * 8,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    vy: 2.5 + Math.random() * 3.5,
    vx: -1.8 + Math.random() * 3.6,
    rot: Math.random() * 360,
    vr: -7 + Math.random() * 14,
  }));

  let frame = 0;
  const MAX = 170;

  (function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    frame++;
    if (frame < MAX) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
}

/* ============================================================
   初期化
   ============================================================ */
async function showIntroAverage() {
  try {
    const rows = await fetchWishes();
    if (!rows.length) return;
    const avg = rows.reduce((s, r) => s + (r.elapsed_ms || 0), 0) / rows.length / 1000;
    document.getElementById('avgSecInline').textContent = avg.toFixed(1);
  } catch {
    document.getElementById('avgSecInline').textContent = '4.2';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('personName').textContent = CONFIG.personName;
  renderBalloons();
  renderTemplates();
  renderHandleSuggestions();
  restoreHandle();
  showIntroAverage();

  document.getElementById('submitBtn').addEventListener('click', handleSubmit);
});
