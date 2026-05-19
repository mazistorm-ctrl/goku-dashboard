// データ管理
function loadData() {
  const data = localStorage.getItem('goku-sales');
  return data ? JSON.parse(data) : [];
}

function saveData(data) {
  localStorage.setItem('goku-sales', JSON.stringify(data));
}

// 売上保存
function saveSales() {
  const date = document.getElementById('date').value;
  const sales = document.getElementById('sales').value;
  const customers = document.getElementById('customers').value;
  const memo = document.getElementById('memo').value;

  if (!date || !sales || !customers) {
    alert('日付・売上金額・客数は必須です');
    return;
  }

  const data = loadData();
  data.push({
    id: Date.now(),
    date,
    sales: parseInt(sales),
    customers: parseInt(customers),
    memo
  });

  data.sort((a, b) => b.date.localeCompare(a.date));
  saveData(data);

  // フォームをリセット
  document.getElementById('sales').value = '';
  document.getElementById('customers').value = '';
  document.getElementById('memo').value = '';

  renderTable();
  renderChart();
  alert('保存しました！');
}

// テーブル描画
function renderTable() {
  const data = loadData();
  const tbody = document.getElementById('tableBody');

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:32px;">データがありません</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(row => {
    const unitPrice = Math.round(row.sales / row.customers);
    return `
      <tr>
        <td>${row.date}</td>
        <td>¥${row.sales.toLocaleString()}</td>
        <td>${row.customers}名</td>
        <td>¥${unitPrice.toLocaleString()}</td>
        <td>${row.memo || '-'}</td>
        <td><button class="btn-delete" onclick="deleteRow(${row.id})">削除</button></td>
      </tr>
    `;
  }).join('');
}

// 削除
function deleteRow(id) {
  if (!confirm('削除しますか？')) return;
  const data = loadData().filter(row => row.id !== id);
  saveData(data);
  renderTable();
  renderChart();
}

// グラフ描画
let chartInstance = null;

function renderChart() {
  const data = loadData().slice(0, 30).reverse();

  const labels = data.map(row => row.date.slice(5));
  const values = data.map(row => row.sales);

  const ctx = document.getElementById('salesChart').getContext('2d');

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '売上金額（円）',
        data: values,
        backgroundColor: '#b8860b',
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: val => '¥' + val.toLocaleString()
          }
        }
      }
    }
  });
}

// CSVエクスポート
function exportCSV() {
  const data = loadData();
  if (data.length === 0) {
    alert('データがありません');
    return;
  }

  const header = ['日付', '売上金額', '客数', '客単価', 'メモ'];
  const rows = data.map(row => [
    row.date,
    row.sales,
    row.customers,
    Math.round(row.sales / row.customers),
    row.memo || ''
  ]);

  const csv = [header, ...rows]
    .map(r => r.join(','))
    .join('\n');

  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `goku-sales-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('date').value = today;
  renderTable();
  renderChart();
});