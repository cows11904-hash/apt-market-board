export function kakaoMapLink(query) {
  return 'https://map.kakao.com/link/search/' + encodeURIComponent(query);
}

export function validMapBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return false;
  const [west, south, east, north] = bounds;
  return west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north;
}

function loadKakaoMaps(key) {
  const url = new URL('https://dapi.kakao.com/v2/maps/sdk.js');
  url.searchParams.set('appkey', key);
  url.searchParams.set('libraries', 'services');
  url.searchParams.set('autoload', 'false');
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    function fail() {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('카카오 지도를 불러오지 못했습니다.'));
    }
    const timeout = setTimeout(fail, 8_000);
    script.async = true;
    script.referrerPolicy = 'origin';
    script.src = url.href;
    script.onerror = fail;
    script.onload = () => {
      if (!globalThis.kakao?.maps?.load) {
        fail();
        return;
      }
      globalThis.kakao.maps.load(() => {
        clearTimeout(timeout);
        resolve(globalThis.kakao.maps);
      });
    };
    document.head.append(script);
  });
}

const nameKey = value => String(value ?? '').normalize('NFKC').replace(/[\s()·-]/g, '').toLowerCase();

function findApartment(maps, query, districtName, complex) {
  return new Promise(resolve => {
    new maps.services.Places().keywordSearch(query, (places, status) => {
      if (status !== maps.services.Status.OK) {
        resolve(null);
        return;
      }
      const matches = places.filter(place => {
        const address = place.address_name ?? '';
        const districtMatches = address.split(/\s+/).includes(districtName);
        const neighborhoodMatches = !complex.dong || address.split(/\s+/).includes(complex.dong);
        return nameKey(place.place_name) === nameKey(complex.aptName) && districtMatches && neighborhoodMatches;
      });
      const [match] = matches;
      if (matches.length !== 1 || !Number.isFinite(Number(match.y)) || !Number.isFinite(Number(match.x))) {
        resolve(null);
        return;
      }
      resolve(new maps.LatLng(Number(match.y), Number(match.x)));
    });
  });
}

export function createQuoteMap({ raster, canvas, placeholder, hint }) {
  let sdk;
  let map;
  let marker;
  let regionalMap;
  let regionalBounds;
  let regionalMarker;
  let selectionKey;
  let version = 0;

  function showRegionalMap(bounds, regionName, apartment) {
    canvas.hidden = true;
    const leaflet = globalThis.L;
    const available = Boolean(bounds && leaflet);
    raster.hidden = !available;
    placeholder.hidden = available;
    hint.textContent = '';
    if (!available) {
      placeholder.textContent = bounds ? '지도를 불러오지 못했습니다. 카카오맵에서 위치를 확인할 수 있습니다.' : '이 지역의 지도 범위를 준비하고 있습니다.';
      return;
    }
    raster.setAttribute('aria-label', regionName + ' OpenStreetMap 지도');
    if (!regionalMap) {
      regionalMap = leaflet.map(raster, { scrollWheelZoom: false });
      regionalMap.attributionControl.setPrefix(false);
      leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        keepBuffer: 0,
        updateWhenIdle: true,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap 기여자</a>',
      }).on('tileerror', () => {
        if (!raster.hidden) hint.textContent = '일부 지도를 불러오지 못했습니다. 카카오맵에서도 위치를 확인할 수 있습니다.';
      }).addTo(regionalMap);
    }
    regionalMap.invalidateSize({ pan: false });
    if (regionalMarker) { regionalMarker.remove(); regionalMarker = null; }
    const coordinates = apartment?.profile?.coordinates;
    if (coordinates) {
      const [longitude, latitude] = coordinates;
      regionalMap.setView([latitude, longitude], 16, { animate: false });
      regionalMarker = leaflet.circleMarker([latitude, longitude], { radius: 9, color: '#fff', weight: 3, fillColor: '#17665d', fillOpacity: 1 }).addTo(regionalMap);
      const label = document.createElement('span'); label.textContent = apartment.aptName;
      regionalMarker.bindTooltip(label, { permanent: true, direction: 'top' });
      regionalBounds = null;
    } else if (bounds !== regionalBounds) {
      const [west, south, east, north] = bounds;
      regionalMap.invalidateSize({ pan: false });
      regionalMap.fitBounds([[south, west], [north, east]], { animate: false });
      regionalBounds = bounds;
    }
    hint.textContent = coordinates ? '서울시 제공 좌표 · ' + apartment.aptName
      : apartment ? '단지 좌표가 없어 지역 범위를 표시합니다. 카카오맵에서 위치를 확인할 수 있습니다.' : '단지를 선택하면 확인된 위치를 표시합니다.';
  }

  return async function showMap({ bounds, regionName, query, districtName, complex, kakaoJavaScriptKey }) {
    const key = JSON.stringify([bounds, query, complex?.key, complex?.profile?.coordinates, kakaoJavaScriptKey]);
    if (key === selectionKey) { regionalMap?.invalidateSize({ pan: false }); map?.relayout(); return; }
    selectionKey = key;
    const current = ++version;
    if (!validMapBounds(bounds)) {
      showRegionalMap(null, regionName, complex);
      return;
    }
    if (!kakaoJavaScriptKey || complex?.profile?.coordinates) {
      showRegionalMap(bounds, regionName, complex);
      return;
    }
    try {
      sdk ??= loadKakaoMaps(kakaoJavaScriptKey);
      const maps = await sdk;
      if (current !== version) return;
      const [west, south, east, north] = bounds;
      const center = new maps.LatLng((south + north) / 2, (west + east) / 2);
      raster.hidden = true;
      placeholder.hidden = true;
      canvas.hidden = false;
      if (!map) {
        map = new maps.Map(canvas, { center, level: 7 });
        marker = new maps.Marker();
        map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
      }
      map.relayout();
      marker.setMap(null);
      map.setBounds(new maps.LatLngBounds(new maps.LatLng(south, west), new maps.LatLng(north, east)));
      hint.textContent = complex ? '단지 위치를 확인하고 있습니다.' : '';
      if (!complex) return;
      const position = await findApartment(maps, query, districtName, complex);
      if (current !== version) return;
      if (position) {
        marker.setPosition(position);
        marker.setMap(map);
        map.setLevel(4);
        map.setCenter(position);
        hint.textContent = complex.aptName + ' 위치';
      } else {
        hint.textContent = '단지 위치를 확인하려면 카카오맵에서 열어 보세요.';
      }
    } catch {
      if (current === version) showRegionalMap(bounds, regionName, complex);
    }
  };
}
