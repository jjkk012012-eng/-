
(() => {
  const CONFIG = window.TIMEROUTE_CONFIG || {};
  const API_KEY = CONFIG.GOOGLE_MAPS_API_KEY;
  const ENGINE_URL = CONFIG.ENGINE_DATA_URL || "./data/route_engine.json";

  let ENGINE = null;
  let map, directionsService, directionsRenderer, geocoder, placesService;
  let currentPosition = null;
  let selectedMinutes = 60;
  let selectedLevel = "mid";
  let generatedRoutes = [];
  let activeRouteIndex = 0;
  let markers = [];
  let placeCache = new Map();
  let searchGeneration = 0;

  const $ = (id) => document.getElementById(id);
  const ui = {
    topLocateBtn: $("topLocateBtn"),
    cardLocateBtn: $("cardLocateBtn"),
    manualModeBtn: $("manualModeBtn"),
    useSearchBtn: $("useSearchBtn"),
    placeInput: $("placeInput"),
    locationStatus: $("locationStatus"),
    timeOptions: $("timeOptions"),
    customMinutes: $("customMinutes"),
    applyCustomTime: $("applyCustomTime"),
    levelOptions: $("levelOptions"),
    generateBtn: $("generateBtn"),
    resetBtn: $("resetBtn"),
    routesList: $("routesList"),
    summaryStrip: $("summaryStrip"),
    selectedRouteTitle: $("selectedRouteTitle"),
    selectedRouteSubtitle: $("selectedRouteSubtitle"),
    googleMapsLink: $("googleMapsLink"),
    toast: $("toast"),
    mobileResultTabs: $("mobileResultTabs"),
    mobileJumpBtn: $("mobileJumpBtn"),
    resultsArea: $("resultsArea")
  };

  const LEVELS = {
    low: { label: "하", radiusMul: .72, countAdjust: -1, maxWalkPerHour: 850 },
    mid: { label: "중", radiusMul: 1, countAdjust: 0, maxWalkPerHour: 1200 },
    high: { label: "상", radiusMul: 1.32, countAdjust: 1, maxWalkPerHour: 1700 }
  };

  async function boot() {
    try { ENGINE = await fetch(ENGINE_URL).then(r => r.json()); }
    catch { ENGINE = fallbackEngine(); }
    loadGoogleMaps();
  }

  function loadGoogleMaps() {
    window.initTimeRouteApp = initMap;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}&libraries=places&language=ko&region=KR&callback=initTimeRouteApp`;
    script.async = true;
    script.defer = true;
    script.onerror = () => showToast("Google Maps 로드 실패");
    document.head.appendChild(script);
  }

  function initMap() {
    const seoul = { lat: 37.5665, lng: 126.9780 };
    map = new google.maps.Map($("map"), {
      center: seoul,
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: true
    });
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      preserveViewport: false,
      polylineOptions: { strokeColor: "#315CE8", strokeWeight: 6, strokeOpacity: .88 }
    });
    geocoder = new google.maps.Geocoder();
    placesService = new google.maps.places.PlacesService(map);
    bindEvents();
    updateSummary();
    if (isMobileScreen()) setMobileView("routes");
  }

  function bindEvents() {
    ui.topLocateBtn.addEventListener("click", tryAutoLocate);
    ui.cardLocateBtn.addEventListener("click", () => { setMode("current"); tryAutoLocate(); });
    ui.manualModeBtn.addEventListener("click", () => { setMode("manual"); ui.placeInput.focus(); setStatus("지역명을 입력하고 검색하세요."); });
    ui.useSearchBtn.addEventListener("click", geocodeSearch);
    ui.placeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") geocodeSearch(); });
    document.querySelectorAll("[data-place]").forEach(btn => btn.addEventListener("click", () => {
      setMode("manual"); ui.placeInput.value = btn.dataset.place; geocodeSearch();
    }));

    ui.generateBtn.addEventListener("click", async () => {
      if (!currentPosition && ui.placeInput.value.trim()) {
        const ok = await geocodeSearch(true);
        if (!ok) return;
      }
      generateRoutes();
    });
    ui.resetBtn.addEventListener("click", generateRoutes);

    if (ui.mobileJumpBtn) {
      ui.mobileJumpBtn.addEventListener("click", () => {
        setMobileView("routes");
        scrollToResults();
      });
    }

    if (ui.mobileResultTabs) {
      ui.mobileResultTabs.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-mobile-view]");
        if (!btn) return;
        setMobileView(btn.dataset.mobileView);
      });
    }

    ui.timeOptions.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-minutes]");
      if (!btn) return;
      [...ui.timeOptions.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMinutes = Number(btn.dataset.minutes);
      ui.customMinutes.value = "";
      updateSummary();
    });

    ui.applyCustomTime.addEventListener("click", () => {
      const val = Number(ui.customMinutes.value);
      if (!val || val < 20 || val > 480) return showToast("20분~480분 사이로 입력해주세요.");
      selectedMinutes = val;
      [...ui.timeOptions.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
      updateSummary();
      showToast(`${val}분 적용`);
    });

    ui.levelOptions.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-level]");
      if (!btn) return;
      [...ui.levelOptions.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedLevel = btn.dataset.level;
      updateSummary();
    });
  }

  function setMode(mode) {
    ui.cardLocateBtn.classList.toggle("active", mode === "current");
    ui.manualModeBtn.classList.toggle("active", mode === "manual");
  }
  function setStatus(text){ ui.locationStatus.textContent = text; }

  function tryAutoLocate() {
    if (!navigator.geolocation) return showToast("위치 기능을 지원하지 않습니다.");
    setStatus("현재 위치 확인 중...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        setCurrentPosition(loc, "현재 위치");
        reverseGeocode(loc);
        showToast("현재 위치 적용");
      },
      () => {
        setMode("manual");
        setStatus("위치 권한 거부됨. 지역명을 입력하세요.");
        showToast("직접 입력으로 사용 가능");
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
    );
  }

  function reverseGeocode(latlng) {
    geocoder.geocode({ location: latlng }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        ui.placeInput.value = results[0].formatted_address;
        setStatus(`출발지: ${results[0].formatted_address}`);
      }
    });
  }

  function geocodeSearch(silent=false) {
    return new Promise((resolve) => {
      const q = ui.placeInput.value.trim();
      if (!q) { if(!silent) showToast("지역명을 입력하세요."); resolve(false); return; }
      setMode("manual");
      setStatus("지역 검색 중...");
      geocoder.geocode({ address: q, region: "KR" }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          setCurrentPosition(results[0].geometry.location, results[0].formatted_address);
          ui.placeInput.value = results[0].formatted_address;
          showToast("출발지 적용");
          resolve(true);
        } else {
          setStatus("지역을 찾지 못했습니다.");
          showToast("지역 검색 실패");
          resolve(false);
        }
      });
    });
  }

  function setCurrentPosition(latlng, label) {
    currentPosition = latlng;
    placeCache.clear();
    searchGeneration++;
    map.setCenter(latlng);
    map.setZoom(15);
    setStatus(`출발지: ${label}`);
    showStartMarker(latlng);
  }

  function showStartMarker(latlng) {
    clearMarkers();
    directionsRenderer.setDirections({ routes: [] });
    markers.push(new google.maps.Marker({
      position: latlng, map,
      label: { text: "출발", color: "#fff", fontWeight: "900" },
      title: "출발 위치",
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: "#168179", fillOpacity: 1, strokeWeight: 3, strokeColor: "#fff" }
    }));
  }

  function updateSummary() {
    const level = LEVELS[selectedLevel];
    ui.summaryStrip.innerHTML = `현재 조건 <b>${selectedMinutes}분 · ${level.label}</b>`;
  }

  async function generateRoutes() {
    if (!currentPosition) return showToast("출발지를 먼저 선택하세요.");
    ui.generateBtn.disabled = true;
    ui.resetBtn.disabled = true;
    ui.routesList.innerHTML = `<div class="empty"><div>✨</div><strong>루트 생성 중</strong><p>주변 가게와 장소를 찾고 있습니다.</p></div>`;

    try {
      const startGen = searchGeneration;
      const pools = await collectRichPlacePools();
      if (startGen !== searchGeneration) return;
      if (Object.values(pools).flat().length < 3) throw new Error("not enough places");
      generatedRoutes = buildRoutesWithRetries(pools, 5);
      renderRoutes();
      selectRoute(0);
      showToast("루트 5개 생성 완료");
      if (isMobileScreen()) {
        setMobileView("routes");
        setTimeout(scrollToResults, 120);
      }
    } catch (err) {
      console.error(err);
      ui.routesList.innerHTML = `<div class="empty"><div>⚠️</div><strong>루트 생성 실패</strong><p>지역을 넓게 입력하거나 API 설정을 확인하세요.</p></div>`;
      showToast("루트 생성 실패");
    } finally {
      ui.generateBtn.disabled = false;
      ui.resetBtn.disabled = false;
    }
  }

  async function collectRichPlacePools() {
    const radius = calcSearchRadius();
    const defs = ENGINE.categoryDefinitions;
    const tasks = [];
    Object.entries(defs).forEach(([cat, def]) => {
      (def.types || []).forEach(type => tasks.push(searchNearbyType(cat, type, radius)));
      (def.keywords || []).forEach(keyword => tasks.push(searchTextKeyword(cat, keyword, radius)));
    });
    const groups = await Promise.all(tasks);
    const pools = {};
    Object.keys(defs).forEach(cat => pools[cat] = []);

    groups.flat().forEach(p => {
      if (!p || !p.place_id || !p.geometry || !p.geometry.location) return;
      if (isBadPlaceName(p.name)) return;
      const cat = p._cat || "walk";
      if (!pools[cat].some(x => x.place_id === p.place_id)) pools[cat].push(p);
    });

    Object.keys(pools).forEach(cat => {
      pools[cat] = pools[cat]
        .map(p => ({ ...p, _distance: haversine(currentPosition, p.geometry.location) }))
        .filter(p => p._distance <= radius * 1.45)
        .sort((a,b) => scorePlace(b) - scorePlace(a))
        .slice(0, 36);
    });

    return pools;
  }

  function calcSearchRadius() {
    const base = selectedMinutes <= 30 ? 900 : selectedMinutes <= 60 ? 1500 : selectedMinutes <= 120 ? 2500 : 3600;
    return Math.round(base * LEVELS[selectedLevel].radiusMul);
  }

  function searchNearbyType(cat, type, radius) {
    const key = `type:${cat}:${type}:${radius}:${latLngString(currentPosition)}`;
    if (placeCache.has(key)) return Promise.resolve(placeCache.get(key));
    return new Promise(resolve => {
      placesService.nearbySearch({ location: currentPosition, radius, type }, (results, status) => {
        const arr = status === google.maps.places.PlacesServiceStatus.OK && results ? results.map(p => enrichPlace(p, cat)) : [];
        placeCache.set(key, arr);
        resolve(arr);
      });
    });
  }

  function searchTextKeyword(cat, keyword, radius) {
    const key = `kw:${cat}:${keyword}:${radius}:${latLngString(currentPosition)}`;
    if (placeCache.has(key)) return Promise.resolve(placeCache.get(key));
    return new Promise(resolve => {
      placesService.textSearch({ location: currentPosition, radius, query: keyword }, (results, status) => {
        const arr = status === google.maps.places.PlacesServiceStatus.OK && results ? results.map(p => enrichPlace(p, cat)) : [];
        placeCache.set(key, arr);
        resolve(arr);
      });
    });
  }

  function enrichPlace(p, cat) {
    const def = ENGINE.categoryDefinitions[cat] || {};
    const dwell = randomBetween(def.dwell?.[0] || 12, def.dwell?.[1] || 30);
    const cost = def.cost || [0, 10000];
    return {
      ...p,
      _cat: cat,
      _catName: def.label || categoryName(cat),
      _dwell: dwell,
      _costLow: cost[0],
      _costHigh: cost[1]
    };
  }

  function isBadPlaceName(name="") {
    const n = String(name).trim();
    if (!n) return true;
    const bad = ["아파트", "오피스텔", "주공", "빌라", "맨션", "주차장", "정류장", "교차로", "사거리", "IC", "지하차도", "육교", "어린이집", "초등학교", "중학교", "고등학교", "대학교"];
    return bad.some(x => n.includes(x));
  }

  function scorePlace(p) {
    const rating = p.rating || 3.7;
    const reviews = Math.min((p.user_ratings_total || 0) / 300, 1);
    const near = Math.max(0, 1 - (p._distance || 0) / Math.max(900, calcSearchRadius()));
    const nameBonus = hasCommercialName(p.name) ? 1.2 : 0;
    return rating * 1.4 + reviews * 2 + near * 2 + nameBonus + Math.random() * 2.8;
  }

  function hasCommercialName(name="") {
    const n = String(name);
    return /(식당|분식|카페|커피|시장|빵|베이커리|치킨|국밥|국수|떡볶이|상회|횟집|고기|갈비|초밥|포차|호프|공원|박물관|거리|광장)/.test(n);
  }

  function buildRoutesWithRetries(pools, target) {
    const routes = [];
    const usedFingerprints = new Set();
    const usedTitles = new Set();
    let guard = 0;
    while (routes.length < target && guard < 100) {
      guard++;
      const profile = weightedProfile();
      const count = routePlaceCount();
      let places = pickPlacesByProfile(pools, profile, count);
      if (places.length < 2) places = pickFallbackPlaces(pools, count);
      places = orderPlacesSmart(places);
      const route = buildRouteObject(places, profile, routes.length);
      if (route.places.length < 2) continue;
      const fp = route.places.map(p => p.place_id).sort().join("|");
      if (usedFingerprints.has(fp) && guard < 75) continue;
      if (usedTitles.has(route.title)) route.title = `${route.title} ${routes.length + 1}`;
      usedFingerprints.add(fp);
      usedTitles.add(route.title);
      routes.push(route);
    }
    return routes.slice(0, target);
  }

  function weightedProfile() {
    const profiles = ENGINE.routeProfiles || [];
    const total = profiles.reduce((s,p) => s + (p.weight || 1), 0);
    let r = Math.random() * total;
    for (const p of profiles) {
      r -= (p.weight || 1);
      if (r <= 0) return p;
    }
    return profiles[0];
  }

  function routePlaceCount() {
    let base = selectedMinutes <= 30 ? [2,3] : selectedMinutes <= 60 ? [3,4] : selectedMinutes <= 120 ? [4,5] : [5,6];
    const adj = LEVELS[selectedLevel].countAdjust;
    return randomBetween(Math.max(2, base[0]+adj), Math.max(2, base[1]+adj));
  }

  function pickPlacesByProfile(pools, profile, count) {
    const result = [];
    const cats = shuffle([...(profile.categories || Object.keys(pools))]);
    let turns = 0;
    while (result.length < count && turns < count * 6) {
      const cat = cats[turns % cats.length];
      const pool = pools[cat] || [];
      const picked = weightedPick(pool.filter(p => !result.some(x => x.place_id === p.place_id)));
      if (picked) result.push(picked);
      turns++;
    }
    return result;
  }

  function pickFallbackPlaces(pools, count) {
    const all = Object.values(pools).flat().filter(uniqueByPlaceId);
    return shuffle(all).sort((a,b) => scorePlace(b) - scorePlace(a)).slice(0, count);
  }

  function uniqueByPlaceId(p, i, arr) { return arr.findIndex(x => x.place_id === p.place_id) === i; }

  function weightedPick(pool) {
    if (!pool.length) return null;
    const sorted = pool.map(p => ({ p, w: Math.max(.2, scorePlace(p)) })).sort((a,b) => b.w - a.w).slice(0, 16);
    const total = sorted.reduce((s,x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const x of sorted) { r -= x.w; if (r <= 0) return x.p; }
    return sorted[0].p;
  }

  function orderPlacesSmart(places) {
    // 지도에 표시되는 1→2→3→4 경로가 최대한 짧게 이어지도록
    // 현재 위치 기준 최근접 탐색 + 2-opt 개선으로 방문 순서를 재정렬합니다.
    const ordered = nearestNeighborOrder(currentPosition, places);
    return twoOptImprove(currentPosition, ordered);
  }

  function nearestNeighborOrder(origin, places) {
    const remaining = [...places];
    const ordered = [];
    let cursor = origin;

    while (remaining.length) {
      let bestIndex = 0;
      let bestScore = Infinity;

      remaining.forEach((place, idx) => {
        const distance = haversine(cursor, place.geometry.location);
        const ratingBonus = (place.rating || 3.8) * 8;
        const reviewBonus = Math.min((place.user_ratings_total || 0) / 80, 8);
        const score = distance - ratingBonus - reviewBonus;

        if (score < bestScore) {
          bestScore = score;
          bestIndex = idx;
        }
      });

      const next = remaining.splice(bestIndex, 1)[0];
      ordered.push(next);
      cursor = next.geometry.location;
    }

    return ordered;
  }

  function twoOptImprove(origin, route) {
    if (route.length < 4) return route;

    let best = [...route];
    let improved = true;
    let guard = 0;

    while (improved && guard < 12) {
      improved = false;
      guard++;

      for (let i = 0; i < best.length - 2; i++) {
        for (let k = i + 1; k < best.length - 1; k++) {
          const candidate = twoOptSwap(best, i, k);
          if (routeDistance(origin, candidate) + 1 < routeDistance(origin, best)) {
            best = candidate;
            improved = true;
          }
        }
      }
    }

    return best;
  }

  function twoOptSwap(route, i, k) {
    return [
      ...route.slice(0, i),
      ...route.slice(i, k + 1).reverse(),
      ...route.slice(k + 1)
    ];
  }

  function routeDistance(origin, route) {
    let total = 0;
    let cursor = origin;
    route.forEach(place => {
      total += haversine(cursor, place.geometry.location);
      cursor = place.geometry.location;
    });
    return total;
  }

  function buildRouteObject(places, profile, index) {
    let meters = estimateDistanceMeters(places);
    let walkMinutes = Math.max(6, Math.round(meters / 72));
    let dwell = places.reduce((s,p) => s + (p._dwell || 18), 0);
    let total = walkMinutes + dwell;
    const maxAllowed = selectedMinutes + Math.max(8, Math.round(selectedMinutes * .14));
    while (total > maxAllowed && places.length > 2) {
      places.pop();
      meters = estimateDistanceMeters(places);
      walkMinutes = Math.max(6, Math.round(meters / 72));
      dwell = places.reduce((s,p) => s + (p._dwell || 18), 0);
      total = walkMinutes + dwell;
    }
    const cost = estimateCost(places);
    return {
      title: makeRouteTitle(places, profile, index),
      desc: makeRouteDescription(places, profile, meters, total),
      profileName: profile.name,
      places,
      estimatedMinutes: Math.max(15, Math.round(total)),
      distanceMeters: Math.round(meters),
      costLow: cost.low,
      costHigh: cost.high,
      fatigue: calcFatigue(meters, total, places.length),
      funScore: calcFunScore(places, profile),
      keywords: makeKeywords(places, profile)
    };
  }

  function makeRouteTitle(places, profile, index) {
    const main = places[0]?.name ? cleanPlaceName(places[0].name) : profile.name;
    const cats = [...new Set(places.map(p => p._catName))];
    const second = cats[1] || cats[0] || "로컬";
    const patterns = [
      `${main} 중심 루트`,
      `${profile.name} 루트`,
      `${cats[0] || "로컬"} + ${second} 코스`,
      `${selectedMinutes}분 ${cats[0] || "주변"} 루트`,
      `${main} 주변 한 바퀴`
    ];
    return patterns[index % patterns.length];
  }

  function makeRouteDescription(places, profile, meters, total) {
    const pool = ENGINE.shortDescriptions[profile.id] || ["주변 장소를 랜덤으로 연결한 루트"];
    const a = pool[randomBetween(0, pool.length-1)];
    const b = meters < 900 ? "짧은 이동" : meters < 1700 ? "적당한 이동" : "많이 걷는 코스";
    const c = total <= selectedMinutes ? "시간 여유 있음" : "시간 꽉 참";
    return `${a} · ${b} · ${c}`;
  }

  function makeKeywords(places, profile) {
    const cats = [...new Set(places.map(p => p._catName))].slice(0,3);
    const levelKeys = ENGINE.keywords?.[selectedLevel] || [];
    return [...cats, ...levelKeys].slice(0,5);
  }

  function estimateDistanceMeters(places) {
    let total = 0, prev = currentPosition;
    for (const p of places) { total += haversine(prev, p.geometry.location); prev = p.geometry.location; }
    return total;
  }

  function estimateCost(places) {
    let low=0, high=0;
    places.forEach(p => { low += p._costLow || 0; high += p._costHigh || 10000; });
    return { low: roundMoney(low), high: roundMoney(high) };
  }

  function calcFatigue(meters, minutes, count) {
    let score = 0;
    if (meters > selectedMinutes/60 * LEVELS[selectedLevel].maxWalkPerHour) score += 2;
    else if (meters > selectedMinutes/60 * LEVELS.mid.maxWalkPerHour) score += 1;
    if (minutes > selectedMinutes) score += 1;
    if (count >= 6) score += 1;
    if (selectedLevel === "low") score -= 1;
    if (selectedLevel === "high") score += 1;
    return score <= 1 ? "하" : score <= 3 ? "중" : "상";
  }

  function calcFunScore(places, profile) {
    const diversity = new Set(places.map(p => p._cat)).size;
    const ratingAvg = places.reduce((s,p)=>s+(p.rating||3.7),0) / Math.max(1, places.length);
    let score = 58 + diversity*7 + places.length*3 + (ratingAvg-3.5)*9 + Math.random()*8;
    if (selectedLevel === "high") score += 4;
    if (selectedLevel === "low") score -= 1;
    return Math.min(99, Math.max(62, Math.round(score)));
  }

  function renderRoutes() {
    ui.routesList.innerHTML = generatedRoutes.map((route, idx) => {
      const spots = route.places.slice(0, 5).map((p, i) => `
        <div class="spot">
          <span class="spot-num">${i+1}</span>
          <span class="spot-name">${escapeHtml(p.name)}</span>
          <span class="spot-type">${escapeHtml(p._catName)}</span>
        </div>`).join("");
      const keywords = route.keywords.map(k => `<span>${escapeHtml(k)}</span>`).join("");
      return `<article class="route-card ${idx===activeRouteIndex?"active":""}" data-route-index="${idx}">
        <div class="route-top">
          <div>
            <h3>${idx+1}. ${escapeHtml(route.title)}</h3>
            <p class="route-desc">${escapeHtml(route.desc)}</p>
          </div>
          <span class="route-tag">${selectedMinutes}분 · ${LEVELS[selectedLevel].label}</span>
        </div>
        <div class="spot-list">${spots}</div>
        <div class="keywords">${keywords}</div>
        <div class="metrics">
          <div class="metric"><span>시간</span><strong>${route.estimatedMinutes}분</strong></div>
          <div class="metric"><span>비용</span><strong>${formatWon(route.costLow)}~${formatWon(route.costHigh)}</strong></div>
          <div class="metric"><span>거리</span><strong>${formatDistance(route.distanceMeters)}</strong></div>
          <div class="metric"><span>피로/재미</span><strong>${route.fatigue} · ${route.funScore}점</strong></div>
        </div>
      </article>`;
    }).join("");
    [...ui.routesList.querySelectorAll(".route-card")].forEach(card => {
      card.addEventListener("click", () => selectRoute(Number(card.dataset.routeIndex)));
    });
  }

  function selectRoute(index) {
    activeRouteIndex = index;
    const route = generatedRoutes[index];
    if (!route) return;
    [...ui.routesList.querySelectorAll(".route-card")].forEach((card, i) => card.classList.toggle("active", i === index));
    const names = route.places.slice(0,3).map(p=>p.name).join(" → ");
    ui.selectedRouteTitle.textContent = `${index+1}. ${route.title}`;
    ui.selectedRouteSubtitle.textContent = `${names} · ${route.estimatedMinutes}분 · ${formatDistance(route.distanceMeters)}`;
    renderRouteOnMap(route);
    setGoogleMapsLink(route);
    if (isMobileScreen()) {
      setMobileView("map");
      setTimeout(scrollToResults, 80);
    }
  }

  let fallbackLine = null;

  function renderRouteOnMap(route) {
    clearMarkers();
    clearFallbackLine();

    // 카드에 보이는 1→2→3→4 순서 그대로 실제 도보 경로선을 그립니다.
    // 즉, 지도에는 직선이 아니라 Google Directions가 계산한 도로/보행 경로가 표시됩니다.
    const orderedPlaces = orderPlacesSmart(route.places);
    route.places = orderedPlaces;

    const waypoints = orderedPlaces.slice(0, -1).map(p => ({
      location: p.geometry.location,
      stopover: true
    }));
    const destination = orderedPlaces[orderedPlaces.length - 1].geometry.location;

    markers.push(new google.maps.Marker({
      position: currentPosition,
      map,
      label: { text: "출발", color: "#fff", fontWeight: "900" },
      title: "출발 위치",
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: "#168179", fillOpacity: 1, strokeWeight: 3, strokeColor: "#fff" }
    }));

    orderedPlaces.forEach((p, i) => {
      markers.push(new google.maps.Marker({
        position: p.geometry.location,
        map,
        label: { text: String(i + 1), color: "#fff", fontWeight: "900" },
        title: `${i + 1}. ${p.name}`,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: "#315CE8", fillOpacity: 1, strokeWeight: 3, strokeColor: "#fff" }
      }));
    });

    directionsService.route({
      origin: currentPosition,
      destination,
      waypoints,
      travelMode: google.maps.TravelMode.WALKING,
      optimizeWaypoints: false,
      provideRouteAlternatives: false
    }, (result, status) => {
      if (status === "OK") {
        directionsRenderer.setDirections(result);
        updateRouteSummaryFromDirections(route, result);
      } else {
        directionsRenderer.setDirections({ routes: [] });
        drawFallbackPolyline(orderedPlaces);
        fitToMarkers();
        showToast("보행 경로 계산 실패: 임시 선으로 표시합니다.");
      }
    });
  }

  function updateRouteSummaryFromDirections(route, result) {
    const legs = result.routes?.[0]?.legs || [];
    if (!legs.length) return;

    const meters = legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0);
    const seconds = legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0);

    if (meters > 0) route.distanceMeters = meters;
    if (seconds > 0) {
      const moveMinutes = Math.round(seconds / 60);
      const dwell = route.places.reduce((sum, p) => sum + (p._dwell || 15), 0);
      route.estimatedMinutes = Math.max(15, moveMinutes + dwell);
    }

    ui.selectedRouteSubtitle.textContent =
      `${route.places.slice(0,3).map(p=>p.name).join(" → ")} · ${route.estimatedMinutes}분 · ${formatDistance(route.distanceMeters)}`;
  }

  function drawFallbackPolyline(places) {
    clearFallbackLine();

    const path = [
      currentPosition,
      ...places.map(p => p.geometry.location)
    ];

    fallbackLine = new google.maps.Polyline({
      path,
      geodesic: false,
      strokeColor: "#315CE8",
      strokeOpacity: 0.78,
      strokeWeight: 5,
      map
    });
  }

  function clearFallbackLine() {
    if (fallbackLine) {
      fallbackLine.setMap(null);
      fallbackLine = null;
    }
  }

  function setGoogleMapsLink(route) {
    const origin = latLngString(currentPosition);
    const destination = latLngString(route.places[route.places.length - 1].geometry.location);
    const waypoints = route.places.slice(0, -1).map(p => latLngString(p.geometry.location)).join("|");
    ui.googleMapsLink.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=walking${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}`;
    ui.googleMapsLink.classList.remove("disabled");
    ui.googleMapsLink.textContent = "Google 지도";
  }

  function categoryName(cat) {
    return ({market:"시장", food:"맛집", snack:"간식", cafe:"카페", photo:"포토", culture:"명소", walk:"산책", shopping:"상권"})[cat] || "장소";
  }

  function fallbackEngine() {
    return {
      categoryDefinitions: {
        food:{types:["restaurant"],keywords:["맛집"],cost:[8000,16000],dwell:[25,40],label:"맛집"},
        cafe:{types:["cafe"],keywords:["카페"],cost:[5000,12000],dwell:[20,35],label:"카페"},
        walk:{types:["park"],keywords:["공원"],cost:[0,3000],dwell:[15,25],label:"산책"}
      },
      routeProfiles: [{id:"balanced",name:"균형형",categories:["food","cafe","walk"],weight:1}],
      shortDescriptions:{balanced:["먹고 걷고 쉬는 균형형 코스"]},
      keywords:{mid:["균형"]}
    };
  }

  function haversine(a,b) {
    const lat1 = typeof a.lat === "function" ? a.lat() : a.lat;
    const lng1 = typeof a.lng === "function" ? a.lng() : a.lng;
    const lat2 = typeof b.lat === "function" ? b.lat() : b.lat;
    const lng2 = typeof b.lng === "function" ? b.lng() : b.lng;
    const R=6371000, toRad=d=>d*Math.PI/180;
    const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
    return 2*R*Math.asin(Math.sqrt(Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2));
  }

  function latLngString(ll) {
    const lat = typeof ll.lat === "function" ? ll.lat() : ll.lat;
    const lng = typeof ll.lng === "function" ? ll.lng() : ll.lng;
    return `${lat},${lng}`;
  }
  function clearMarkers(){ markers.forEach(m=>m.setMap(null)); markers=[]; if (typeof clearFallbackLine === "function") clearFallbackLine(); }
  function fitToMarkers(){ if(!markers.length)return; const bounds=new google.maps.LatLngBounds(); markers.forEach(m=>bounds.extend(m.getPosition())); map.fitBounds(bounds); }
  function roundMoney(n){ return Math.round(n/1000)*1000; }
  function formatWon(n){ if(n>=10000){const man=n/10000; return `${Number.isInteger(man)?man:man.toFixed(1)}만원`;} return `${n.toLocaleString()}원`; }
  function formatDistance(m){ return m>=1000?`${(m/1000).toFixed(1)}km`:`${Math.round(m)}m`; }
  function randomBetween(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
  function shuffle(arr){ return [...arr].sort(()=>Math.random()-.5); }
  function cleanPlaceName(name){ return String(name).replace(/\s+/g," ").replace(/점$/,"").slice(0,10); }
  function escapeHtml(str){ return String(str).replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[s])); }
  function showToast(msg){ ui.toast.textContent=msg; ui.toast.classList.add("show"); clearTimeout(showToast._t); showToast._t=setTimeout(()=>ui.toast.classList.remove("show"),2200); }


  function setMobileView(view) {
    if (!ui.resultsArea) return;
    document.body.classList.toggle("mobile-view-map", view === "map");
    document.body.classList.toggle("mobile-view-routes", view !== "map");

    if (ui.mobileResultTabs) {
      [...ui.mobileResultTabs.querySelectorAll("button")].forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mobileView === view);
      });
    }

    if (view === "map" && map) {
      setTimeout(() => {
        google.maps.event.trigger(map, "resize");
        if (markers.length) fitToMarkers();
      }, 80);
    }
  }

  function scrollToResults() {
    if (!ui.resultsArea) return;
    ui.resultsArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function isMobileScreen() {
    return window.matchMedia && window.matchMedia("(max-width: 780px)").matches;
  }


  boot();
})();
