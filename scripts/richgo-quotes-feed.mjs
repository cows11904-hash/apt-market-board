import { isDay, seoulDay } from '../market-data.js';
import { validateQuoteDistrict } from '../richgo-quotes.js';

const noQuotes = state => ({ state, checkedAt: null, publicThrough: null, districts: new Map() });
function amountWon(amount) {
  if (amount === null) return null;
  return Number.isSafeInteger(amount) ? amount * 10_000 : NaN;
}

function normalizeComplexes(complexes, regionCodes, checkedAt) {
  const districts = new Map();
  const complexIds = new Set();
  for (const complex of complexes) {
    const { districtCode, dong = '', snapshot } = complex ?? {};
    if (typeof districtCode !== 'string' || !/^\d{5}$/.test(districtCode)) throw new Error('시·군·구 코드가 올바르지 않습니다.');
    if (!regionCodes.has(districtCode)) continue;
    if (!Array.isArray(snapshot?.pyeongs) || complexIds.has(snapshot.danji_id)) throw new Error('단지별 호가 자료가 올바르지 않습니다.');
    complexIds.add(snapshot.danji_id);
    const rows = districts.get(districtCode) ?? [];
    for (const area of snapshot.pyeongs) {
      if (!area?.sale_listings) continue;
      const parts = String(area.private_area_m2).trim().split(/\s*~\s*/);
      if (parts.length > 2 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) {
        throw new Error('전용면적을 확인해야 합니다.');
      }
      const { count, asking_min_manwon, asking_max_manwon, as_of } = area.sale_listings;
      rows.push({
        aptId: snapshot.danji_id, aptName: snapshot.name, dong,
        areaMinM2: Number(parts[0]), areaMaxM2: Number(parts.at(-1)), count,
        lowestWon: amountWon(asking_min_manwon), highestWon: amountWon(asking_max_manwon), asOf: as_of,
      });
    }
    if (rows.length) districts.set(districtCode, rows);
  }
  for (const [districtCode, rows] of districts) validateQuoteDistrict({ districtCode, rows }, districtCode, checkedAt);
  return districts;
}

export async function prepareRichgoQuotes({ url, token, publicThrough, regionCodes, fetcher = fetch, clock = () => new Date() }) {
  if (!url || !isDay(publicThrough) || seoulDay(clock()) > publicThrough) return noQuotes('awaiting_feed');
  try {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) return noQuotes('failed');
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetcher(endpoint, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return noQuotes('failed');
    }
    const payload = await response.json();
    const checkedAt = clock().toISOString();
    if (!Array.isArray(payload?.complexes) || seoulDay(checkedAt) > publicThrough) return noQuotes('failed');
    const districts = normalizeComplexes(payload.complexes, regionCodes, checkedAt);
    return { state: 'ok', checkedAt, publicThrough, districts };
  } catch {
    // 오류 응답과 피드 주소에는 인증 정보가 포함될 수 있습니다.
    return noQuotes('failed');
  }
}
