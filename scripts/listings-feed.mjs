import { activeListings, seoulDay, validateListings } from '../market-data.js';

async function downloadListings(url, token, fetcher) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('호가 피드에는 HTTPS 주소가 필요합니다.');
  }

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetcher(endpoint, {
    headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('호가 피드에서 JSON을 가져오지 못했습니다.');
  }
  const snapshot = await response.json();
  if (!Array.isArray(snapshot?.listings)
    || snapshot.listings.some(row => row?.transactionType !== 'sale' || row.propertyType !== 'apartment')) {
    throw new Error('아파트 매매 매물 전체를 담은 응답이 필요합니다.');
  }
  return snapshot.listings;
}

function publicRow(row) {
  const { providerId, listingId, districtCode, aptName, areaM2, askWon, sourceUrl, verifiedAt, expiresAt, status } = row;
  const result = { providerId, listingId, districtCode, aptName, areaM2, askWon, sourceUrl, verifiedAt, expiresAt, status };
  for (const field of ['dong', 'building']) {
    if (typeof row[field] === 'string') result[field] = row[field];
  }
  if (Number.isSafeInteger(row.floor) || typeof row.floor === 'string') result.floor = row.floor;
  return result;
}

function publishableDistricts(rows, providers, regionCodes, now) {
  const districts = new Map();
  for (const [code, districtRows] of Map.groupBy(rows, row => row.districtCode)) {
    if (!regionCodes.has(code)) continue;
    const listings = activeListings(districtRows, code, now).map(publicRow);
    if (!listings.length) continue;
    const ids = new Set(listings.map(row => row.providerId));
    districts.set(code, { providers: providers.filter(provider => ids.has(provider.id)), listings });
  }
  return districts;
}

export async function prepareListings({ local, regionCodes, url, token, fetcher = fetch, now = new Date() }) {
  const localRows = validateListings(local);
  if (localRows.some(row => !regionCodes.has(row.districtCode))) {
    throw new Error('공개 지역 목록에 없는 매물 호가가 있습니다.');
  }
  const providers = local.providers.map(({ id, name, publicRedistributionAllowed, approvedOn, validThrough }) => (
    { id, name, publicRedistributionAllowed, approvedOn, validThrough }
  ));
  if (url) {
    try {
      const today = seoulDay(now);
      const approved = providers.filter(provider => provider.approvedOn <= today && today <= provider.validThrough);
      if (!approved.length) throw new Error('유효한 공개 승인 정보가 없습니다.');
      const listings = await downloadListings(url, token, fetcher);
      const rows = validateListings({ providers: approved, listings });
      return { feedState: 'ok', districts: publishableDistricts(rows, approved, regionCodes, now) };
    } catch {
      // The feed can contain credentials in its URL or error response.
      return { feedState: 'failed', districts: new Map() };
    }
  }
  return { feedState: 'unconfigured', districts: publishableDistricts(localRows, providers, regionCodes, now) };
}
