import { AREA_RANGES, isDay, isInstant, seoulDay } from './market-data.js';

export const RICHGO_SOURCE = '리치고';
const districtCode = /^\d{5}$/;
const richgoId = /^[a-zA-Z0-9]{7}$/;
const hashKey = /^[a-f0-9]{12}$/;
const isArea = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isPrice = value => Number.isSafeInteger(value) && value > 0 && value % 10_000 === 0;

export function richgoComplexUrl(id) {
  if (typeof id !== 'string' || !richgoId.test(id)) throw new Error('리치고 단지 식별자가 올바르지 않습니다.');
  return 'https://m.richgo.ai/realty/danji/' + id;
}

export function richgoDistrictUrl(cityCode, districtName) {
  if (cityCode !== '11') return 'https://m.richgo.ai/';
  return 'https://m.richgo.ai/realty/apt-hub/' + ['서울', districtName].filter(Boolean)
    .map(encodeURIComponent).join('/');
}

export function quoteDistrictPath(code, hash) {
  if (typeof code !== 'string' || !districtCode.test(code) || typeof hash !== 'string' || !hashKey.test(hash)) {
    throw new Error('호가 자료 경로가 올바르지 않습니다.');
  }
  return 'data/richgo-quotes/' + code + '.' + hash + '.json';
}

export function validateQuoteManifest(data) {
  if (data?.schemaVersion !== 1 || !['awaiting_feed', 'ok', 'failed'].includes(data.state)
      || typeof data.kakaoJavaScriptKey !== 'string' || !data.districts || Array.isArray(data.districts)
      || typeof data.districts !== 'object') throw new Error('호가 설정이 올바르지 않습니다.');
  const entries = Object.entries(data.districts);
  if (data.state === 'ok') {
    if (!isInstant(data.checkedAt) || !isDay(data.publicThrough)
        || data.publicThrough < seoulDay(data.checkedAt)) throw new Error('호가 공개 기간이 올바르지 않습니다.');
    for (const [code, hash] of entries) quoteDistrictPath(code, hash);
  } else if (entries.length || data.checkedAt !== null || data.publicThrough !== null) {
    throw new Error('호가 자료 상태가 올바르지 않습니다.');
  }
  return data;
}

export function canDisplayQuotes(manifest, now = new Date()) {
  return manifest.state === 'ok' && seoulDay(now) <= manifest.publicThrough;
}

export function validateQuoteDistrict(snapshot, code, checkedAt) {
  if (snapshot?.districtCode !== code || !Array.isArray(snapshot?.rows) || !isInstant(checkedAt)) {
    throw new Error('지역 호가 자료가 올바르지 않습니다.');
  }
  const latestDay = seoulDay(checkedAt);
  const ids = new Set();
  for (const row of snapshot.rows) {
    if (!row || typeof row.aptName !== 'string' || !row.aptName.trim() || row.aptName.length > 160
        || typeof row.dong !== 'string' || row.dong.length > 50 || !isArea(row.areaMinM2) || !isArea(row.areaMaxM2)
        || row.areaMinM2 > row.areaMaxM2 || !Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error('단지, 면적 또는 매물 건수가 올바르지 않습니다.');
    }
    richgoComplexUrl(row.aptId);
    const id = JSON.stringify([row.aptId, row.areaMinM2, row.areaMaxM2]);
    if (ids.has(id)) throw new Error('같은 단지와 면적의 집계가 중복되었습니다.');
    ids.add(id);
    const noPrice = row.lowestWon === null && row.highestWon === null;
    if ((!noPrice && (!isPrice(row.lowestWon) || !isPrice(row.highestWon) || row.lowestWon > row.highestWon || row.count < 1))
        || (row.asOf !== null && (!isDay(row.asOf) || row.asOf > latestDay)) || (!noPrice && row.asOf === null)) {
      throw new Error('호가 또는 데이터 기준일이 올바르지 않습니다.');
    }
  }
  return snapshot.rows;
}

export function matchesQuoteArea(row, area) {
  const [min, max] = AREA_RANGES[area] ?? [0, Infinity];
  return row.areaMinM2 <= max && row.areaMaxM2 >= min;
}
