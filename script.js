const regions = {
  "アフリカ": ["ナイジェリア", "南アフリカ", "エジプト"],
  "ユーラシア": ["ロシア", "中国", "ウクライナ"],
  "オーストラリア": ["オーストラリア"],
  "北アメリカ": ["アメリカ合衆国", "カナダ", "メキシコ"],
  "南アメリカ": ["ブラジル", "アルゼンチン", "コロンビア"],
  "その他地域": ["日本", "韓国", "イラン"]
};

let selectedRegion = null;

function toggleRegion(region) {
  selectedRegion = selectedRegion === region ? null : region;
  renderRegions();
}

function renderRegions() {
  const container = document.getElementById("regions");
  container.innerHTML = "";

  // Home をテキストとして追加（ボタンではなく）
  const homeDiv = document.createElement("div");
  homeDiv.className = "region static-home";
  homeDiv.textContent = "Home";
  container.appendChild(homeDiv);

  Object.entries(regions).forEach(([region, countries]) => {
    // カテゴリ（地域）表示
    const regionDiv = document.createElement("div");
    regionDiv.className = "region";
    regionDiv.textContent = region;
    regionDiv.onclick = () => toggleRegion(region);
    container.appendChild(regionDiv);

    // 区切り線
    const hr = document.createElement("hr");
    hr.className = "region-divider";
    container.appendChild(hr);

    // 国リスト
    if (selectedRegion === region) {
      const ul = document.createElement("ul");
      ul.className = "country-list";
      countries.forEach((country) => {
        const li = document.createElement("li");
        li.className = "country-item";
        li.textContent = country;
        ul.appendChild(li);
      });
      container.appendChild(ul);
    }
  });
}



fetch('data.json')
  .then(res => res.json())
  .then(data => {
    const tbody = document.getElementById('news-table-body');
    data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.date}</td>
        <td>${item.country}</td>
        <td>${item.event}</td>
        <td>${item.tag}</td>
        <td><a href="${item.source}" target="_blank">リンク</a></td>
      `;
      tbody.appendChild(row);
    });
  })
  .catch(err => console.error('データ読み込みエラー:', err));

  renderRegions();

  const map = L.map('map').setView([20, 0], 2); // 世界中心

// タイルレイヤーの追加（OpenStreetMapを使用）
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

