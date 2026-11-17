export function kakaoMapLink(query) {
  return 'https://map.kakao.com/link/search/' + encodeURIComponent(query);
}

export function validMapBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return false;
  const [west, south, east, north] = bounds;
  return west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north;
}

function openStreetMapUrl(bounds) {
  const url = new URL('https://www.openstreetmap.org/export/embed.html');
  url.searchParams.set('bbox', bounds.join(','));
  url.searchParams.set('layer', 'mapnik');
  return url.href;
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

export function createQuoteMap({ frame, canvas, placeholder, hint, credit }) {
  let sdk;
  let map;
  let marker;
  let selectionKey;
  let version = 0;

  function showRegionalMap(bounds, regionName, apartment) {
    canvas.hidden = true;
    frame.hidden = !bounds;
    placeholder.hidden = Boolean(bounds);
    credit.hidden = !bounds;
    if (bounds) {
      const url = openStreetMapUrl(bounds);
      if (frame.getAttribute('src') !== url) frame.src = url;
      frame.title = regionName + ' OpenStreetMap 지도';
    } else {
      placeholder.textContent = '이 지역의 지도 범위를 준비하고 있습니다.';
    }
    hint.textContent = apartment ? '지도는 지역 범위를 표시합니다. 단지 위치는 카카오맵에서 확인하세요.' : '';
  }

  return async function showMap({ bounds, regionName, query, districtName, complex, kakaoJavaScriptKey }) {
    const key = JSON.stringify([bounds, query, kakaoJavaScriptKey]);
    if (key === selectionKey) return;
    selectionKey = key;
    const current = ++version;
    if (!validMapBounds(bounds)) {
      showRegionalMap(null, regionName, complex);
      return;
    }
    if (!kakaoJavaScriptKey) {
      showRegionalMap(bounds, regionName, complex);
      return;
    }
    try {
      sdk ??= loadKakaoMaps(kakaoJavaScriptKey);
      const maps = await sdk;
      if (current !== version) return;
      const [west, south, east, north] = bounds;
      const center = new maps.LatLng((south + north) / 2, (west + east) / 2);
      frame.hidden = true;
      placeholder.hidden = true;
      credit.hidden = true;
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
