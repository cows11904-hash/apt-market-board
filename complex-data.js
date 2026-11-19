import { AREA_RANGES, isDay } from './market-data.js';
import { richgoComplexUrl } from './richgo-quotes.js';

export function complexKey(code, dong, name) {
  return JSON.stringify([code, dong, name]);
}

export function complexCatalogPath(hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{12}$/.test(hash)) throw new Error('단지 목록 경로가 올바르지 않습니다.');
  return `data/complexes/${hash}.json`;
}

export function buildComplexCatalog(tradesByDistrict, quotesByDistrict) {
  const entries = new Map();
  function entry(code, row) {
    const key = complexKey(code, row.dong, row.aptName);
    if (!entries.has(key)) entries.set(key, {
      key, districtCode: code, aptName: row.aptName, dong: row.dong,
      tradeCount: 0, lastTradeDate: null, aptId: null, areaRanges: [],
    });
    return entries.get(key);
  }
  for (const [code, trades] of tradesByDistrict) {
    for (const row of trades) {
      const apartment = entry(code, row);
      apartment.tradeCount++;
      if (!apartment.lastTradeDate || row.dealDate > apartment.lastTradeDate) apartment.lastTradeDate = row.dealDate;
      apartment.areaRanges.push([row.areaM2, row.areaM2]);
    }
  }
  for (const [code, quotes] of quotesByDistrict) {
    for (const row of quotes) {
      const apartment = entry(code, row);
      apartment.aptId = row.aptId;
      apartment.areaRanges.push([row.areaMinM2, row.areaMaxM2]);
    }
  }
  return [...entries.values()].map(apartment => ({
    ...apartment,
    areaRanges: [...new Map(apartment.areaRanges.map(range => [JSON.stringify(range), range])).values()]
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  })).sort((a, b) => a.aptName.localeCompare(b.aptName, 'ko') || a.districtCode.localeCompare(b.districtCode) || a.dong.localeCompare(b.dong, 'ko'));
}

export function validateComplexCatalog(data, regionCodes) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.apartments)) throw new Error('단지 목록 형식이 올바르지 않습니다.');
  const seen = new Set();
  for (const row of data.apartments) {
    if (!row || !regionCodes.has(row.districtCode) || typeof row.aptName !== 'string' || !row.aptName.trim()
        || typeof row.dong !== 'string' || row.key !== complexKey(row.districtCode, row.dong, row.aptName)
        || seen.has(row.key) || !Number.isSafeInteger(row.tradeCount) || row.tradeCount < 0
        || (row.lastTradeDate !== null && !isDay(row.lastTradeDate))
        || (row.tradeCount > 0 && row.lastTradeDate === null)
        || !Array.isArray(row.areaRanges) || !row.areaRanges.length
        || row.areaRanges.some(range => !Array.isArray(range) || range.length !== 2
          || !range.every(value => Number.isFinite(value) && value > 0) || range[0] > range[1])) {
      throw new Error('단지 이름, 지역 또는 면적을 확인해야 합니다.');
    }
    if (row.aptId !== null) richgoComplexUrl(row.aptId);
    seen.add(row.key);
  }
  return data.apartments;
}

const searchKey = value => value.normalize('NFKC').replace(/[\s()·._-]/g, '').toLocaleLowerCase('ko');

export function searchComplexes(apartments, { district = '', query = '', area = 'all' }, districtNames = new Map()) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(searchKey);
  const [min, max] = AREA_RANGES[area] ?? [0, Infinity];
  return apartments.filter(apartment => {
    const neighborhood = apartment.dong.replace(/[동읍면]$/, '');
    const shortName = apartment.aptName.startsWith(apartment.dong)
      ? neighborhood + apartment.aptName.slice(apartment.dong.length) : apartment.aptName;
    const names = [apartment.aptName, shortName, apartment.dong + apartment.aptName, neighborhood + apartment.aptName,
      (districtNames.get(apartment.districtCode) ?? '') + apartment.aptName].map(searchKey);
    return (!district || apartment.districtCode === district)
      && apartment.areaRanges.some(([low, high]) => low <= max && high >= min)
      && terms.every(term => names.some(name => name.includes(term)));
  });
}
