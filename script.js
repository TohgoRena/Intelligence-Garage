/**
 * GDELTデータ可視化 統合スクリプト (3D Globe / 2D Map 切り替え対応版)
 *
 * GDELTから最新イベントデータを取得し、3D地球儀 (globe.gl) または
 * 2D地図 (Leaflet.js) 上に関係性を表示します。
 * ユーザーはUIを通じて表示モードを切り替えることができます。
 *
 * --- 主な機能 ---
 * - 3D (globe.gl) と 2D (Leaflet.js) の表示モード切替機能。
 * - GDELTの最新データを一度だけ取得し、表示切替時に再利用。
 * - ★線の色はイベントのルートカテゴリ(eventRootCode)に、テーブル行の背景はイベントの性質(GoldsteinScale)に連動。
 * - CAMEOコードを日本語に変換して表示。
 * - サイドバーから国を選択すると、地図/地球儀がその国にフォーカス。
 * - 3Dモードでは国境線のハイライト機能も提供。
 * - リサイズ検知機能を追加し、表示崩れを防止。
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- グローバル変数 ---
    const newsTableBody = document.getElementById('news-table-body');
    const mapContainer = document.getElementById('map');
    const PROXY_URL = 'https://corsproxy.io/?';

    let globe = null; // 3D Globe instance
    let map = null;   // 2D Map instance
    let polylines = []; // For 2D map lines

    let cameoCodes = {};
    let countryCoordinates = {};
    let allEvents = [];
    let allCountryFeatures = [];
    let highlightedPolygon = null;

    /**
     * ========================================
     * 初期化とメイン処理
     * ========================================
     */
    async function main() {
        setupToggleButtons();
        await fetchDataAndProcess();
        renderRegions(); // サイドバーを生成
        setupCountryClickListeners();
    }

    /**
     * GDELTデータの取得と解析を行う
     */
    async function fetchDataAndProcess() {
        console.log('処理を開始します...');
        newsTableBody.innerHTML = '<tr><td colspan="5">最新のイベントデータを読み込んでいます...</td></tr>';

        try {
            // 補助ファイルの読み込み
            console.log('0/5: CAMEOコードと国座標データを読み込み中...');
            const [cameoResponse, countryCodeResponse, countriesRes] = await Promise.all([
                fetch('cameo-event-codes.json'),
                fetch('country-coordinates.json'),
                fetch('https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
            ]);
            if (!cameoResponse.ok) throw new Error('CAMEOコード定義ファイルの取得に失敗');
            if (!countryCodeResponse.ok) throw new Error('国コード定義ファイルの取得に失敗');
            if (!countriesRes.ok) throw new Error('国境データ(GeoJSON)の取得に失敗');

            cameoCodes = await cameoResponse.json();
            countryCoordinates = await countryCodeResponse.json();
            const countriesData = await countriesRes.json();
            allCountryFeatures = countriesData.features;

            // GDELTデータの取得
            console.log('1/5: 更新情報ファイルを取得中...');
            const updateInfoUrl = 'http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt';
            const response = await fetch(PROXY_URL + encodeURIComponent(updateInfoUrl));
            if (!response.ok) throw new Error(`更新情報ファイルの取得に失敗 (Status: ${response.status})`);
            const textData = await response.text();

            const zipUrlMatch = textData.match(/http:\/\/data\.gdeltproject\.org\/gdeltv2\/\d+\.translation\.export\.CSV\.zip/);
            if (!zipUrlMatch) throw new Error('更新情報ファイル内に有効なZIP URLが見つかりませんでした。');
            const zipUrl = zipUrlMatch[0];

            console.log('2/5: ZIPファイルをダウンロード中...');
            const zipResponse = await fetch(PROXY_URL + encodeURIComponent(zipUrl));
            if (!zipResponse.ok) throw new Error(`ZIPファイルのダウンロードに失敗 (Status: ${zipResponse.status})`);
            const zipData = await zipResponse.arrayBuffer();

            console.log('3/5: ZIPファイルを展開中...');
            const jszip = new JSZip();
            const zip = await jszip.loadAsync(zipData);
            const csvFileName = Object.keys(zip.files)[0];
            const csvContent = await zip.file(csvFileName).async('string');

            console.log('4/5: データを解析して表示準備...');
            allEvents = parseGdeltCsv(csvContent);

            // 初期表示（2D）
            init3D();

        } catch (error) {
            console.error('エラーが発生しました:', error);
            newsTableBody.innerHTML = `<tr><td colspan="5" style="color: red;">エラー: ${error.message}</td></tr>`;
        }
    }

    /**
     * ========================================
     * 表示モード切替
     * ========================================
     */
    function setupToggleButtons() {
        const btn3d = document.getElementById('toggle-3d');
        const btn2d = document.getElementById('toggle-2d');

        btn3d.addEventListener('click', () => {
            if (btn3d.classList.contains('active')) return;
            switchTo3D();
            btn3d.classList.add('active');
            btn2d.classList.remove('active');
        });

        btn2d.addEventListener('click', () => {
            if (btn2d.classList.contains('active')) return;
            switchTo2D();
            btn2d.classList.add('active');
            btn3d.classList.remove('active');
        });
    }

    function switchTo3D() {
        console.log("Switching to 3D view");
        if (map) {
            map.remove();
            map = null;
        }
        mapContainer.innerHTML = '';
        init3D();
    }

    function switchTo2D() {
        console.log("Switching to 2D view");
        if (globe) {
            globe._destructor();
            globe = null;
        }
        mapContainer.innerHTML = '';
        init2D();
    }


    /**
     * ========================================
     * 3D Globe (globe.gl) 関連
     * ========================================
     */
    function init3D() {
        const { width, height } = mapContainer.getBoundingClientRect();
        globe = Globe()(mapContainer)
            .width(width)
            .height(height)
            .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
            .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
            .polygonsData(allCountryFeatures)
            .polygonCapColor(d => d === highlightedPolygon ? 'rgba(255, 255, 0, 0.2)' : 'rgba(200, 200, 200, 0.1)')
            .polygonSideColor(() => 'rgba(0, 0, 0, 0)')
            .polygonStrokeColor(d => d === highlightedPolygon ? 'yellow' : '#ccc')
            .polygonLabel(({ properties: d }) => `<b>${d.ADMIN} (${d.ISO_A3})</b>`)
            .arcsData([])
            .arcColor(d => getEventRootCodeColor(d.event.eventRootCode)) // ★変更: eventRootCodeで色分け
            .arcStroke(0.4)
            .arcDashLength(0.5)
            .arcDashGap(0.2)
            .arcDashAnimateTime(2500)
            .arcLabel(d => { // ★変更: ラベル内容を更新
                const event = d.event;
                const actor1Display = event.actor1.name || event.actor1.code || 'N/A';
                const actor2Display = event.actor2.name || event.actor2.code || 'N/A';
                const eventName = (cameoCodes[event.eventCode]) ? cameoCodes[event.eventCode].name_ja : '詳細不明';
                const rootEventName = (cameoCodes[event.eventRootCode]) ? cameoCodes[event.eventRootCode].name_ja : '不明なカテゴリ';
                return `<b>関係:</b> ${actor1Display} → ${actor2Display}<br><b>カテゴリ:</b> ${rootEventName} (${event.eventRootCode})<br><b>イベント詳細:</b> ${eventName}`;
            });

        globe.pointOfView({ altitude: 3.5 }, 1000);
        renderDataOnMap(); // データを描画
    }

    /**
     * ========================================
     * 2D Map (Leaflet) 関連
     * ========================================
     */
    function init2D() {
        map = L.map('map', { worldCopyJump: true }).setView([20, 0], 2);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(map);
        renderDataOnMap(); // データを描画
    }

    /**
     * ========================================
     * データ描画と更新 (共通)
     * ========================================
     */
    function renderDataOnMap() {
        newsTableBody.innerHTML = ''; // テーブルをクリア
        let processedCount = 0;

        const arcData3D = [];
        if (map) polylines.forEach(p => p.remove()); // 2Dの既存の線をクリア
        polylines = [];

        allEvents.forEach(event => {
            const actor1Code = event.actor1.countryCode;
            const actor2Code = event.actor2.countryCode;

            if (actor1Code && actor2Code && actor1Code !== actor2Code) {
                const startCoords = countryCoordinates[actor1Code];
                const endCoords = countryCoordinates[actor2Code];

                if (startCoords && endCoords) {
                    // 3D Globe用データ
                    if (globe) {
                        arcData3D.push({
                            startLat: startCoords.lat,
                            startLng: startCoords.lng,
                            endLat: endCoords.lat,
                            endLng: endCoords.lng,
                            event: event
                        });
                    }
                    // 2D Map用データ
                    if (map) {
                        const latlngs = [[startCoords.lat, startCoords.lng], [endCoords.lat, endCoords.lng]];
                        const color = getEventRootCodeColor(event.eventRootCode); // ★変更: eventRootCodeで色分け
                        const polyline = L.polyline(latlngs, { color: color, weight: 1.5, opacity: 0.6 }).addTo(map);

                        const eventName = (cameoCodes[event.eventCode]) ? cameoCodes[event.eventCode].name_ja : '詳細不明';
                        const rootEventName = (cameoCodes[event.eventRootCode]) ? cameoCodes[event.eventRootCode].name_ja : '不明なカテゴリ';
                        const popupContent = `<b>関係:</b> ${countryCoordinates[actor1Code]?.name_jp} → ${countryCoordinates[actor2Code]?.name_jp}<br><b>カテゴリ:</b> ${rootEventName} (${event.eventRootCode})<br><b>イベント詳細:</b> ${eventName}`; // ★変更: ポップアップ内容を更新
                        polyline.bindPopup(popupContent);
                        polylines.push(polyline);
                    }

                    addNewsToTable(event);
                    processedCount++;
                }
            }
        });

        if (globe) {
            globe.arcsData(arcData3D);
        }

        console.log(`処理完了。${processedCount}件のイベントを読み込みました。`);
        if (processedCount === 0) {
            newsTableBody.innerHTML = '<tr><td colspan="5">表示可能なイベントが見つかりませんでした。</td></tr>';
        }
    }


    /**
     * ========================================
     * サイドバーとインタラクション
     * ========================================
     */
    const regions = {
        "アジア": ["日本", "中国", "韓国", "北朝鮮", "インド", "ロシア", "ベトナム", "タイ", "マレーシア", "インドネシア", "フィリピン", "パキスタン", "イラン", "イラク", "シリア", "イスラエル", "トルコ", "サウジアラビア", "UAE", "カタール", "パレスチナ"],
        "ヨーロッパ": ["イギリス", "フランス", "ドイツ", "イタリア", "スペイン", "ウクライナ", "ポーランド", "オランダ", "ベルギー", "スイス", "オーストリア", "スウェーデン"],
        "北アメリカ": ["アメリカ合衆国", "カナダ", "メキシコ"],
        "南アメリカ": ["ブラジル", "アルゼンチン", "コロンビア", "ペルー", "チリ", "ベネズエラ"],
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

        Object.entries(regions).forEach(([region, countries]) => {
            const regionDiv = document.createElement("div");
            regionDiv.className = "region";
            regionDiv.textContent = region;
            regionDiv.onclick = () => toggleRegion(region);
            container.appendChild(regionDiv);

            if (selectedRegion === region) {
                const ul = document.createElement("ul");
                ul.className = "country-list";
                countries.sort().forEach((country) => {
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
                    if (globe) { // 3Dモードの場合のみハイライト
                        const targetFeature = allCountryFeatures.find(f => f.properties.ISO_A3 === isoCode);
                        if (targetFeature) {
                           highlightedPolygon = targetFeature;
                           globe.polygonCapColor(d => d === highlightedPolygon ? 'rgba(255, 255, 0, 0.2)' : 'rgba(200, 200, 200, 0.1)');
                           globe.polygonStrokeColor(d => d === highlightedPolygon ? 'yellow' : '#ccc');
                        }
                    }
                }
            }
        });
    }

    function focusOnCountry(countryCode) {
        const coords = countryCoordinates[countryCode];
        if (!coords) return;

        if (globe) { // 3D
            globe.pointOfView({ lat: coords.lat, lng: coords.lng, altitude: 1.5 }, 1000);
        }
        if (map) { // 2D
            map.setView([coords.lat, coords.lng], 5);
        }
    }


    /**
     * ========================================
     * ヘルパー関数
     * ========================================
     */

    function parseGdeltCsv(csvContent) {
        const events = [];
        const rows = csvContent.trim().split('\n');
        for (const row of rows) {
            const columns = row.split('\t');
            if (columns.length < 61) continue;
            
            const eventCode = columns[26]; // イベントコードを取得
            events.push({
                actor1: { code: columns[5], name: columns[6], countryCode: columns[7] },
                actor2: { code: columns[15], name: columns[16], countryCode: columns[17] },
                eventCode: eventCode,
                eventRootCode: eventCode ? eventCode.substring(0, 2) : null, // ★追加: eventRootCodeを格納
                goldsteinScale: parseFloat(columns[30]),
                avgTone: parseFloat(columns[34]),
                day: columns[1],
                sourceUrl: columns[60]
            });
        }
        return events;
    }
    
    // ★★★新規: eventRootCodeに基づいて色を返す関数★★★
    function getEventRootCodeColor(rootCode) {
        const alpha = 0.8; 
        const colors = {
            // --- 協力的なイベント (青・緑系) ---
            '01': `rgba(178, 223, 138, ${alpha})`, // #01 公式声明 (薄緑)
            '02': `rgba(166, 206, 227, ${alpha})`, // #02 要請・アピール (水色)
            '03': `rgba(31, 120, 180, ${alpha})`,  // #03 協力の意図を表明 (青)
            '04': `rgba(118, 118, 118, ${alpha})`,  // #04 協議 (グレー)
            '05': `rgba(51, 160, 44, ${alpha})`,   // #05 外交協力 (緑)
            '06': `rgba(152, 78, 163, ${alpha})`,  // #06 物的協力 (紫)
            '07': `rgba(102, 194, 165, ${alpha})`, // #07 支援提供 (青緑)
            '08': `rgba(66, 146, 198, ${alpha})`,   // #08 譲歩 (濃い青)
            '09': `rgba(253, 191, 111, ${alpha})`, // #09 調査 (オレンジ)
            // --- 対立的なイベント (赤・黄系) ---
            '10': `rgba(255, 127, 0, ${alpha})`,   // #10 要求 (濃いオレンジ)
            '11': `rgba(252, 141, 98, ${alpha})`,  // #11 不承認 (薄い赤)
            '12': `rgba(231, 41, 138, ${alpha})`,  // #12 拒否 (マゼンタ)
            '13': `rgba(255, 255, 153, ${alpha})`, // #13 脅迫 (黄)
            '14': `rgba(247, 129, 191, ${alpha})`, // #14 抗議 (ピンク)
            '15': `rgba(177, 89, 40, ${alpha})`,   // #15 武力誇示 (茶色)
            '16': `rgba(227, 26, 28, ${alpha})`,   // #16 関係縮小 (赤)
            '17': `rgba(255, 20, 147, ${alpha})`, // #17 強制 (ディープレッド)
            '18': `rgba(128, 0, 0, ${alpha})`,     // #18 襲撃 (マルーン)
            '19': `rgba(255, 0, 0, ${alpha})`,     // #19 戦闘 (明るい赤)
            '20': `rgba(0, 0, 0, ${alpha})`        // #20 非従来型の大規模暴力 (黒)
        };
        return colors[rootCode] || `rgba(200, 200, 200, ${alpha})`; // デフォルトは薄いグレー
    }


    function getGoldsteinBackgroundColor(score) {
        if (isNaN(score)) return 'transparent';
        const alpha = 0.12;
        let r, g, b;
        if (score >= 0) { // 協力 (青系)
            const factor = Math.min(score, 10) / 10.0;
            r = 230 - 30 * factor; g = 230 + 25 * factor; b = 255;
        } else { // 紛争 (赤系)
            const factor = Math.abs(score) / 10.0;
            r = 255; g = 230 - 30 * factor; b = 230 - 30 * factor;
        }
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
    }

    function addNewsToTable(event) {
        const row = newsTableBody.insertRow();
        row.style.backgroundColor = getGoldsteinBackgroundColor(event.goldsteinScale);

        const date = event.day;
        row.insertCell(0).textContent = date ? `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}` : 'N/A';

        const actor1Name = countryCoordinates[event.actor1.countryCode]?.name_jp || event.actor1.countryCode;
        const actor2Name = countryCoordinates[event.actor2.countryCode]?.name_jp || event.actor2.countryCode;
        row.insertCell(1).textContent = `${actor1Name} → ${actor2Name}`;

        const actor1Display = event.actor1.name || '不明な主体';
        const actor2Display = event.actor2.name || '不明な対象';
        row.insertCell(2).textContent = `${actor1Display}が${actor2Display}に対し行動`;

        row.insertCell(3).textContent = (cameoCodes[event.eventCode]) ? cameoCodes[event.eventCode].name_ja : (event.eventCode || 'N/A');

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
    main();
    

    // --- リサイズ処理 ---
    // 地図コンテナのサイズ変更を監視し、中身をリサイズする
    const resizeObserver = new ResizeObserver(() => {
        // globe(3D)とmap(2D)の両方が存在する場合に対応
        if (globe) {
            const { width, height } = mapContainer.getBoundingClientRect();
            globe.width(width).height(height);
        }
        if (map) {
            map.invalidateSize();
        }
    });
    resizeObserver.observe(mapContainer);

});