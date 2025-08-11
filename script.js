document.addEventListener('DOMContentLoaded', () => {

    const newsTableBody = document.getElementById('news-table-body');
    const mapContainer = document.getElementById('map');
    const PROXY_URL = 'https://corsproxy.io/?';

    let globe = null;
    let map = null;

    let polylines = [];
    let singleCountryMarkers = [];

    let cameoCodes = {};
    let countryCoordinates = {};
    let allEvents = [];
    let allCountryFeatures = [];
    let highlightedPolygon = null;
    let highlightedRow = null;
    let updateTimer = null;
    let nextUpdateTime = null;

    function setupModal() {
        const infoIcon = document.querySelector('.view-toggle .info');
        const modalOverlay = document.getElementById('modal-overlay');
        const closeModalButton = document.getElementById('close-modal');

        if (infoIcon && modalOverlay && closeModalButton) {
            infoIcon.addEventListener('click', () => {
                modalOverlay.classList.add('modal-visible');
            });

            closeModalButton.addEventListener('click', () => {
                modalOverlay.classList.remove('modal-visible');
            });

            modalOverlay.addEventListener('click', (event) => {
                if (event.target === modalOverlay) {
                    modalOverlay.classList.remove('modal-visible');
                }
            });
        }
    }
    
    async function main() {
        setupToggleButtons();
        setupModal();
        await fetchDataAndProcess();
        renderRegions();
        setupCountryClickListeners();
        setupLegends();
    }

    async function fetchDataAndProcess() {
        console.log('処理を開始します...');
        newsTableBody.innerHTML = '<tr><td colspan="5">最新のイベントデータを読み込んでいます...</td></tr>';

        try {
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

            console.log('1/5: 更新情報ファイルを取得中...');
            const updateInfoUrl = 'http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt';
            const response = await fetch(PROXY_URL + encodeURIComponent(updateInfoUrl));
            if (!response.ok) throw new Error(`更新情報ファイルの取得に失敗 (Status: ${response.status})`);
            const textData = await response.text();

            const zipUrlMatch = textData.match(/http:\/\/data\.gdeltproject\.org\/gdeltv2\/\d+\.translation\.export\.CSV\.zip/);
            if (!zipUrlMatch) throw new Error('更新情報ファイル内に有効なZIP URLが見つかりませんでした。');
            const zipUrl = zipUrlMatch[0];
            
            scheduleNextUpdate(zipUrl);

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

            // CHANGED: 3Dビューがアクティブな場合のみ初期化し、それ以外は2D/3Dデータを更新する
            if (document.getElementById('toggle-3d').classList.contains('active')) {
                if (!globe) {
                    init3D();
                } else {
                    renderDataOnMap();
                }
            } else {
                if (!map) {
                    init2D();
                } else {
                    renderDataOnMap();
                }
            }
            
        } catch (error) {
            console.error('エラーが発生しました:', error);
            newsTableBody.innerHTML = `<tr><td colspan="5" style="color: red;">エラー: ${error.message}</td></tr>`;
        }
    }

    function scheduleNextUpdate(zipUrl) {
        if (updateTimer) {
            clearTimeout(updateTimer);
        }
    
        const timestampMatch = zipUrl.match(/(\d{14})\.translation\.export\.CSV\.zip/);
        if (!timestampMatch) {
            console.warn('ファイル名からタイムスタンプを抽出できませんでした。自動更新は行われません。');
            return;
        }
        console.log(`get ${timestampMatch}`);
    
        const timestamp = timestampMatch[1];
        const year = parseInt(timestamp.substring(0, 4), 10);
        const month = parseInt(timestamp.substring(4, 6), 10) - 1;
        const day = parseInt(timestamp.substring(6, 8), 10);
        const hours = parseInt(timestamp.substring(8, 10), 10);
        const minutes = parseInt(timestamp.substring(10, 12), 10);
        const seconds = parseInt(timestamp.substring(12, 14), 10);
    
        // 取得したデータの時刻 (UTC)
        const fileDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
        
        // 次の更新時刻 (15分後) を設定
        nextUpdateTime = new Date(fileDate.getTime() + 25 * 60 * 1000);
    
        const now = new Date();
        // 更新時刻までの遅延時間 (ミリ秒) を計算。余裕をもって1秒追加
        let delay = nextUpdateTime.getTime() - now.getTime() + 1000;
    
        if (delay < 0) {
            // もし更新時刻を過ぎていたら、1分後に再試行
            console.log('次の更新時刻を過ぎています。1分後にデータ更新を再試行します。');
            delay = 60 * 1000; 
        }
    
        console.log(`次のデータ更新は ${nextUpdateTime.toLocaleString()} ごろに予定されています。(約${Math.round(delay / 60000)}分後)`);
    
        updateTimer = setTimeout(() => {
            console.log('スケジュールされたデータ更新を開始します...');
            fetchDataAndProcess();
        }, delay);
    }

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
            .labelsData([])
            .labelLat('lat')
            .labelLng('lng')
            .labelLabel('label')
            .labelText('countryName')
            .labelSize('size')
            .labelColor('color')
            .labelDotRadius('size')
            .labelAltitude('alt')
            .labelResolution(3)
            .arcsData([])
            .arcColor(d => getEventRootCodeColor(d.event.eventRootCode))
            .arcDashAnimateTime(2500)
            .arcLabel(d => {
                const event = d.event;
                const actor1Display = event.actor1.name || event.actor1.code || 'N/A';
                const actor2Display = event.actor2.name || event.actor2.code || 'N/A';
                const eventName = (cameoCodes[event.eventCode]) ? cameoCodes[event.eventCode].name_ja : '詳細不明';
                const rootEventName = (cameoCodes[event.eventRootCode]) ? cameoCodes[event.eventRootCode].name_ja : '不明なカテゴリ';
                return `<b>関係:</b> ${actor1Display} → ${actor2Display}<br><b>カテゴリ:</b> ${rootEventName} (${event.eventRootCode})<br><b>イベント詳細:</b> ${eventName}`;
            })
            .arcStroke(0.4)
            .arcDashLength(0.5)
            .arcDashGap(0.2)
            .onArcClick(arc => {
                if (arc.index !== undefined) {
                    focusOnTableRow(arc.index);
                }
            })
            .onLabelClick(label => {
                if (label.index !== undefined) {
                    focusOnTableRow(label.index);
                }
            });

        globe.pointOfView({ altitude: 3.5 }, 1000);
        renderDataOnMap();
    }

    function init2D() {
        map = L.map('map', { worldCopyJump: true }).setView([20, 0], 2);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(map);
        renderDataOnMap();
    }
    
    function renderDataOnMap() {
        newsTableBody.innerHTML = '';
        if (map) {
            polylines.forEach(p => p.remove());
            singleCountryMarkers.forEach(m => m.remove());
        }
        polylines = [];
        singleCountryMarkers = [];

        let bilateralEventCount = 0;
        let singleCountryEventCount = 0;

        const arcData3D = [];
        const pointsData3D = [];
        const singleCountryAggregates = {};
        const posCounts = {};

        allEvents.forEach((event, index) => {
            addNewsToTable(event, index);

            const actor1Code = event.actor1.countryCode;
            const actor2Code = event.actor2.countryCode;

            if (actor1Code && actor2Code && actor1Code !== actor2Code) {
                const startCoords = countryCoordinates[actor1Code];
                const endCoords = countryCoordinates[actor2Code];

                if (startCoords && endCoords) {
                    bilateralEventCount++;
                    if (globe) {
                        arcData3D.push({ startLat: startCoords.lat, startLng: startCoords.lng, endLat: endCoords.lat, endLng: endCoords.lng, event: event, index: index });
                    }
                    if (map) {
                        const latlngs = [[startCoords.lat, startCoords.lng], [endCoords.lat, endCoords.lng]];
                        const color = getEventRootCodeColor(event.eventRootCode);
                        const polyline = L.polyline(latlngs, { color: color, weight: 1.5, opacity: 0.6 }).addTo(map);
                        const eventName = (cameoCodes[event.eventCode]) ? cameoCodes[event.eventCode].name_ja : '詳細不明';
                        const rootEventName = (cameoCodes[event.eventRootCode]) ? cameoCodes[event.eventRootCode].name_ja : '不明なカテゴリ';
                        const ac1 = (event.actor1.name || '') + (countryCoordinates[actor1Code] ? `(${countryCoordinates[actor1Code]?.name_jp})`: "");
                        const ac2 = (event.actor2.name || '') + (countryCoordinates[actor2Code] ? `(${countryCoordinates[actor2Code]?.name_jp})`: "");
                        const popupContent = `<b>関係:</b> ${ac1} → ${ac2}<br><b>カテゴリ:</b> ${rootEventName} (${event.eventRootCode})<br><b>イベント詳細:</b> ${eventName}`;
                        polyline.bindPopup(popupContent);

                        polyline.on('click', () => focusOnTableRow(index));
                        polylines.push(polyline);
                    }
                }
            } else {
                const countryCode = event.actor1.countryCode || event.actor2.countryCode;
                const rootCode = event.eventRootCode;
                if (countryCode && rootCode && countryCoordinates[countryCode]) {
                    singleCountryEventCount++;

                    if (!singleCountryAggregates[countryCode]) singleCountryAggregates[countryCode] = {};
                    if (!singleCountryAggregates[countryCode][rootCode]) singleCountryAggregates[countryCode][rootCode] = { count: 0 };
                    singleCountryAggregates[countryCode][rootCode].count++;

                    let lat, lng;
                    if (event.actor1.isplace) {
                        lat = event.actor1.lat;
                        lng = event.actor1.lng;
                    } else if (event.actor2.isplace) {
                        lat = event.actor2.lat;
                        lng = event.actor2.lng;
                    } else {
                        const fallbackCoords = countryCoordinates[countryCode];
                        lat = fallbackCoords.lat;
                        lng = fallbackCoords.lng;
                    }
                    if (!posCounts[lat]) posCounts[lat] = {};
                    if (!posCounts[lat][lng]) posCounts[lat][lng] = 0;
                    posCounts[lat][lng]++;

                    if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) return;

                    const color = getEventRootCodeColor(rootCode);
                    const countryName = countryCoordinates[countryCode]?.name_jp || countryCode;
                    const eventName = (cameoCodes[event.eventCode]) ? cameoCodes[event.eventCode].name_ja : '詳細不明';
                    const labelContent = `<b>国:</b> ${countryName}<br><b>イベント:</b> ${eventName} (${event.eventCode})`;

                    if (globe) {
                        pointsData3D.push({
                            lat: lat + Math.sin(posCounts[lat][lng]) * (0.2 * posCounts[lat][lng] / 3),
                            lng: lng + Math.cos(posCounts[lat][lng]) * (0.4 * posCounts[lat][lng] / 3),
                            size: 0.25,
                            color: color,
                            label: labelContent,
                            countryName: "",
                            alt: 0.01,
                            event: event,
                            index: index
                        });
                    }

                    if (map) {
                        const radius = 6;
                        const circle = L.circleMarker([lat, lng], {
                            radius: radius,
                            fillColor: color,
                            color: "#fff",
                            weight: 0.5,
                            opacity: 1,
                            fillOpacity: 0.8
                        }).addTo(map);
                        circle.bindPopup(labelContent);
                        circle.on('click', () => focusOnTableRow(index));
                        singleCountryMarkers.push(circle);
                    }
                }
            }
        });

        if (globe) {
            const dominantEventColorMap = {};
            for (const countryCode in singleCountryAggregates) {
                const events = singleCountryAggregates[countryCode];
                if (!events || Object.keys(events).length === 0) continue;
                const dominantRootCode = Object.keys(events).reduce((a, b) => events[a].count > events[b].count ? a : b);
                const color = getEventRootCodeColor(dominantRootCode);
                dominantEventColorMap[countryCode] = color.replace(/, \d\.\d+\)/, ', 0.35)');
            }
            globe.polygonCapColor(d => {
                if (d === highlightedPolygon) return 'rgba(255, 255, 0, 0.5)';
                return dominantEventColorMap[d.properties.ISO_A3] || 'rgba(200, 200, 200, 0.1)';
            });
            globe.arcsData(arcData3D);
            globe.labelsData(pointsData3D);
        }

        console.log(`処理完了。2国間イベント: ${bilateralEventCount}件、単一国イベント: ${singleCountryEventCount}件を読み込みました。`);
        if (bilateralEventCount === 0 && singleCountryEventCount === 0) {
            newsTableBody.innerHTML = '<tr><td colspan="5">表示可能なイベントが見つかりませんでした。</td></tr>';
        }
    }

    function focusOnTableRow(index) {
        const rowId = `event-row-${index}`;
        const row = document.getElementById(rowId);
        if (row) {
            if (highlightedRow) {
                highlightedRow.classList.remove('highlighted');
            }
            row.classList.add('highlighted');
            highlightedRow = row;
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

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
            const regionLabel = document.createElement("button");
            regionLabel.textContent = region;
            regionLabel.onclick = () => toggleRegion(region);
            regionDiv.appendChild(regionLabel);
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
                regionDiv.appendChild(ul);
            }
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
                    if (globe) {
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

        if (globe) {
            globe.pointOfView({ lat: coords.lat, lng: coords.lng, altitude: 1.5 }, 1000);
        }
        if (map) {
            map.setView([coords.lat, coords.lng], 5);
        }
    }

    function parseGdeltCsv(csvContent) {
        const events = [];
        const rows = csvContent.trim().split('\n');
        for (const row of rows) {
            const columns = row.split('\t');
            if (columns.length < 61) continue;
            
            const eventCode = columns[26];
            const cc1 = columns[5] ? columns[5].substring(0, 3): (columns[15] ? columns[15].substring(0, 3): null);
            const cc2 = columns[15] ? columns[15].substring(0, 3): cc1;
            const ccd1 = countryCoordinates[cc1];
            const ccd2 = countryCoordinates[cc2];
            events.push({
                actor1: { 
                    code: columns[5], 
                    name: columns[6].length > 0 ? columns[6] : null, 
                    countryCode: cc1,
                    lat: ccd1 ? ccd1.lat: (ccd2 ? ccd2.lat : null), 
                    lng: ccd1 ? ccd1.lng: (ccd2 ? ccd2.lng : null),
                    isplace: (countryCoordinates[cc1]?.lat && countryCoordinates[cc1]?.lng) ? true : false
                },
                actor2: { 
                    code: columns[15], 
                    name: columns[16].length > 0 ? columns[16] : null, 
                    countryCode: cc2,
                    lat: ccd2 ? ccd2.lat: (ccd1 ? ccd1.lat: null), 
                    lng: ccd2 ? ccd2.lng: (ccd1 ? ccd1.lng: null),
                    isplace: (countryCoordinates[cc2]?.lat && countryCoordinates[cc2]?.lng) ? true : false
                },
                eventCode: eventCode,
                eventRootCode: eventCode ? eventCode.substring(0, 2) : null,
                goldsteinScale: parseFloat(columns[30]),
                avgTone: parseFloat(columns[34]),
                day: columns[1],
                sourceUrl: columns[60]
            });
        }
        return events;
    }
    
    const alpha = 0.8; 
    const rootCodeColors = {
        '01': `rgba(178, 223, 138, ${alpha})`, '02': `rgba(166, 206, 227, ${alpha})`,
        '03': `rgba(31, 120, 180, ${alpha})`,  '04': `rgba(118, 118, 118, ${alpha})`,
        '05': `rgba(51, 160, 44, ${alpha})`,   '06': `rgba(152, 78, 163, ${alpha})`,
        '07': `rgba(102, 194, 165, ${alpha})`, '08': `rgba(66, 146, 198, ${alpha})`,
        '09': `rgba(253, 191, 111, ${alpha})`, '10': `rgba(255, 127, 0, ${alpha})`,
        '11': `rgba(252, 141, 98, ${alpha})`,  '12': `rgba(231, 41, 138, ${alpha})`,
        '13': `rgba(255, 255, 153, ${alpha})`, '14': `rgba(247, 129, 191, ${alpha})`,
        '15': `rgba(177, 89, 40, ${alpha})`,   '16': `rgba(227, 26, 28, ${alpha})`,
        '17': `rgba(255, 20, 147, ${alpha})`, '18': `rgba(128, 0, 0, ${alpha})`,
        '19': `rgba(255, 0, 0, ${alpha})`,     '20': `rgba(0, 0, 0, ${alpha})`
    };

    function getEventRootCodeColor(rootCode) {
        return rootCodeColors[rootCode] || `rgba(200, 200, 200, ${alpha})`;
    }
    
    function setupLegends() {
        const legendsContainer = document.getElementById('legends');
        if (!legendsContainer) return;
        renderLegends(legendsContainer);
        legendsContainer.addEventListener('click', () => {
            legendsContainer.classList.toggle('hidden');
        });
    }

    function renderLegends(container) {
        let legendHtml = '<h4>凡例 (クリックで切替)</h4>';
        for (const [code, color] of Object.entries(rootCodeColors)) {
            const label = (cameoCodes && cameoCodes[code]) ? cameoCodes[code].name_ja : `カテゴリ ${code}`;
            legendHtml += `<div class="legend-item"><span class="legend-color-box" style="background-color: ${color};"></span><span>${label}</span></div>`;
        }
        container.innerHTML = legendHtml;
    }

    function getGoldsteinBackgroundColor(score) {
        if (isNaN(score)) return 'transparent';
        const alpha = 0.12;
        let r, g, b;
        if (score >= 0) {
            const factor = Math.min(score, 10) / 10.0;
            r = 230 - 30 * factor; g = 230 + 25 * factor; b = 255;
        } else {
            const factor = Math.abs(score) / 10.0;
            r = 255; g = 230 - 30 * factor; b = 230 - 30 * factor;
        }
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
    }

    function handleOnClick(event,index,ac1,ac2,same){
        console.log(event);
        console.log(ac1 && ac2);
        if (globe) {
            if (ac1 && ac2){
                globe.pointOfView(getMidpoint(
                    event.actor1.lat,
                    event.actor1.lng,
                    event.actor2.lat,
                    event.actor2.lng,
                    same ? 0.2 : 1
                ), 1000);
            }else{
                const lat = ac1 ? event.actor1.lat : event.actor2.lat;
                const lng = ac1 ? event.actor1.lng : event.actor2.lng;
                globe.pointOfView({ lat: lat, lng: lng, altitude: 0.2 }, 1000);
            }
        }
        if (map) {
            if (ac1 && ac2){
                map.setView([
                    (event.actor1.lat+event.actor2.lat)/2, (event.actor1.lng+event.actor2.lng)/2], same? 8 : 5);
            }else{
                const lat = ac1 ? event.actor1.lat : event.actor2.lat;
                const lng = ac1 ? event.actor1.lng : event.actor2.lng;
                map.setView([lat, lng], 8);
            }
        }
        focusOnTableRow(index);
    }

    function getMidpoint(lat1, lng1, lat2, lng2, alt) {
        // 度をラジアンに変換
        const toRadians = (degree) => degree * Math.PI / 180;
        const toDegrees = (radian) => radian * 180 / Math.PI;

        const lat1Rad = toRadians(lat1);
        const lng1Rad = toRadians(lng1);
        const lat2Rad = toRadians(lat2);
        const lng2Rad = toRadians(lng2);

        const Bx = Math.cos(lat2Rad) * Math.cos(lng2Rad - lng1Rad);
        const By = Math.cos(lat2Rad) * Math.sin(lng2Rad - lng1Rad);

        const latMidRad = Math.atan2(
            Math.sin(lat1Rad) + Math.sin(lat2Rad),
            Math.sqrt((Math.cos(lat1Rad) + Bx) * (Math.cos(lat1Rad) + Bx) + By * By)
        );
        
        const lngMidRad = lng1Rad + Math.atan2(By, Math.cos(lat1Rad) + Bx);

        return {
            lat: toDegrees(latMidRad),
            lng: toDegrees(lngMidRad),
            altitude: alt
        };
    }
    
    function addNewsToTable(event, index) {
        if (!event.actor1.isplace && !event.actor2.isplace){
            return;
        }
        const actor1Display = event.actor1.name;
        const actor2Display = event.actor2.name;
        let summary = '詳細不明';
        if(actor1Display && actor2Display && 
            (actor1Display !== actor2Display)) {
            summary = `${actor1Display}が${actor2Display}に対し行動`;
        } else if (actor1Display) {
            summary = `${actor1Display}に関するイベント`;
            if (!event.actor1.isplace){
                return;
            }
        } else if (actor2Display) {
            summary = `${actor2Display}に関するイベント`;
            if (!event.actor2.isplace){
                return;
            }
        }
        const row = newsTableBody.insertRow();
        row.id = `event-row-${index}`;
        row.style.backgroundColor = getGoldsteinBackgroundColor(event.goldsteinScale);
        const date = event.day;
        row.insertCell(0).textContent = date ? `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}` : '';

        const actor1Name = countryCoordinates[event.actor1.countryCode]?.name_jp || event.actor1.name  || event.actor1.countryCode || null;
        const actor2Name = countryCoordinates[event.actor2.countryCode]?.name_jp || event.actor2.name  || event.actor2.countryCode || null;
        if (actor1Name && actor2Name && actor1Name !== actor2Name){
            row.insertCell(1).textContent = `${actor1Name} → ${actor2Name}`;
        } else {
            row.insertCell(1).textContent = `${actor1Name || actor2Name}`;
        }

        
        row.insertCell(2).textContent = summary;
        if ((actor1Display != undefined) || (actor2Display != undefined)){
            row.addEventListener('click', 
                () => handleOnClick(
                    event,
                    index,
                    event.actor1.isplace,
                    event.actor2.isplace,
                    actor1Display == actor2Display
                )
            );
        }

        row.insertCell(3).textContent = (cameoCodes[event.eventCode]) ? cameoCodes[event.eventCode].name_ja : (event.eventCode || '');

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
            urlCell.textContent = '';
        }
    }

    main();

    const resizeObserver = new ResizeObserver(() => {
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