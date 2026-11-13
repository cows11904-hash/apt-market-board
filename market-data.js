export const MOLIT_SOURCE = '국토교통부 아파트 매매 실거래가 상세 자료';
export const MOLIT_SOURCE_URL = 'https://www.data.go.kr/data/15126468/openapi.do';
export const MOLIT_RECORDS_URL = 'https://rt.molit.go.kr/pt/xls/xls.do';
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const TRADE_TYPES = ['중개거래', '직거래', '구분 미확인'];

const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const timeFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
});
const areaRanges = { '59': [57, 61], '74': [72, 76], '84': [80, 85] };
const snapshotRevision = /^\d{8}T\d{9}Z$/;
const monthKey = /^\d{4}(0[1-9]|1[0-2])$/;
const districtKey = /^\d{5}$/;
const dayKey = /^\d{4}-\d{2}-\d{2}$/;
const numberFormat = new Intl.NumberFormat('ko-KR');

export function seoulDay(value = new Date()) {
  return dayFormat.format(new Date(value));
}

export function seoulDateTime(value) {
  return `${timeFormat.format(new Date(value))} KST`;
}

export function isDay(value) {
  if (typeof value !== 'string' || !dayKey.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

export function isInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString() === value;
}

export function moneyWon(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '—';
  const eok = Math.floor(value / 100_000_000);
  const man = Math.floor((value % 100_000_000) / 10_000);
  const won = value % 10_000;
  const parts = [];
  if (eok) parts.push(`${numberFormat.format(eok)}억`);
  if (man) parts.push(`${numberFormat.format(man)}만`);
  if (won) parts.push(numberFormat.format(won));
  return `${parts.join(' ') || '0'} 원`;
}

export function parsePriceLimit(value) {
  if (!value) return null;
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return NaN;
  const won = Math.round(Number(value) * 100_000_000);
  return Number.isSafeInteger(won) && won > 0 ? won : NaN;
}

export function middlePrice(records, key) {
  if (!records.length) return null;
  const prices = records.map(row => row[key]).sort((a, b) => a - b);
  const i = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[i] : prices[i - 1] + (prices[i] - prices[i - 1]) / 2;
}

function searchKey(value) {
  return value.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase('ko');
}

function matchesApartment(row, query) {
  const name = searchKey(row.aptName);
  if (name.includes(query)) return true;

  // Support names commonly written without the legal neighborhood's 동/읍/면 suffix.
  const neighborhood = searchKey(row.dong ?? '');
  if (!/[동읍면]$/.test(neighborhood) || neighborhood.length < 2 || !name.startsWith(neighborhood)) return false;
  const shortened = neighborhood.slice(0, -1);
  return query.startsWith(shortened) && `${shortened}${name.slice(neighborhood.length)}`.startsWith(query);
}

export function filterRecords(records, filters) {
  const [min, max] = areaRanges[filters.area] ?? [0, Infinity];
  const query = searchKey(filters.search);
  return records.filter(row => row.areaM2 >= min && row.areaM2 <= max
    && (!query || matchesApartment(row, query))
    && (!filters.maxWon || (row.priceWon ?? row.askWon) <= filters.maxWon)
    && (!filters.month || row.dealDate?.startsWith(filters.month))
    && (!filters.kind || row.transactionType === filters.kind));
}

export function districtDataPath(manifest, code) {
  if (!snapshotRevision.test(manifest.revision) || !districtKey.test(code)) throw new Error('자료 경로가 올바르지 않습니다.');
  return `data/trades/${manifest.revision}/${code}.json`;
}

export function validateRegions(regions) {
  if (!Array.isArray(regions) || !regions.length) throw new Error('시·도 목록이 비어 있습니다.');
  const cityCodes = new Set();
  const districtCodes = new Set();
  for (const city of regions) {
    if (!/^\d{2}$/.test(city.code) || !city.name || cityCodes.has(city.code)
      || !Array.isArray(city.districts) || !city.districts.length) throw new Error('시·도 설정이 올바르지 않습니다.');
    cityCodes.add(city.code);
    for (const district of city.districts) {
      if (!districtKey.test(district.code) || !district.code.startsWith(city.code) || !district.name
        || districtCodes.has(district.code)) throw new Error('시·군·구 설정이 올바르지 않습니다.');
      districtCodes.add(district.code);
    }
  }
  return regions.flatMap(city => city.districts);
}

export function validateManifest(data) {
  if (!data || data.schemaVersion !== 1 || !['awaiting_key', 'ok', 'failed'].includes(data.state)
    || data.source !== MOLIT_SOURCE || data.sourceUrl !== MOLIT_SOURCE_URL
    || !Array.isArray(data.months) || !data.districts || Array.isArray(data.districts)
    || (data.lastAttemptAt !== null && !isInstant(data.lastAttemptAt))) {
    throw new Error('실거래 자료 목록 형식이 올바르지 않습니다.');
  }
  const entries = Object.entries(data.districts);
  if (data.updatedAt === null && data.revision === null && !data.months.length && !entries.length
    && ((data.state === 'awaiting_key' && data.lastAttemptAt === null) || (data.state === 'failed' && isInstant(data.lastAttemptAt)))) return data;
  if (!isInstant(data.updatedAt) || !snapshotRevision.test(data.revision) || !entries.length || !data.months.length
    || data.state === 'awaiting_key' || !data.months.every(month => monthKey.test(month))
    || data.months.some((month, index) => index > 0 && month <= data.months[index - 1])
    || !isInstant(data.lastAttemptAt) || data.lastAttemptAt < data.updatedAt) {
    throw new Error('실거래 자료의 수집 범위가 올바르지 않습니다.');
  }
  for (const [code, summary] of entries) {
    if (!districtKey.test(code) || !Number.isSafeInteger(summary?.count) || summary.count < 0) throw new Error('지역별 건수가 올바르지 않습니다.');
    let records = 0;
    for (const month of data.months) {
      const counts = summary.months?.[month];
      if (!counts || !['raw', 'included', 'canceled', 'nonSale'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
        || counts.raw !== counts.included + counts.canceled + counts.nonSale) throw new Error('월별 수집 건수가 일치하지 않습니다.');
      records += counts.included;
    }
    if (records !== summary.count) throw new Error('지역 합계와 월별 합계가 일치하지 않습니다.');
  }
  return data;
}

export function validateDistrict(data, manifest, code) {
  const expected = manifest.districts[code];
  if (!expected || data?.districtCode !== code || data.revision !== manifest.revision
    || !Array.isArray(data.transactions) || data.transactions.length !== expected.count) {
    throw new Error('지역 거래 자료의 버전 또는 건수가 일치하지 않습니다.');
  }
  const monthly = {};
  let previousDate = '9999-12-31';
  for (const row of data.transactions) {
    if (!row || typeof row.aptName !== 'string' || !row.aptName.trim() || typeof row.dong !== 'string'
      || typeof row.building !== 'string' || !Number.isFinite(row.areaM2) || row.areaM2 <= 0 || (row.floor !== null && !Number.isSafeInteger(row.floor))
      || !Number.isSafeInteger(row.priceWon) || row.priceWon <= 0 || row.priceWon % 10_000 !== 0
      || !isDay(row.dealDate) || row.dealDate > previousDate || !TRADE_TYPES.includes(row.transactionType)
      || !isInstant(row.checkedAt) || row.checkedAt > manifest.updatedAt) throw new Error('가격 또는 확인일이 올바르지 않습니다.');
    previousDate = row.dealDate;
    const month = row.dealDate.slice(0, 7).replace('-', '');
    if (!expected.months[month]) throw new Error('조회 범위 밖 거래가 있습니다.');
    monthly[month] = (monthly[month] ?? 0) + 1;
  }
  if (manifest.months.some(month => (monthly[month] ?? 0) !== expected.months[month].included)) throw new Error('월별 거래 건수가 일치하지 않습니다.');
  return data.transactions;
}

function isPublicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateListings(data) {
  if (!Array.isArray(data?.providers) || !Array.isArray(data?.listings)) throw new Error('호가 자료 형식이 올바르지 않습니다.');
  const providers = new Map();
  const listingIds = new Set();
  for (const provider of data.providers) {
    if (typeof provider?.id !== 'string' || !provider.id.trim() || typeof provider.name !== 'string' || !provider.name.trim()
      || provider.publicRedistributionAllowed !== true || !isDay(provider.approvedOn)
      || !isDay(provider.validThrough) || provider.validThrough < provider.approvedOn || providers.has(provider.id)) {
      throw new Error('공개 게시가 승인된 호가 제공처가 필요합니다.');
    }
    providers.set(provider.id, provider);
  }
  return data.listings.map(row => {
    const provider = providers.get(row?.providerId);
    const id = JSON.stringify([row?.providerId, row?.listingId]);
    if (!provider || typeof row.listingId !== 'string' || !row.listingId.trim() || listingIds.has(id)
      || !districtKey.test(row.districtCode) || typeof row.aptName !== 'string' || !row.aptName.trim()
      || !Number.isFinite(row.areaM2) || row.areaM2 <= 0 || !Number.isSafeInteger(row.askWon) || row.askWon <= 0
      || !isPublicUrl(row.sourceUrl) || !isInstant(row.verifiedAt) || !isInstant(row.expiresAt)
      || row.expiresAt <= row.verifiedAt || !['active', 'withdrawn'].includes(row.status)) {
      throw new Error('호가의 매물 식별자, 출처, 확인일 또는 유효 기간을 검토해야 합니다.');
    }
    listingIds.add(id);
    return { ...row, source: provider.name, approvedOn: provider.approvedOn, validThrough: provider.validThrough };
  });
}

export function activeListings(rows, code, now = new Date()) {
  const today = seoulDay(now);
  const currentTime = now.toISOString();
  return rows.filter(row => row.districtCode === code && row.status === 'active'
    && row.verifiedAt <= currentTime && currentTime < row.expiresAt
    && row.approvedOn <= seoulDay(row.verifiedAt) && today <= row.validThrough)
    .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
}

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = typeof value === 'string' && /^\s*[=+@\-\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function tradesCsv(rows, districtName) {
  const table = [['시군구', '아파트', '법정동', '아파트동', '전용면적(㎡)', '층', '계약일', '가격(원)', '거래 유형', '출처', '출처 URL', '확인 시각(KST)']];
  for (const row of rows) {
    table.push([districtName, row.aptName, row.dong, row.building, row.areaM2, row.floor, row.dealDate, row.priceWon,
      row.transactionType, MOLIT_SOURCE, MOLIT_SOURCE_URL, seoulDateTime(row.checkedAt)]);
  }
  return '\uFEFF' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
