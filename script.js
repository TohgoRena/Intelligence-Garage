/**
 * GDELTデータ可視化スクリプト (3D Globe版)
 *
 * このスクリプトは、GDELTから最新イベントデータを取得し、
 * globe.glライブラリを使って3Dの地球儀上に関係性をアニメーション付きの線で描き、
 * 詳細をテーブルに表示します。
 *
 * --- 修正内容 ---
 * - eventオブジェクトをGDELTの全列に対応させ、より詳細なデータを格納するように変更。
 * - 地球儀上の線の色を、記事の論調を示す `avgTone` に基づいて決定するように変更 (赤:否定的 〜 緑:肯定的)。
 * - イベントリストの各行の背景色を、イベントの性質を示す `GoldsteinScale` に基づいて薄く色付け (赤:紛争 〜 青:協力)。
 * - CAMEOイベントコードの日本語マッピングを追加。
 * - 'cameo-event-codes.json' を読み込み、イベントコードを日本語名に変換して表示。
 * - テーブルの「イベント概要」列と、地球儀上のツールチップの両方に適用。
 *
 * 修正履歴:
 * - 表示ライブラリをLeafletから3Dのglobe.glに全面的に変更。
 * - 地球儀のテクスチャや背景画像を設定し、視覚的な品質を向上。
 * - 関係性を表す線をアニメーション付きのアーク（円弧）として描画。
 * - アークにマウスオーバーすると詳細情報がツールチップで表示されるように変更。
 * - CORSエラーを回避するため、画像URLに 'https:' プロトコルを明記。
 */

