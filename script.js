const regions = {
    "アジア": {
        "東アジア": ["日本", "中国", "韓国", "北朝鮮", "モンゴル", "台湾"],
        "東南アジア": ["ベトナム", "タイ", "マレーシア", "インドネシア", "フィリピン", "シンガポール", "カンボジア", "ラオス", "ミャンマー", "ブルネイ", "東ティモール"],
        "南アジア": ["インド", "パキスタン", "バングラデシュ", "ネパール", "ブータン", "スリランカ", "モルディブ"],
        "北アジア": ["ロシア"], // 通例北アジアはロシアのみ
        "中央アジア": ["カザフスタン", "ウズベキスタン", "キルギス", "タジキスタン", "トルクメニスタン"],
        "西アジア": ["サウジアラビア", "イラン", "イラク", "シリア", "イスラエル", "トルコ", "ヨルダン", "レバノン", "クウェート", "カタール", "UAE", "オマーン", "イエメン", "パレスチナ", "バーレーン", "キプロス"]
    },
    "ヨーロッパ": [
        "イギリス", "フランス", "ドイツ", "イタリア", "スペイン", "ポルトガル", "ベルギー", "オランダ", "ルクセンブルク",
        "スイス", "オーストリア", "デンマーク", "ノルウェー", "スウェーデン", "フィンランド", "ポーランド", "チェコ", "スロバキア",
        "ハンガリー", "ルーマニア", "ブルガリア", "クロアチア", "スロベニア", "セルビア", "ボスニア・ヘルツェゴビナ", "モンテネグロ", "マケドニア",
        "アルバニア", "ギリシャ", "ウクライナ", "ベラルーシ", "リトアニア", "ラトビア", "エストニア", "モルドバ", "アイルランド", "アイスランド"
    ],
    "アフリカ": [
        "エジプト", "ナイジェリア", "南アフリカ", "ケニア", "エチオピア", "アルジェリア", "モロッコ", "スーダン", "ガーナ", "ウガンダ" // 他多数
    ],
    "北アメリカ": [
        "アメリカ合衆国", "カナダ", "メキシコ", "グアテマラ", "キューバ", "ジャマイカ", "パナマ", "コスタリカ", "バハマ"
    ],
    "南アメリカ": [
        "ブラジル", "アルゼンチン", "チリ", "ペルー", "コロンビア", "ボリビア", "パラグアイ", "ウルグアイ", "ベネズエラ", "エクアドル"
    ],
    "オセアニア": [
        "オーストラリア", "ニュージーランド", "パプアニューギニア", "フィジー", "ソロモン諸島", "サモア", "トンガ", "バヌアツ", "ミクロネシア"
    ]
};

let selectedRegion = null;

function toggleRegion(region) {
    selectedRegion = selectedRegion === region ? null : region;
    renderRegions();
}

function renderRegions() {
    const container = document.getElementById("regions");
    container.innerHTML = "";

    Object.entries(regions).forEach(([region, subdata]) => {
        // 地域名
        const regionDiv = document.createElement("div");
        regionDiv.className = "region";
        regionDiv.textContent = region;
        regionDiv.onclick = () => toggleRegion(region);
        container.appendChild(regionDiv);

        // 展開
        if (selectedRegion === region) {
            // アジアだけ下位区分をループ
            if (region === "アジア") {
                Object.entries(subdata).forEach(([subregion, countries]) => {
                    const subDiv = document.createElement("div");
                    subDiv.className = "subregion";
                    subDiv.textContent = subregion;
                    container.appendChild(subDiv);

                    const ul = document.createElement("ul");
                    ul.className = "country-list";
                    countries.forEach((country) => {
                        const li = document.createElement("li");
                        li.className = "country-item";
                        li.textContent = country;
                        ul.appendChild(li);
                    });
                    container.appendChild(ul);
                });
            } else if (Array.isArray(subdata)) {
                const ul = document.createElement("ul");
                ul.className = "country-list";
                subdata.forEach((country) => {
                    const li = document.createElement("li");
                    li.className = "country-item";
                    li.textContent = country;
                    ul.appendChild(li);
                });
                container.appendChild(ul);
            }
        }
        // 区切り線
        const hr = document.createElement("hr");
        hr.className = "region-divider";
        container.appendChild(hr);
    });
}

function getPlatformName(url) {
  if (!url) return "";
  if (url.includes("reuters.com")) return "Reuters";
  if (url.includes("yahoo.com")) return "Yahoo";
  if (url.includes("cnn.com")) return "CNN";
  if (url.includes("sankei.com")) return "産経";
  if (url.includes("yomiuri.co.jp")) return "読売";
  if (url.includes("jiji.com")) return "時事";
  if (url.includes("afpbb.com")) return "AFP";
  // 必要なら他も追加
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "リンク";
  }
}


fetch('data.json')
    .then(res => res.json())
    .then(data => {
        const tbody = document.getElementById('news-table-body');
        data.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
        <td>${item.date}</td>
        <td>${item.countries ? item.countries.join(", ") : ""}</td>
        <td>${item.event}</td>
        <td>${item.tags ? item.tags.join(", ") : ""}</td>
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

