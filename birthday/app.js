const STORAGE_KEY = 'goku-birthday-wishes';
const GOAL = 100;
const pageLoadedAt = Date.now();
let selectedTemplate = '';

// データ管理
function loadWishes() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

function saveWishes(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ランク判定（ページを開いてから送信までの秒数）
function computeRank(seconds) {
  if (seconds <= 5) return 'S';
  if (seconds <= 15) return 'A';
  if (seconds <= 30) return 'B';
  return 'C';
}

// テンプレートチップ選択
document.getElementById('templates').addEventListener('click', (e) => {
  if (!e.target.classList.contains('chip')) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  e.target.classList.add('active');
  selectedTemplate = e.target.textContent;
  document.getElementById('message').value = selectedTemplate;
});

// 送信
document.getElementById('submitBtn').addEventListener('click', () => {
  const name = document.getElementById('name').value.trim();
  const message = document.getElementById('message').value.trim();

  if (!name || !message) {
    alert('お名前とメッセージを入力してください');
    return;
  }

  const elapsedSeconds = Math.max(0, (Date.now() - pageLoadedAt) / 1000);
  const rank = computeRank(elapsedSeconds);

  const wish = {
    id: Date.now(),
    name,
    message,
    elapsedSeconds,
    rank,
    timestamp: new Date().toISOString(),
  };

  const data = loadWishes();
  data.unshift(wish);
  saveWishes(data);

  document.getElementById('name').value = '';
  document.getElementById('message').value = '';
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));

  renderKPIs();
  renderTable();
  drawCertificate(wish);
  fireConfetti();

  document.getElementById('certSection').hidden = false;
  document.getElementById('certSection').scrollIntoView({ behavior: 'smooth', block: 'center' });

  renderChart();
});

// KPI描画
function renderKPIs() {
  const data = loadWishes();
  const count = data.length;
  const rate = Math.min(100, Math.round((count / GOAL) * 100));
  const avgSpeed = count
    ? (data.reduce((sum, w) => sum + w.elapsedSeconds, 0) / count).toFixed(1)
    : '-';

  document.getElementById('kpiCount').textContent = count;
  document.getElementById('kpiGoal').textContent = GOAL;
  document.getElementById('kpiRate').textContent = rate + '%';
  document.getElementById('kpiBar').style.width = rate + '%';
  document.getElementById('kpiSpeed').textContent = avgSpeed;
}

// テーブル描画
function renderTable() {
  const data = loadWishes();
  const tbody = document.getElementById('tableBody');

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#666;padding:28px;">まだ祝福がありません。一番乗りを目指そう🎉</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(w => {
    const time = new Date(w.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    return `
      <tr>
        <td>${time}</td>
        <td>${escapeHtml(w.name)}</td>
        <td>${escapeHtml(w.message)}</td>
        <td>${w.elapsedSeconds.toFixed(1)}秒</td>
        <td class="rank-${w.rank}">${w.rank}</td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// グラフ描画（時間帯別）
let chartInstance = null;

function renderChart() {
  if (typeof Chart === 'undefined') return;
  const data = loadWishes();
  const hourCounts = new Array(24).fill(0);
  data.forEach(w => {
    const hour = new Date(w.timestamp).getHours();
    hourCounts[hour]++;
  });

  const labels = hourCounts.map((_, i) => `${i}時`);

  const ctx = document.getElementById('wishChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'おめでとう件数',
        data: hourCounts,
        backgroundColor: '#d4af37',
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#999' }, grid: { color: '#2a2a2a' } },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: '#999' },
          grid: { color: '#2a2a2a' },
        }
      }
    }
  });
}

// 祝福証明書の描画
function drawCertificate(wish) {
  const canvas = document.getElementById('certCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // 背景
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#1a1a1a');
  bg.addColorStop(1, '#2a1f00');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 枠
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 4;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, w - 52, h - 52);

  ctx.textAlign = 'center';

  // タイトル
  ctx.fillStyle = '#d4af37';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('CERTIFICATE OF CONGRATULATION', w / 2, 75);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#999';
  ctx.fillText('🎂 GOKU生誕祭 Ops Center 公式発行', w / 2, 98);

  // ランクバッジ
  ctx.beginPath();
  ctx.arc(w / 2, 155, 42, 0, Math.PI * 2);
  ctx.fillStyle = '#0d0d0d';
  ctx.fill();
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(wish.rank, w / 2, 172);

  // 本文
  ctx.fillStyle = '#f5f5f0';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(`${wish.name} さん`, w / 2, 235);

  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#ccc';
  ctx.fillText('が最速レーンでGOKUに祝福を送信しました', w / 2, 260);

  ctx.font = 'italic 17px sans-serif';
  ctx.fillStyle = '#ffd76a';
  wrapText(ctx, `「${wish.message}」`, w / 2, 300, w - 140, 24);

  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#999';
  const dateStr = new Date(wish.timestamp).toLocaleString('ja-JP');
  ctx.fillText(`処理速度: ${wish.elapsedSeconds.toFixed(1)}秒　|　発行日時: ${dateStr}`, w / 2, h - 40);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.split('');
  let line = '';
  let lines = [];
  for (const char of chars) {
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  lines = lines.slice(0, 2);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

// 証明書ダウンロード
document.getElementById('downloadBtn').addEventListener('click', () => {
  const canvas = document.getElementById('certCanvas');
  const link = document.createElement('a');
  link.download = 'goku-birthday-certificate.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// 紙吹雪エフェクト
function fireConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#d4af37', '#ffd76a', '#ff6b6b', '#6bd4ff', '#b8ff6b'];

  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.3,
    size: 4 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    speedY: 2 + Math.random() * 3,
    speedX: -2 + Math.random() * 4,
    rotation: Math.random() * 360,
    rotationSpeed: -6 + Math.random() * 12,
  }));

  let frame = 0;
  const maxFrames = 150;

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.speedX;
      p.y += p.speedY;
      p.rotation += p.rotationSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });
    frame++;
    if (frame < maxFrames) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  animate();
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  renderKPIs();
  renderTable();
  if (typeof Chart !== 'undefined') renderChart();
  window.addEventListener('resize', () => {
    const canvas = document.getElementById('confettiCanvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
});
