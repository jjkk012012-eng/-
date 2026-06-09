
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
    toast: $("toast")
  };

  const LEVELS = {
    low: { label: "하", text: "가볍게", radiusMul: .75, countAdjust: -1, maxWalkPerHour: 850 },
    mid: { label: "중", text: "적당히", radiusMul: 1, countAdjust: 0, maxWalkPerHour: 1200 },
    high: { label: "상", text: "알차게", radiusMul: 1.35, countAdjust: 1, maxWalkPerHour: 1700 }
  };

  async function boot() {
    try {
      ENGINE = await fetch(ENGINE_URL).then(r => r.json());
    } catch {
      ENGINE = fallbackEngine();
    }
    loadGoogleMaps();
  }

  function loadGoogleMaps() {
    window.initTimeRouteApp = initMap;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}&libraries=places&language=ko&region=KR&callback=initTimeRouteApp`;
    script.async = true;
    script.defer = true;
    script.onerror = () => showToast("Google Maps 스크립트 로드 실패");
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
  }

  function bindEvents() {
    ui.topLocateBtn.addEventListener("click", tryAutoLocate);
    ui.cardLocateBtn.addEventListener("click", () => { setMode("current"); tryAutoLocate(); });
    ui.manualModeBtn.addEventListener("click", () => { setMode("manual"); ui.placeInput.focus(); setStatus("지역명을 입력하고 검색을 누르세요."); });
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
      showToast(`${val}분으로 적용했습니다.`);
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
    if (!navigator.geolocation) return showToast("이 브라우저는 위치 기능을 지원하지 않습니다.");
    setStatus("현재 위치 확인 중...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        setCurrentPosition(loc, "현재 위치");
        reverseGeocode(loc);
        showToast("현재 위치가 적용되었습니다.");
      },
      () => {
        setMode("manual");
        setStatus("위치 권한이 거부되었습니다. 지역명을 직접 입력해주세요.");
        showToast("직접 입력으로 사용할 수 있습니다.");
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
    );
  }

  function reverseGeocode(latlng) {
    geocoder.geocode({ location: latlng }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        ui.placeInput.value = results[0].formatted_address;
        setStatus(`출발 위치: ${results[0].formatted_address}`);
      }
    });
  }

  function geocodeSearch(silent=false) {
    return new Promise((resolve) => {
      const q = ui.placeInput.value.trim();
      if (!q) { if(!silent) showToast("지역명을 입력해주세요."); resolve(false); return; }
      setMode("manual");
      setStatus("입력한 지역을 찾는 중...");
      geocoder.geocode({ address: q, region: "KR" }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          setCurrentPosition(results[0].geometry.location, results[0].formatted_address);
          ui.placeInput.value = results[0].formatted_address;
          showToast("출발 지역이 적용되었습니다.");
          resolve(true);
        } else {
          setStatus("지역을 찾지 못했습니다. 예: 익산역, 광장시장처럼 입력해보세요.");
          showToast("지역을 찾지 못했습니다.");
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
    setStatus(`출발 위치: ${label}`);
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
    ui.summaryStrip.innerHTML = `현재 조건 <b>${selectedMinutes}분 · ${level.label} 코스</b>`;
  }

  async function generateRoutes() {
    if (!currentPosition) return showToast("현재 위치를 허용하거나 지역명을 검색해주세요.");
    ui.generateBtn.disabled = true;
    ui.resetBtn.disabled = true;
    ui.routesList.innerHTML = `<div class="empty"><div>✨</div><strong>루트 생성 중...</strong><p>주변 데이터를 모으고 랜덤 조합을 계산하고 있습니다.</p></div>`;

    try {
      const startGen = searchGeneration;
      const pools = await collectRichPlacePools();
      if (startGen !== searchGeneration) return;
      const allCount = Object.values(pools).flat().length;
      if (allCount < 3) throw new Error("not enough places");

      generatedRoutes = buildRoutesWithRetries(pools, 5);
      renderRoutes();
      selectRoute(0);
      showToast("랜덤 루트 5개를 다시 만들었습니다.");
    } catch (err) {
      console.error(err);
      ui.routesList.innerHTML = `<div class="empty"><div>⚠️</div><strong>루트 생성 실패</strong><p>지역을 조금 더 넓게 입력하거나 API 설정을 확인해주세요.</p></div>`;
      showToast("루트 생성 중 문제가 발생했습니다.");
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
      (def.keywords || []).slice(0, 5).forEach(keyword => tasks.push(searchTextKeyword(cat, keyword, radius)));
    });

    const groups = await Promise.all(tasks);
    const pools = {};
    for (const [cat] of Object.entries(defs)) pools[cat] = [];

    groups.flat().forEach(p => {
      if (!p || !p.place_id || !p.geometry || !p.geometry.location) return;
      const cat = p._cat || "walk";
      if (!pools[cat]) pools[cat] = [];
      if (!pools[cat].some(x => x.place_id === p.place_id)) pools[cat].push(p);
    });

    Object.keys(pools).forEach(cat => {
      pools[cat] = pools[cat]
        .map(p => ({ ...p, _distance: haversine(currentPosition, p.geometry.location) }))
        .filter(p => p._distance <= radius * 1.35)
        .sort((a,b) => scorePlace(b) - scorePlace(a))
        .slice(0, 25);
    });

    return pools;
  }

  function calcSearchRadius() {
    const base = selectedMinutes <= 30 ? 900 : selectedMinutes <= 60 ? 1400 : selectedMinutes <= 120 ? 2300 : 3300;
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
      _catName: categoryName(cat),
      _dwell: dwell,
      _costLow: cost[0],
      _costHigh: cost[1],
      _vibe: def.vibe || []
    };
  }

  function scorePlace(p) {
    const rating = p.rating || 3.7;
    const reviews = Math.min((p.user_ratings_total || 0) / 300, 1);
    const near = Math.max(0, 1 - (p._distance || 0) / Math.max(900, calcSearchRadius()));
    return rating * 1.4 + reviews * 2 + near * 2 + Math.random() * 2.8;
  }

  function buildRoutesWithRetries(pools, target) {
    const routes = [];
    const usedFingerprints = new Set();
    const usedTitles = new Set();
    let guard = 0;

    while (routes.length < target && guard < 90) {
      guard++;
      const profile = weightedProfile();
      const count = routePlaceCount();
      let places = pickPlacesByProfile(pools, profile, count);
      if (places.length < 2) places = pickFallbackPlaces(pools, count);
      places = orderPlacesSmart(places);

      const route = buildRouteObject(places, profile, routes.length);
      const fp = route.places.map(p => p.place_id).sort().join("|");
      if (usedFingerprints.has(fp) && guard < 70) continue;
      if (usedTitles.has(route.title)) route.title = makeAlternativeTitle(route, routes.length);
      usedFingerprints.add(fp);
      usedTitles.add(route.title);
      routes.push(route);
    }

    while (routes.length < target) {
      const fallback = buildRouteObject(orderPlacesSmart(pickFallbackPlaces(pools, routePlaceCount())), weightedProfile(), routes.length);
      fallback.title = makeAlternativeTitle(fallback, routes.length);
      routes.push(fallback);
    }

    return routes;
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
    base = [Math.max(2, base[0] + adj), Math.max(2, base[1] + adj)];
    return randomBetween(base[0], base[1]);
  }

  function pickPlacesByProfile(pools, profile, count) {
    const result = [];
    const categories = shuffle([...(profile.categories || Object.keys(pools))]);
    let turns = 0;
    while (result.length < count && turns < count * 5) {
      turns++;
      const cat = categories[turns % categories.length];
      const pool = pools[cat] || [];
      const picked = weightedPick(pool.filter(p => !result.some(x => x.place_id === p.place_id)));
      if (picked) result.push(picked);
    }
    return result;
  }

  function pickFallbackPlaces(pools, count) {
    const all = Object.values(pools).flat().filter(uniqueByPlaceId);
    return shuffle(all).sort((a,b) => scorePlace(b) - scorePlace(a)).slice(0, count);
  }

  function uniqueByPlaceId(p, i, arr) {
    return arr.findIndex(x => x.place_id === p.place_id) === i;
  }

  function weightedPick(pool) {
    if (!pool.length) return null;
    const sorted = pool.map(p => ({ p, w: Math.max(.2, scorePlace(p)) })).sort((a,b) => b.w - a.w).slice(0, 12);
    const total = sorted.reduce((s,x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const x of sorted) {
      r -= x.w;
      if (r <= 0) return x.p;
    }
    return sorted[0].p;
  }

  function orderPlacesSmart(places) {
    const remaining = [...places];
    const ordered = [];
    let cursor = currentPosition;
    while (remaining.length) {
      remaining.sort((a,b) => {
        const da = haversine(cursor, a.geometry.location);
        const db = haversine(cursor, b.geometry.location);
        return (da + Math.random()*160) - (db + Math.random()*160);
      });
      const next = remaining.splice(0, 1)[0];
      ordered.push(next);
      cursor = next.geometry.location;
    }
    if (Math.random() < .28 && ordered.length > 3) {
      const i = randomBetween(1, ordered.length-2);
      [ordered[i], ordered[i+1]] = [ordered[i+1], ordered[i]];
    }
    return ordered;
  }

  function buildRouteObject(places, profile, index) {
    let meters = estimateDistanceMeters(places);
    let walkMinutes = Math.max(6, Math.round(meters / 72));
    let dwell = places.reduce((s,p) => s + (p._dwell || 18), 0);
    let total = walkMinutes + dwell;

    const maxAllowed = selectedMinutes + Math.max(8, Math.round(selectedMinutes * .12));
    while (total > maxAllowed && places.length > 2) {
      places.pop();
      meters = estimateDistanceMeters(places);
      walkMinutes = Math.max(6, Math.round(meters / 72));
      dwell = places.reduce((s,p) => s + (p._dwell || 18), 0);
      total = walkMinutes + dwell;
    }

    const cost = estimateCost(places);
    const cats = [...new Set(places.map(p => p._catName))];
    const title = makeRouteTitle(places, profile, index);
    const desc = makeRouteDescription(places, profile, meters, total);

    return {
      title,
      desc,
      profileName: profile.name,
      places,
      estimatedMinutes: Math.max(15, Math.round(total)),
      distanceMeters: Math.round(meters),
      costLow: cost.low,
      costHigh: cost.high,
      fatigue: calcFatigue(meters, total, places.length),
      funScore: calcFunScore(places, profile, meters),
      categories: cats
    };
  }

  function makeRouteTitle(places, profile, index) {
    const parts = ENGINE.titleParts;
    const cats = places.map(p => p._catName).filter(Boolean);
    const unique = [...new Set(cats)];
    const timePrefix = selectedMinutes <= 30 ? "초간단" : selectedMinutes <= 60 ? "짧은" : selectedMinutes <= 120 ? "여유" : "반나절";
    const levelPrefix = selectedLevel === "low" ? "가벼운" : selectedLevel === "mid" ? "균형형" : "알찬";
    const first = unique[0] || pick(parts.middle);
    const second = unique.find(c => c !== first) || pick(parts.middle);
    const firstPlace = cleanPlaceName(places[0]?.name || "");
    const patterns = [
      `${timePrefix} ${first} ${pick(parts.suffix)}`,
      `${levelPrefix} ${first}·${second} 루트`,
      `${firstPlace ? firstPlace + " 주변 " : ""}${second} 랜덤 코스`,
      `${first}에서 ${second}까지 한 바퀴`,
      `${profile.name}`,
      `${pick(parts.prefix)} ${first} ${second} 루트`,
      `${selectedMinutes}분 ${first} 집중 루트`
    ];
    return patterns[index % patterns.length];
  }

  function makeAlternativeTitle(route, index) {
    const cats = route.categories || ["로컬"];
    return `${cats[index % cats.length]} ${index + 1}번 랜덤 루트`;
  }

  function makeRouteDescription(places, profile, meters, total) {
    const d = ENGINE.descriptionParts;
    const cats = [...new Set(places.map(p => p._catName))].join("·");
    const firstLine = `${pick(d.start)} ${cats ? cats + " 요소를 함께 넣었습니다." : ""}`;
    const distanceLine = meters < 800 ? "이동거리가 짧아 바로 움직이기 좋습니다." :
                         meters < 1600 ? "적당히 걷는 코스로 지역 분위기를 느끼기 좋습니다." :
                         "걷는 양은 조금 있지만 여러 장소를 넓게 볼 수 있습니다.";
    const timeLine = total <= selectedMinutes - 12 ? "입력한 시간보다 여유가 있어 부담이 적습니다." :
                     total <= selectedMinutes + 5 ? "입력한 시간에 맞춰 알차게 구성했습니다." :
                     "시간 안에서 최대한 많은 장소를 담은 코스입니다.";
    const ending = pick(d.ending);
    return `${firstLine} ${distanceLine} ${timeLine} ${ending}`;
  }

  function estimateDistanceMeters(places) {
    let total = 0, prev = currentPosition;
    for (const p of places) {
      total += haversine(prev, p.geometry.location);
      prev = p.geometry.location;
    }
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

  function calcFunScore(places, profile, meters) {
    const diversity = new Set(places.map(p => p._cat)).size;
    const ratingAvg = places.reduce((s,p)=>s+(p.rating||3.7),0) / Math.max(1, places.length);
    const reviewBoost = Math.min(8, places.reduce((s,p)=>s+(p.user_ratings_total||0),0)/500);
    let score = 58 + diversity*7 + places.length*3 + (ratingAvg-3.5)*9 + reviewBoost + Math.random()*7;
    if (profile.id === "hidden_mix") score += 4;
    if (selectedLevel === "high") score += 4;
    if (selectedLevel === "low") score -= 1;
    return Math.min(99, Math.max(62, Math.round(score)));
  }

  function renderRoutes() {
    ui.routesList.innerHTML = generatedRoutes.map((route, idx) => {
      const placeNames = route.places.map((p, i) => `${i+1}. ${escapeHtml(p.name)}`).join(" · ");
      return `<article class="route-card ${idx===activeRouteIndex?"active":""}" data-route-index="${idx}">
        <div class="route-top">
          <div>
            <h3>${idx+1}. ${escapeHtml(route.title)}</h3>
            <p class="route-desc">${escapeHtml(route.desc)}</p>
          </div>
          <span class="route-tag">${selectedMinutes}분 · ${LEVELS[selectedLevel].label}</span>
        </div>
        <div class="metrics">
          <div class="metric"><span>예상 시간</span><strong>${route.estimatedMinutes}분</strong></div>
          <div class="metric"><span>예상 비용</span><strong>${formatWon(route.costLow)}~${formatWon(route.costHigh)}</strong></div>
          <div class="metric"><span>이동 거리</span><strong>${formatDistance(route.distanceMeters)}</strong></div>
          <div class="metric"><span>피로도 / 재미도</span><strong>${route.fatigue} · ${route.funScore}점</strong></div>
        </div>
        <p class="waypoints">${placeNames}</p>
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
    ui.selectedRouteTitle.textContent = `${index+1}. ${route.title}`;
    ui.selectedRouteSubtitle.textContent = `${route.estimatedMinutes}분 · ${formatDistance(route.distanceMeters)} · ${formatWon(route.costLow)}~${formatWon(route.costHigh)} · 피로도 ${route.fatigue} · 재미도 ${route.funScore}점`;
    renderRouteOnMap(route);
    setGoogleMapsLink(route);
  }

  function renderRouteOnMap(route) {
    clearMarkers();
    const waypoints = route.places.slice(0, -1).map(p => ({ location: p.geometry.location, stopover: true }));
    const destination = route.places[route.places.length - 1].geometry.location;

    markers.push(new google.maps.Marker({
      position: currentPosition, map,
      label: { text: "출발", color: "#fff", fontWeight: "900" },
      title: "출발 위치",
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: "#168179", fillOpacity: 1, strokeWeight: 3, strokeColor: "#fff" }
    }));

    route.places.forEach((p, i) => {
      markers.push(new google.maps.Marker({
        position: p.geometry.location, map,
        label: { text: String(i+1), color: "#fff", fontWeight: "900" },
        title: p.name,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: "#315CE8", fillOpacity: 1, strokeWeight: 3, strokeColor: "#fff" }
      }));
    });

    directionsService.route({
      origin: currentPosition,
      destination,
      waypoints,
      travelMode: google.maps.TravelMode.WALKING,
      optimizeWaypoints: false
    }, (result, status) => {
      if (status === "OK") directionsRenderer.setDirections(result);
      else { directionsRenderer.setDirections({ routes: [] }); fitToMarkers(); showToast("경로 계산 실패: 마커 중심으로 표시합니다."); }
    });
  }

  function setGoogleMapsLink(route) {
    const origin = latLngString(currentPosition);
    const destination = latLngString(route.places[route.places.length - 1].geometry.location);
    const waypoints = route.places.slice(0, -1).map(p => latLngString(p.geometry.location)).join("|");
    ui.googleMapsLink.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=walking${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}`;
    ui.googleMapsLink.classList.remove("disabled");
    ui.googleMapsLink.textContent = "Google 지도 길찾기";
  }

  function categoryName(cat) {
    return ({
      market:"시장", food:"먹거리", snack:"간식", cafe:"카페", photo:"포토스팟",
      culture:"문화", walk:"산책", shopping:"상권"
    })[cat] || "장소";
  }

  function fallbackEngine() {
    return {
      categoryDefinitions: {
        food:{types:["restaurant"],keywords:["맛집"],cost:[8000,16000],dwell:[25,40],vibe:["먹거리"]},
        cafe:{types:["cafe"],keywords:["카페"],cost:[5000,12000],dwell:[20,35],vibe:["휴식"]},
        walk:{types:["park"],keywords:["공원"],cost:[0,3000],dwell:[15,25],vibe:["산책"]}
      },
      routeProfiles: [{id:"balanced",name:"균형형 주변 루트",categories:["food","cafe","walk"],weight:1}],
      titleParts:{prefix:["랜덤"],middle:["로컬"],suffix:["루트"]},
      descriptionParts:{start:["현재 위치 주변 장소를 연결했습니다."],ending:["바로 실행하기 좋습니다."]}
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
  function clearMarkers(){ markers.forEach(m=>m.setMap(null)); markers=[]; }
  function fitToMarkers(){ if(!markers.length)return; const bounds=new google.maps.LatLngBounds(); markers.forEach(m=>bounds.extend(m.getPosition())); map.fitBounds(bounds); }
  function roundMoney(n){ return Math.round(n/1000)*1000; }
  function formatWon(n){ if(n>=10000){const man=n/10000; return `${Number.isInteger(man)?man:man.toFixed(1)}만원`;} return `${n.toLocaleString()}원`; }
  function formatDistance(m){ return m>=1000?`${(m/1000).toFixed(1)}km`:`${Math.round(m)}m`; }
  function randomBetween(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
  function pick(arr){ return arr[randomBetween(0, arr.length-1)]; }
  function shuffle(arr){ return [...arr].sort(()=>Math.random()-.5); }
  function cleanPlaceName(name){ return String(name).replace(/\s+/g," ").replace(/점$/,"").slice(0,8); }
  function escapeHtml(str){ return String(str).replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[s])); }
  function showToast(msg){ ui.toast.textContent=msg; ui.toast.classList.add("show"); clearTimeout(showToast._t); showToast._t=setTimeout(()=>ui.toast.classList.remove("show"),2400); }

  boot();
})();
