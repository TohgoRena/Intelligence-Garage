/**
 * GDELTデータ可視化スクリプト (Leaflet.js 2D Map版)
 *
 * このスクリプトは、GDELTから最新イベントデータを取得し、
 * Leaflet.jsライブラリを使って2Dの地図上に関係性を直線で描き、
 * 詳細をテーブルに表示します。
 * script.js (3D Globe版) の機能を2Dに移植したものです。
 *
 * --- 主な機能 ---
 * - GDELTの最新イベントデータをリアルタイムで取得。
 * - 国と国の関係性を地図上に直線で表示。
 * - 線の色は、記事の論調を示す `avgTone` に基づいて決定 (赤:否定的 〜 緑:肯定的)。
 * - イベントリストの各行の背景色を、イベントの性質を示す `GoldsteinScale` に基づいて色付け (赤系:紛争 〜 青系:協力)。
 * - CAMEOイベントコードを日本語に変換して表示。
 * - サイドバーの国名をクリックすると、その国に地図がフォーカスする機能。
 */

// DOMが完全に読み込まれたら処理を開始
document.addEventListener('DOMContentLoaded', () => {

    // --- グローバル変数の設定 ---
    const newsTableBody = document.getElementById('news-table-body');
    const PROXY_URL = 'https://corsproxy.io/?';
    let cameoCodes = {};
    let countryCoordinates = {};

    // --- Leaflet地図の初期化 ---
    const map = L.map('map', {
    worldCopyJump: true
    }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    /**
     * GDELTデータの取得から表示までの一連の処理を実行するメイン関数
     */
    async function fetchDataAndProcess() {
        console.log('処理を開始します...');
        newsTableBody.innerHTML = ''; // テーブルを初期化

        try {
            console.log('0/5: CAMEOコード定義ファイルを読み込み中...');
            const cameoResponse = await fetch('cameo-event-codes.json');
            if (!cameoResponse.ok) throw new Error(`CAMEOコード定義ファイルの取得に失敗 (Status: ${cameoResponse.status})`);
            cameoCodes = await cameoResponse.json();

            console.log('0/5: 国コード定義ファイルを読み込み中...');
            const countryCodeResponse = await fetch('country-coordinates.json');
            if (!countryCodeResponse.ok) throw new Error(`国コード定義ファイルの取得に失敗 (Status: ${countryCodeResponse.status})`);
            countryCoordinates = await countryCodeResponse.json();

            // サイドバーの国名クリックイベントを設定
            setupCountryClickListeners();

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
            let processedCount = 0;

            events.forEach(event => {
                const actor1Code = event.actor1.countryCode;
                const actor2Code = event.actor2.countryCode;

                if (actor1Code && actor1Code.trim() && actor2Code && actor2Code.trim()) {
                    const startCoords = countryCoordinates[actor1Code];
                    const endCoords = countryCoordinates[actor2Code];

                    if (startCoords && endCoords && actor1Code !== actor2Code) {
                        // Leafletで線を描画
                        const latlngs = [
                            [startCoords.lat, startCoords.lng],
                            [endCoords.lat, endCoords.lng]
                        ];
                        const color = getAvgToneColor(event.avgTone);
                        const polyline = L.polyline(latlngs, { color: color, weight: 2, opacity: 0.7 }).addTo(map);

                        // ポップアップを追加
                        const eventName = (cameoCodes && event.eventCode && cameoCodes[event.eventCode])
                            ? cameoCodes[event.eventCode].name_ja
                            : '詳細不明';
                        const popupContent = `
                            <b>関係:</b> ${countryCoordinates[actor1Code]?.name_jp || actor1Code} → ${countryCoordinates[actor2Code]?.name_jp || actor2Code}<br>
                            <b>イベント:</b> ${eventName} (${event.eventCode})<br>
                            <b>AvgTone:</b> ${event.avgTone.toFixed(2)}<br>
                            <b>GoldsteinScale:</b> ${event.goldsteinScale}
                        `;
                        polyline.bindPopup(popupContent);

                        addNewsToTable(event);
                        processedCount++;
                    }
                }
            });

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
     * GDELTのCSVコンテンツを解析し、完全なイベントオブジェクトの配列を返す
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
                globalEventID: columns[0],
                day: columns[1],
                actor1: { code: columns[5], name: columns[6], countryCode: columns[7] },
                actor2: { code: columns[15], name: columns[16], countryCode: columns[17] },
                eventCode: columns[26],
                goldsteinScale: parseFloat(columns[30]),
                avgTone: parseFloat(columns[34]),
                sourceUrl: columns[60],
            };
            events.push(event);
        }
        return events;
    }

    /**
     * AvgToneスコアに基づいて赤(否定的)から緑(肯定的)へのグラデーション色を返す
     * @param {number} score - AvgToneスコア (-100 to +100)
     * @returns {string} - CSSのカラーコード
     */
    function getAvgToneColor(score) {
        if (isNaN(score)) return '#808080'; // 不明な場合はグレー

        let r, g;
        if (score >= 0) {
            // 黄色 (255, 255, 0) から 緑 (0, 255, 0)
            const factor = Math.min(score, 10) / 10.0;
            r = Math.round(255 * (1 - factor));
            g = 255;
        } else {
            // 黄色 (255, 255, 0) から 赤 (255, 0, 0)
            const factor = Math.abs(score) / 10.0;
            r = 255;
            g = Math.round(255 * (1 - factor));
        }
        return `rgb(${r}, ${g}, 0)`;
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
            b = 255; g = 230 + 25 * (Math.min(score, 10) / 10.0); r = 230 - 30 * (Math.min(score, 10) / 10.0);
        } else { // 紛争的なイベント (赤系)
            r = 255; g = 230 - 30 * (Math.abs(score) / 10.0); b = 230 - 30 * (Math.abs(score) / 10.0);
        }
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
    }

    /**
     * ニュースリストのテーブルに1行追加する
     * @param {Object} event - イベントオブジェクト
     */
    function addNewsToTable(event) {
        const row = newsTableBody.insertRow();
        row.style.backgroundColor = getGoldsteinBackgroundColor(event.goldsteinScale);

        const date = event.day;
        const formattedDate = date ? `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}` : 'N/A';
        row.insertCell(0).textContent = formattedDate;

        const actor1cc = event.actor1.countryCode || '';
        const actor2cc = event.actor2.countryCode || '';
        const actor1Name = countryCoordinates[actor1cc]?.name_jp || actor1cc;
        const actor2Name = countryCoordinates[actor2cc]?.name_jp || actor2cc;
        row.insertCell(1).textContent = `${actor1Name}→${actor2Name}`;

        const eventCode = event.eventCode;
        const eventName = (cameoCodes && eventCode && cameoCodes[eventCode])
            ? cameoCodes[eventCode].name_ja
            : eventCode || 'N/A';
        row.insertCell(2).textContent = eventName;

        const actor1Display = event.actor1.name || event.actor1.code || '不明な主体';
        const actor2Display = event.actor2.name || event.actor2.code || '不明な対象';
        row.insertCell(3).textContent = `${actor1Display}が${actor2Display}に対し行動`;

        const urlCell = row.insertCell(4);
        if (event.sourceUrl && event.sourceUrl !== 'NULL') {
            const link = document.createElement('a');
            link.href = event.sourceUrl;
            link.textContent = '記事';
            link.target = '_blank';
            urlCell.appendChild(link);
        } else {
            urlCell.textContent = 'N/A';
        }
    }


    // --- サイドバー関連の処理 ---
    const regions = {
        "アジア": {
            "東アジア": ["日本", "中国", "韓国", "北朝鮮", "モンゴル", "台湾"],
            "東南アジア": ["ベトナム", "タイ", "マレーシア", "インドネシア", "フィリピン", "シンガポール", "カンボジア", "ラオス", "ミャンマー", "ブルネイ", "東ティモール"],
            "南アジア": ["インド", "パキスタン", "バングラデシュ", "ネパール", "ブータン", "スリランカ", "モルディブ"],
            "中央アジア": ["カザフスタン", "ウズベキスタン", "キルギス", "タジキスタン", "トルクメニスタン"],
            "西アジア": ["サウジアラビア", "イラン", "イラク", "シリア", "イスラエル", "トルコ", "ヨルダン", "レバノン", "クウェート", "カタール", "UAE", "オマーン", "イエメン", "パレスチナ", "バーレーン", "キプロス"]
        },
        "ヨーロッパ": ["イギリス", "フランス", "ドイツ", "イタリア", "スペイン", "ポルトガル", "オランダ", "ベルギー", "スイス", "オーストリア", "ロシア", "ウクライナ"],
        "北アメリカ": ["アメリカ合衆国", "カナダ", "メキシコ"],
        "南アメリカ": ["ブラジル", "アルゼンチン", "チリ", "ペルー", "コロンビア"],
        "アフリカ": ["エジプト", "ナイジェリア", "南アフリカ", "ケニア", "エチオピア"],
        "オセアニア": ["オーストラリア", "ニュージーランド"]
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
            const regionDiv = document.createElement("div");
            regionDiv.className = "region";
            regionDiv.textContent = region;
            regionDiv.onclick = () => toggleRegion(region);
            container.appendChild(regionDiv);

            if (selectedRegion === region) {
                const ul = document.createElement("ul");
                ul.className = "country-list";
                const countries = Array.isArray(subdata) ? subdata : Object.values(subdata).flat();
                
                countries.forEach((country) => {
                    const li = document.createElement("li");
                    li.className = "country-item";
                    li.textContent = country;
                    ul.appendChild(li);
                });
                container.appendChild(ul);
            }
            container.appendChild(document.createElement("hr"));
        });
    }

    function setupCountryClickListeners() {
        const regionsContainer = document.getElementById('regions');
        const jpNameToIsoMap = Object.entries(countryCoordinates).reduce((acc, [iso, data]) => {
            if (data.name_jp) acc[data.name_jp] = iso;
            return acc;
        }, {});

        regionsContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('country-item')) {
                const countryNameJa = event.target.textContent.trim();
                const isoCode = jpNameToIsoMap[countryNameJa];
                if (isoCode) {
                    focusOnCountry(isoCode);
                } else {
                     console.warn(`'${countryNameJa}'に対応する国データが見つかりません。`);
                }
            }
        });
    }

    function focusOnCountry(countryCode) {
        const coords = countryCoordinates[countryCode];
        if (coords) {
            map.setView([coords.lat, coords.lng], 5); // 緯度経度とズームレベルを指定
        } else {
            console.warn(`国コード ${countryCode} の座標が見つかりません。`);
        }
    }

    // --- 処理の実行 ---
    fetchDataAndProcess();
    renderRegions();
});