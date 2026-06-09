
(() => {
  const CONFIG = window.TIMEROUTE_CONFIG || {};
  const API_KEY = CONFIG.GOOGLE_MAPS_API_KEY;

  let map, directionsService, directionsRenderer, geocoder, placesService;
  let currentPosition = null;
  let selectedMinutes = 60;
  let selectedLevel = "mid";
  let generatedRoutes = [];
  let activeRouteIndex = 0;
  let markers = [];

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
    low: { label: "하", text: "가볍게", radius: 900 },
    mid: { label: "중", text: "적당히", radius: 1500 },
    high: { label: "상", text: "알차게", radius: 2400 }
  };

  const PLACE_TYPES = [
    { type: "tourist_attraction", label: "관광지", cost: [0, 5000], dwell: 18 },
    { type: "restaurant", label: "먹거리", cost: [8000, 16000], dwell: 30 },
    { type: "cafe", label: "카페", cost: [5000, 10000], dwell: 28 },
    { type: "bakery", label: "간식", cost: [3000, 9000], dwell: 15 },
    { type: "shopping_mall", label: "상권", cost: [5000, 20000], dwell: 22 },
    { type: "park", label: "산책", cost: [0, 3000], dwell: 18 },
    { type: "museum", label: "문화", cost: [0, 10000], dwell: 28 }
  ];

  const ROUTE_TITLES = [
    "로컬 먹거리 산책 루트","골목 분위기 탐방 루트","시장 주변 가벼운 루트","카페와 포토스팟 루트",
    "숨은 장소 랜덤 루트","짧고 알찬 동네 투어","시장·상권 연결 루트","현재 위치 주변 랜덤 루트"
  ];

  const DESC_TEMPLATES = [
    "현재 위치 주변의 먹거리와 산책 장소를 자연스럽게 연결한 루트입니다. 이동 부담을 줄이면서 지역 분위기를 느끼기 좋습니다.",
    "가까운 상권과 휴식 장소를 섞어 만든 랜덤 루트입니다. 짧은 시간 안에 가볍게 둘러보기 좋습니다.",
    "시장·카페·주변 명소를 균형 있게 연결한 코스입니다. 너무 복잡하지 않게 현재 위치 주변을 즐길 수 있습니다.",
    "유명 장소만 고르기보다 주변의 다양한 장소를 랜덤으로 섞은 루트입니다. 다시 뽑기로 다른 분위기를 선택할 수 있습니다.",
    "걷는 거리와 체류시간을 고려해 만든 실행 가능한 루트입니다. 지금 가진 시간 안에서 바로 움직이기 좋습니다."
  ];

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
      fullscreenControl: true
    });

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      preserveViewport: false,
      polylineOptions: { strokeColor: "#1d4ed8", strokeWeight: 6, strokeOpacity: .86 }
    });
    geocoder = new google.maps.Geocoder();
    placesService = new google.maps.places.PlacesService(map);

    bindEvents();
    updateSummary();
  }

  function bindEvents() {
    ui.topLocateBtn.addEventListener("click", tryAutoLocate);
    ui.cardLocateBtn.addEventListener("click", () => {
      setMode("current");
      tryAutoLocate();
    });
    ui.manualModeBtn.addEventListener("click", () => {
      setMode("manual");
      ui.placeInput.focus();
      ui.locationStatus.textContent = "지역명을 입력하고 검색을 누르세요. 예: 익산역, 광장시장";
    });
    ui.useSearchBtn.addEventListener("click", geocodeSearch);
    ui.placeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") geocodeSearch();
    });
    document.querySelectorAll("[data-place]").forEach(btn => {
      btn.addEventListener("click", () => {
        setMode("manual");
        ui.placeInput.value = btn.dataset.place;
        geocodeSearch();
      });
    });

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

  function tryAutoLocate() {
    if (!navigator.geolocation) return showToast("이 브라우저는 위치 기능을 지원하지 않습니다.");
    ui.locationStatus.textContent = "현재 위치 확인 중...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        setCurrentPosition(loc, "현재 위치");
        reverseGeocode(loc);
        showToast("현재 위치가 적용되었습니다.");
      },
      () => {
        setMode("manual");
        ui.locationStatus.textContent = "위치 권한이 거부되었습니다. 지역명을 직접 입력해주세요.";
        showToast("지역명을 직접 입력해서 사용할 수 있습니다.");
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
    );
  }

  function reverseGeocode(latlng) {
    geocoder.geocode({ location: latlng }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        ui.placeInput.value = results[0].formatted_address;
        ui.locationStatus.textContent = `출발 위치: ${results[0].formatted_address}`;
      }
    });
  }

  function geocodeSearch(silent=false) {
    return new Promise((resolve) => {
      const q = ui.placeInput.value.trim();
      if (!q) {
        if (!silent) showToast("지역명을 입력해주세요.");
        resolve(false);
        return;
      }
      setMode("manual");
      ui.locationStatus.textContent = "입력한 지역을 찾는 중...";
      geocoder.geocode({ address: q, region: "KR" }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          setCurrentPosition(results[0].geometry.location, results[0].formatted_address);
          ui.placeInput.value = results[0].formatted_address;
          showToast("직접 입력한 지역이 적용되었습니다.");
          resolve(true);
        } else {
          ui.locationStatus.textContent = "지역을 찾지 못했습니다. 예: 익산역, 광장시장처럼 입력해보세요.";
          showToast("지역을 찾지 못했습니다.");
          resolve(false);
        }
      });
    });
  }

  function setCurrentPosition(latlng, label) {
    currentPosition = latlng;
    map.setCenter(latlng);
    map.setZoom(15);
    ui.locationStatus.textContent = `출발 위치: ${label}`;
    showStartMarker(latlng);
  }

  function showStartMarker(latlng) {
    clearMarkers();
    directionsRenderer.setDirections({ routes: [] });
    markers.push(new google.maps.Marker({
      position: latlng,
      map,
      label: { text: "출발", color: "#fff", fontWeight: "900" },
      title: "출발 위치",
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: "#0f766e", fillOpacity: 1, strokeWeight: 3, strokeColor: "#ffffff" }
    }));
  }

  function updateSummary() {
    const level = LEVELS[selectedLevel];
    ui.summaryStrip.innerHTML = `<span>현재 조건</span><strong>${selectedMinutes}분 · ${level.label} 코스</strong>`;
  }

  async function generateRoutes() {
    if (!currentPosition) return showToast("현재 위치를 허용하거나 지역명을 검색해주세요.");
    ui.generateBtn.disabled = true;
    ui.resetBtn.disabled = true;
    ui.routesList.classList.remove("empty");
    ui.routesList.innerHTML = `<div class="empty-state"><div class="empty-icon">✨</div><h3>랜덤 루트 생성 중...</h3><p>주변 장소를 모으고 5개 루트를 조합하고 있습니다.</p></div>`;
    try {
      let places = await collectNearbyPlaces(false);
      if (places.length < 3) places = await collectNearbyPlaces(true);
      if (places.length < 2) throw new Error("not enough places");
      generatedRoutes = buildFiveRoutes(places);
      renderRoutes();
      selectRoute(0);
      showToast("랜덤 루트 5개를 생성했습니다.");
    } catch (err) {
      console.error(err);
      ui.routesList.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>루트 생성 실패</h3><p>API 설정, 위치, 또는 주변 장소 검색 상태를 확인해주세요.</p></div>`;
      showToast("루트 생성 중 문제가 발생했습니다.");
    } finally {
      ui.generateBtn.disabled = false;
      ui.resetBtn.disabled = false;
    }
  }

  function collectNearbyPlaces(expanded=false) {
    const radius = expanded ? 4200 : LEVELS[selectedLevel].radius + Math.min(selectedMinutes * 8, 1000);
    return Promise.all(PLACE_TYPES.map(({type,label}) => nearbySearch(type,label,radius))).then(groups => {
      const mapById = new Map();
      groups.flat().forEach(p => {
        if (p.place_id && p.geometry && p.geometry.location && !mapById.has(p.place_id)) mapById.set(p.place_id, p);
      });
      return [...mapById.values()].sort(() => Math.random() - .5).slice(0, 90);
    });
  }

  function nearbySearch(type,label,radius) {
    return new Promise(resolve => {
      placesService.nearbySearch({ location: currentPosition, radius, type }, (results,status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results) return resolve([]);
        resolve(results.map(r => ({...r, categoryLabel: label, estimatedCost: costForType(type), dwellMinutes: dwellForType(type)})));
      });
    });
  }

  function costForType(type){ const f=PLACE_TYPES.find(x=>x.type===type); return f?f.cost:[3000,12000]; }
  function dwellForType(type){ const f=PLACE_TYPES.find(x=>x.type===type); return f?f.dwell:18; }

  function buildFiveRoutes(places) {
    const routes = [];
    for (let i=0;i<5;i++) {
      const count = randomBetween(getPlaceCount().min, getPlaceCount().max);
      const picked = pickDiversePlaces(weightedShuffle(places), count);
      routes.push(buildRouteObject(picked, i));
    }
    return routes;
  }

  function getPlaceCount(){
    let base = selectedMinutes <= 30 ? {min:2,max:3} : selectedMinutes <= 60 ? {min:3,max:4} : selectedMinutes <= 120 ? {min:4,max:5} : {min:5,max:6};
    if(selectedLevel==="low"){base.min=Math.max(2,base.min-1);base.max=Math.max(base.min,base.max-1);}
    if(selectedLevel==="high"){base.min+=1;base.max+=1;}
    return base;
  }

  function weightedShuffle(places){
    return [...places].map(p=>({p,score:(p.rating||3.5)*.3+Math.random()*4+Math.min((p.user_ratings_total||0)/250,1)})).sort((a,b)=>b.score-a.score).map(x=>x.p);
  }

  function pickDiversePlaces(places,count){
    const picked=[], cc={};
    for(const p of places){ const k=p.categoryLabel||"장소"; if((cc[k]||0)>=2) continue; picked.push(p); cc[k]=(cc[k]||0)+1; if(picked.length>=count) break; }
    for(const p of places){ if(picked.length>=count) break; if(!picked.find(x=>x.place_id===p.place_id)) picked.push(p); }
    return picked;
  }

  function buildRouteObject(places,index){
    const meters = estimateDistanceMeters(places);
    const walkMinutes = Math.max(5, Math.round(meters/70));
    const dwell = places.reduce((s,p)=>s+(p.dwellMinutes||18),0);
    const totalMinutes = fitMinutes(walkMinutes + dwell);
    const cost = estimateCost(places);
    return {
      title: titleForRoute(places,index),
      desc: descriptionForRoute(places,meters,totalMinutes),
      places,
      estimatedMinutes: totalMinutes,
      distanceMeters: meters,
      costLow: cost.low,
      costHigh: cost.high,
      fatigue: calcFatigue(meters,totalMinutes),
      funScore: calcFunScore(places)
    };
  }

  function fitMinutes(raw){ if(raw<=selectedMinutes) return Math.max(20,Math.round(raw)); return Math.max(20, selectedMinutes-randomBetween(2,9)); }
  function estimateDistanceMeters(places){ let total=0, prev=currentPosition; for(const p of places){ total+=haversine(prev,p.geometry.location); prev=p.geometry.location; } return Math.round(total); }
  function haversine(a,b){ const lat1=typeof a.lat==="function"?a.lat():a.lat, lng1=typeof a.lng==="function"?a.lng():a.lng, lat2=typeof b.lat==="function"?b.lat():b.lat, lng2=typeof b.lng==="function"?b.lng():b.lng; const R=6371000,toRad=d=>d*Math.PI/180,dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1); return 2*R*Math.asin(Math.sqrt(Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2));}
  function estimateCost(places){ let low=0,high=0; places.forEach(p=>{const c=p.estimatedCost||[3000,12000];low+=c[0];high+=c[1];}); return {low:roundMoney(low),high:roundMoney(high)};}
  function roundMoney(n){ return Math.round(n/1000)*1000; }
  function calcFatigue(meters,minutes){ let s=0; if(meters>1800)s+=2; else if(meters>1000)s+=1; if(minutes>130)s+=2; else if(minutes>65)s+=1; if(selectedLevel==="high")s+=1; if(selectedLevel==="low")s-=1; return s<=1?"하":s<=3?"중":"상"; }
  function calcFunScore(places){ const div=new Set(places.map(p=>p.categoryLabel)).size; const avg=places.reduce((s,p)=>s+(p.rating||3.8),0)/Math.max(1,places.length); let score=60+div*7+(avg-3.5)*10+places.length*3+randomBetween(0,8); if(selectedLevel==="high")score+=5; if(selectedLevel==="low")score-=2; return Math.min(98,Math.max(65,Math.round(score))); }
  function titleForRoute(places,index){ const cats=[...new Set(places.map(p=>p.categoryLabel))]; if(cats.includes("먹거리")&&cats.includes("카페"))return"먹거리·카페 랜덤 루트"; if(cats.includes("관광지")&&cats.includes("산책"))return"주변 명소 산책 루트"; if(cats.includes("간식")&&cats.includes("상권"))return"간식과 상권 연결 루트"; if(cats.includes("문화"))return"문화 감성 랜덤 루트"; return ROUTE_TITLES[(index+randomBetween(0,ROUTE_TITLES.length-1))%ROUTE_TITLES.length];}
  function descriptionForRoute(places,meters,minutes){ const base=DESC_TEMPLATES[randomBetween(0,DESC_TEMPLATES.length-1)]; const add=meters<900?"이동거리가 짧아 부담이 적고, 바로 실행하기 좋습니다.":meters<1600?"적당히 걷는 코스로 지역 분위기를 느끼기 좋습니다.":"조금 더 많이 걷지만 다양한 장소를 둘러볼 수 있는 루트입니다."; return `${base} ${add}`;}

  function renderRoutes(){
    ui.routesList.innerHTML=generatedRoutes.map((route,idx)=>{
      const placeNames=route.places.map((p,i)=>`${i+1}. ${escapeHtml(p.name)}`).join(" · ");
      return `<article class="route-card ${idx===activeRouteIndex?"active":""}" data-route-index="${idx}">
        <div class="route-top"><div><h3>${idx+1}. ${escapeHtml(route.title)}</h3><p class="route-desc">${escapeHtml(route.desc)}</p></div><span class="route-tag">${selectedMinutes}분 · ${LEVELS[selectedLevel].label}</span></div>
        <div class="metrics">
          <div class="metric"><span>예상 시간</span><strong>${route.estimatedMinutes}분</strong></div>
          <div class="metric"><span>예상 비용</span><strong>${formatWon(route.costLow)}~${formatWon(route.costHigh)}</strong></div>
          <div class="metric"><span>이동 거리</span><strong>${formatDistance(route.distanceMeters)}</strong></div>
          <div class="metric"><span>피로도 / 재미도</span><strong>${route.fatigue} · ${route.funScore}점</strong></div>
        </div><p class="waypoints">${placeNames}</p></article>`;
    }).join("");
    [...ui.routesList.querySelectorAll(".route-card")].forEach(card=>card.addEventListener("click",()=>selectRoute(Number(card.dataset.routeIndex))));
  }

  function selectRoute(index){
    activeRouteIndex=index; const route=generatedRoutes[index]; if(!route)return;
    [...ui.routesList.querySelectorAll(".route-card")].forEach((card,i)=>card.classList.toggle("active",i===index));
    ui.selectedRouteTitle.textContent=`${index+1}. ${route.title}`;
    ui.selectedRouteSubtitle.textContent=`${route.estimatedMinutes}분 · ${formatDistance(route.distanceMeters)} · ${formatWon(route.costLow)}~${formatWon(route.costHigh)} · 피로도 ${route.fatigue} · 재미도 ${route.funScore}점`;
    renderRouteOnMap(route); setGoogleMapsLink(route);
  }

  function renderRouteOnMap(route){
    clearMarkers();
    const waypoints=route.places.slice(0,-1).map(p=>({location:p.geometry.location,stopover:true}));
    const destination=route.places[route.places.length-1].geometry.location;
    markers.push(new google.maps.Marker({position:currentPosition,map,label:{text:"출발",color:"#fff",fontWeight:"900"},title:"출발 위치",icon:{path:google.maps.SymbolPath.CIRCLE,scale:11,fillColor:"#0f766e",fillOpacity:1,strokeWeight:3,strokeColor:"#ffffff"}}));
    route.places.forEach((p,i)=>markers.push(new google.maps.Marker({position:p.geometry.location,map,label:{text:String(i+1),color:"#fff",fontWeight:"900"},title:p.name,icon:{path:google.maps.SymbolPath.CIRCLE,scale:12,fillColor:"#1d4ed8",fillOpacity:1,strokeWeight:3,strokeColor:"#ffffff"}})));
    directionsService.route({origin:currentPosition,destination,waypoints,travelMode:google.maps.TravelMode.WALKING,optimizeWaypoints:false},(result,status)=>{
      if(status==="OK") directionsRenderer.setDirections(result); else { directionsRenderer.setDirections({routes:[]}); fitToMarkers(); showToast("경로 계산 실패: 마커 중심으로 표시합니다."); }
    });
  }

  function setGoogleMapsLink(route){
    const origin=latLngString(currentPosition), destination=latLngString(route.places[route.places.length-1].geometry.location);
    const waypoints=route.places.slice(0,-1).map(p=>latLngString(p.geometry.location)).join("|");
    ui.googleMapsLink.href=`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=walking${waypoints?`&waypoints=${encodeURIComponent(waypoints)}`:""}`;
    ui.googleMapsLink.classList.remove("disabled");
    ui.googleMapsLink.textContent="Google 지도 길찾기";
  }

  function latLngString(ll){ const lat=typeof ll.lat==="function"?ll.lat():ll.lat, lng=typeof ll.lng==="function"?ll.lng():ll.lng; return `${lat},${lng}`; }
  function clearMarkers(){ markers.forEach(m=>m.setMap(null)); markers=[]; }
  function fitToMarkers(){ if(!markers.length)return; const bounds=new google.maps.LatLngBounds(); markers.forEach(m=>bounds.extend(m.getPosition())); map.fitBounds(bounds); }
  function formatWon(n){ if(n>=10000){const man=n/10000; return `${Number.isInteger(man)?man:man.toFixed(1)}만원`;} return `${n.toLocaleString()}원`; }
  function formatDistance(m){ return m>=1000?`${(m/1000).toFixed(1)}km`:`${m}m`; }
  function randomBetween(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
  function escapeHtml(str){ return String(str).replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[s])); }
  function showToast(msg){ ui.toast.textContent=msg; ui.toast.classList.add("show"); clearTimeout(showToast._t); showToast._t=setTimeout(()=>ui.toast.classList.remove("show"),2300); }

  loadGoogleMaps();
})();