// DOMが完全に読み込まれたら処理を開始
document.addEventListener('DOMContentLoaded', () => {

    // --- グローバル変数の設定 ---
    const newsTableBody = document.getElementById('news-table-body');
    const PROXY_URL = 'https://corsproxy.io/?';
    let cameoCodes = {};
    let countryCoordinates = {};

    // --- 3D Globeの初期化 ---
    const globe = Globe()
      (document.getElementById('map'))
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .arcsData([]) // 初期データは空に設定
      // ★★★ 修正: 線の色をAvgToneに基づいて動的に決定 ★★★
      .arcColor(d => getAvgToneColor(d.event.avgTone))
      .arcStroke(0.4) // アークの線の太さ
      .arcDashLength(0.5) // 破線の長さ
      .arcDashGap(0.2) // 破線の間隔
      .arcDashAnimateTime(2500) // アニメーションの速度 (ミリ秒)
      .arcLabel(d => { // アークにマウスオーバーした時のラベル
          const event = d.event;
          const actor1Display = event.actor1.name || event.actor1.code || 'N/A';
          const actor2Display = event.actor2.name || event.actor2.code || 'N/A';
          const actor1cc = event.actor1.countryCode || '';
          const actor2cc = event.actor2.countryCode || '';
          const eventName = (cameoCodes && event.eventCode && cameoCodes[event.eventCode])
                ? cameoCodes[event.eventCode].name_ja
                : '詳細不明';

          return `
              <b>関係:</b> ${actor1Display}(${countryCoordinates[actor1cc]?.icon || '❓'}) → ${actor2Display}(${countryCoordinates[actor2cc]?.icon || '❓'})<br>
              <b>イベント:</b> ${eventName} (${event.eventCode})<br>
              <b>AvgTone:</b> ${event.avgTone.toFixed(2)}<br>
              <b>GoldsteinScale:</b> ${event.goldsteinScale}
          `;
      });

    // 地球儀の視点を調整
    globe.pointOfView({ altitude: 3.5 }, 1000);

    /**
     * GDELTデータの取得から表示までの一連の処理を実行するメイン関数
     */
    async function fetchDataAndProcess() {
        console.log('処理を開始します...');
        newsTableBody.innerHTML = '';

        try {
            console.log('0/5: CAMEOコード定義ファイルを読み込み中...');
            const cameoResponse = await fetch('cameo-event-codes.json');
            if (!cameoResponse.ok) throw new Error(`CAMEOコード定義ファイルの取得に失敗 (Status: ${cameoResponse.status})`);
            cameoCodes = await cameoResponse.json();
            console.log('0/5: 国コード定義ファイルを読み込み中...');
            const countryCodeResponse = await fetch('country-coordinates.json');
            if (!countryCodeResponse.ok) throw new Error(`国コード定義ファイルの取得に失敗 (Status: ${countryCodeResponse.status})`);
            countryCoordinates = await countryCodeResponse.json();

            console.log('1/5: 更新情報ファイルを取得中...');
            const updateInfoUrl = 'http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt';
            const response = await fetch(PROXY_URL + encodeURIComponent(updateInfoUrl));
            if (!response.ok) throw new Error(`更新情報ファイルの取得に失敗 (Status: ${response.status})`);
            const textData = await response.text();

            const zipUrlMatch = textData.match(/http:\/\/data\.gdeltproject\.org\/gdeltv2\/\d+\.translation\.export\.CSV\.zip/);
            if (!zipUrlMatch) throw new Error('更新情報ファイル内に有効なZIP URLが見つかりませんでした。');
            const zipUrl = zipUrlMatch[0];
            console.log('取得対象のZIP URL:', zipUrl);

            console.log('2/5: ZIPファイルをダウンロード中...');
            const zipResponse = await fetch(PROXY_URL + encodeURIComponent(zipUrl));
            if (!zipResponse.ok) throw new Error(`ZIPファイルのダウンロードに失敗 (Status: ${zipResponse.status})`);
            const zipData = await zipResponse.arrayBuffer();

            console.log('3/5: ZIPファイルを展開中...');
            const jszip = new JSZip();
            const zip = await jszip.loadAsync(zipData);
            const csvFileName = Object.keys(zip.files)[0];
            if (!csvFileName) throw new Error('ZIPファイル内にCSVファイルが見つかりませんでした。');
            const csvContent = await zip.file(csvFileName).async('string');

            console.log('4/5: データを解析して表示中...');
            const events = parseGdeltCsv(csvContent);

            const arcData = [];
            let processedCount = 0;

            events.forEach(event => {
                const actor1Code = event.actor1.countryCode;
                const actor2Code = event.actor2.countryCode;

                if (actor1Code && actor1Code.trim() && actor2Code && actor2Code.trim()) {
                    const startCoords = countryCoordinates[actor1Code];
                    const endCoords = countryCoordinates[actor2Code];

                    if (startCoords && endCoords && actor1Code !== actor2Code) {
                        arcData.push({
                            startLat: startCoords.lat,
                            startLng: startCoords.lng,
                            endLat: endCoords.lat,
                            endLng: endCoords.lng,
                            event: event // イベントオブジェクト全体を渡す
                        });

                        addNewsToTable(event);
                        processedCount++;
                    }
                }
            });

            globe.arcsData(arcData);
            console.log(`5/5: 処理完了。${processedCount}件のイベントを読み込みました。`);

        } catch (error) {
            console.error('エラーが発生しました:', error);
            const row = newsTableBody.insertRow();
            const cell = row.insertCell(0);
            cell.colSpan = 5;
            cell.textContent = `エラー: ${error.message}。詳細はブラウザのコンソールを確認してください。`;
            cell.style.color = 'red';
        }
    }

    /**
     * ★★★ 修正: GDELTのCSVコンテンツを解析し、完全なイベントオブジェクトの配列を返す ★★★
     * @param {string} csvContent - タブ区切りのCSV文字列
     * @returns {Array<Object>} - 解析されたイベントオブジェクトの配列
     */
    function parseGdeltCsv(csvContent) {
        const events = [];
        const rows = csvContent.trim().split('\n');

        for (const row of rows) {
            const columns = row.split('\t');
            if (columns.length < 61) continue;

            const event = {
                // イベントIDと日付属性
                globalEventID: columns[0],
                day: columns[1],
                monthYear: columns[2],
                year: columns[3],
                fractionDate: parseFloat(columns[4]),
                // アクター1属性
                actor1: {
                    code: columns[5], name: columns[6], countryCode: columns[7],
                    knownGroupCode: columns[8], ethnicCode: columns[9], religion1Code: columns[10],
                    religion2Code: columns[11], type1Code: columns[12], type2Code: columns[13],
                    type3Code: columns[14],
                },
                // アクター2属性
                actor2: {
                    code: columns[15], name: columns[16], countryCode: columns[17],
                    knownGroupCode: columns[18], ethnicCode: columns[19], religion1Code: columns[20],
                    religion2Code: columns[21], type1Code: columns[22], type2Code: columns[23],
                    type3Code: columns[24],
                },
                // イベントアクション属性
                isRootEvent: parseInt(columns[25], 10),
                eventCode: columns[26],
                eventBaseCode: columns[27],
                eventRootCode: columns[28],
                quadClass: parseInt(columns[29], 10),
                goldsteinScale: parseFloat(columns[30]),
                numMentions: parseInt(columns[31], 10),
                numSources: parseInt(columns[32], 10),
                numArticles: parseInt(columns[33], 10),
                avgTone: parseFloat(columns[34]),
                // イベント地理属性 (Actor1)
                actor1Geo: {
                    type: parseInt(columns[35], 10), fullName: columns[36], countryCode: columns[37],
                    adm1Code: columns[38], adm2Code: columns[39], lat: parseFloat(columns[40]),
                    lon: parseFloat(columns[41]), featureID: columns[42],
                },
                // イベント地理属性 (Actor2)
                actor2Geo: {
                    type: parseInt(columns[43], 10), fullName: columns[44], countryCode: columns[45],
                    adm1Code: columns[46], adm2Code: columns[47], lat: parseFloat(columns[48]),
                    lon: parseFloat(columns[49]), featureID: columns[50],
                },
                // イベント地理属性 (Action)
                actionGeo: {
                    type: parseInt(columns[51], 10), fullName: columns[52], countryCode: columns[53],
                    adm1Code: columns[54], lat: parseFloat(columns[55]), lon: parseFloat(columns[56]),
                    featureID: columns[58],
                },
                // データ管理フィールド
                dateAdded: columns[59],
                sourceUrl: columns[60],
            };
            events.push(event);
        }
        return events;
    }

    /**
     * 追加: AvgToneスコアに基づいて赤(否定的)から緑(肯定的)へのグラデーション色を返す
     * @param {number} score - AvgToneスコア (-100 to +100)
     * @returns {string} - CSSのカラーコード (rgba)
     */
    function getAvgToneColor(score) {
        if (isNaN(score)) return 'rgba(128, 128, 128, 0.7)'; // 不明な場合はグレー

        const alpha = 0.7;
        let r, g, b;

        if (score >= 0) {
            // 中立(黄色)から肯定的(緑)へ
            const factor = score / 10.0;
            r = Math.round(255 * (1 - factor)); // 255 -> 0
            g = 255;
            b = 0;
        } else {
            // 中立(黄色)から否定的(赤)へ
            const factor = Math.abs(score) / 10.0;
            r = 255;
            g = Math.round(255 * (1 - factor)); // 255 -> 0
            b = 0;
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }


    /**
     * Goldsteinスコアに基づいて薄い背景色を返す
     * @param {number} score - Goldsteinスコア (-10 to +10)
     * @returns {string} - CSSのカラーコード (rgba)
     */
    function getGoldsteinBackgroundColor(score) {
        if (isNaN(score)) return 'transparent'; // 不明な場合は色なし

        const alpha = 0.12; // 薄い色にするための低い透明度
        let r, g, b;

        if (score >= 0) { // 協力的なイベント (青系)
            const factor = Math.min(score, 10) / 10.0;
            r = 230 - 30 * factor;
            g = 230 + 25 * factor;
            b = 255;
        } else { // 紛争的なイベント (赤系)
            const factor = Math.abs(score) / 10.0;
            r = 255;
            g = 230 - 30 * factor;
            b = 230 - 30 * factor;
        }
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
    }


    /**
     * ニュースリストのテーブルに1行追加する
     * @param {Object} event - イベントオブジェクト
     */
    function addNewsToTable(event) {
        const row = newsTableBody.insertRow();
        // ★★★ 修正: GoldsteinScaleに基づいて背景色を設定 ★★★
        row.style.backgroundColor = getGoldsteinBackgroundColor(event.goldsteinScale);

        const date = event.day;
        const formattedDate = date ? `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}` : 'N/A';
        row.insertCell(0).textContent = formattedDate;

        const actor1cc = event.actor1.countryCode || '';
        const actor2cc = event.actor2.countryCode || '';
        const actor1Name = countryCoordinates[actor1cc]?.name_jp || actor1cc;
        const actor2Name = countryCoordinates[actor2cc]?.name_jp || actor2cc;
        row.insertCell(1).textContent = `${actor1Name}→${actor2Name}`;

        const actor1Display = event.actor1.name || event.actor1.code || '不明な主体';
        const actor2Display = event.actor2.name || event.actor2.code || '不明な対象';
        row.insertCell(2).textContent = `${actor1Display}が${actor2Display}に対し行動`;

        const eventCode = event.eventCode;
        const eventName = (cameoCodes && eventCode && cameoCodes[eventCode])
            ? cameoCodes[eventCode].name_ja
            : eventCode || 'N/A';
        row.insertCell(3).textContent = eventName;

        const urlCell = row.insertCell(4);
        if (event.sourceUrl && event.sourceUrl !== 'NULL') {
            const link = document.createElement('a');
            link.href = event.sourceUrl;
            link.textContent = '記事を読む';
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'article-link'; 
            urlCell.appendChild(link);
        } else {
            urlCell.textContent = 'N/A';
        }
    }

    // --- 処理の実行 ---
    fetchDataAndProcess();
});


const regions = {
    "アジア": {
        "東アジア": ["日本", "中国", "韓国", "北朝鮮", "モンゴル", "台湾"],
        "東南アジア": ["ベトナム", "タイ", "マレーシア", "インドネシア", "フィリピン", "シンガポール", "カンボジア", "ラオス", "ミャンマー", "ブルネイ", "東ティモール"],
        "南アジア": ["インド", "パキスタン", "バングラデシュ", "ネパール", "ブータン", "スリランカ", "モルディブ"],
        "北アジア": ["ロシア"],
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

const countryNameMap = {
    "日本": "Japan",
    "アメリカ": "United States",
    "イギリス": "United Kingdom",
    "ドイツ": "Germany",
    "フランス": "France",
    "ロシア": "Russia",
    "オーストラリア": "Australia",
    "カナダ": "Canada",
    "中国": "China",
    "韓国": "South Korea",
    "北朝鮮": "North Korea",
    "インド": "India",
    "ウクライナ": "Ukraine",
    "トルコ": "Turkey",
    "イタリア": "Italy",
    "スペイン": "Spain",
    "ブラジル": "Brazil",
    "アルゼンチン": "Argentina",
    "イスラエル": "Israel",
    "イラン": "Iran",
    "サウジアラビア": "Saudi Arabia",
    "メキシコ": "Mexico",
    "エジプト": "Egypt",
    "南アフリカ": "South Africa",
    "カタール": "Qatar",
    "アラブ首長国連邦": "United Arab Emirates",
    "サウジアラビア": "Saudi Arabia",
    "パレスチナ": "Palestine",
};

let selectedRegion = null;
let countryCoords = {};

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

renderRegions();