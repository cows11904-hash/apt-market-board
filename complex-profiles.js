import { isDay, isInstant, seoulDay } from './market-data.js';

export const PROFILE_SOURCE = '서울특별시 공동주택 아파트 정보';
export const PROFILE_SOURCE_URL = 'https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do';
export const PROFILE_DOWNLOAD_URL = 'https://datafile.seoul.go.kr/bigfile/iot/sheet/json/download.do';

const text = value => typeof value === 'string' ? value.trim().slice(0, 240) : '';
const positive = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function sourceDay(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) return seoulDay(value);
  const day = String(value ?? '').slice(0, 10);
  return isDay(day) ? day : null;
}

export function normalizeProfiles(raw, regions, checkedAt) {
  if (!Array.isArray(raw?.DATA) || raw.DATA.length < 100 || !isInstant(checkedAt)) throw new Error('서울시 단지 정보의 전체 목록을 확인해야 합니다.');
  const districtCodes = new Map(regions.flatMap(city => city.districts).map(district => [district.name, district.code]));
  const profiles = [];
  const ids = new Set();
  for (const original of raw.DATA) {
    const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [key.toLowerCase(), value]));
    const districtCode = districtCodes.get(text(row.sgg_addr));
    const id = text(row.apt_cd);
    const name = text(row.apt_nm);
    const dong = text(row.emd_addr);
    if (!districtCode || !/^[A-Za-z0-9]{5,24}$/.test(id) || !name || !dong || ids.has(id)) continue;
    const longitude = Number(row.xcrd);
    const latitude = Number(row.ycrd);
    const coordinates = longitude > 126 && longitude < 128 && latitude > 37 && latitude < 38 ? [longitude, latitude] : null;
    const areaRanges = [];
    for (const [field, range] of [['xuar_hh_stts60', [0.01, 60]], ['xuar_hh_stts85', [60.01, 85]],
      ['xuar_hh_stts135', [85.01, 135]], ['xuar_hh_stts136', [135.01, 1000]]]) {
      if (Number(row[field]) > 0) areaRanges.push(range);
    }
    profiles.push({
      id, districtCode, name, dong,
      roadAddress: text(row.apt_rdn_addr), households: positive(row.tnohsh), buildings: positive(row.whol_dong_cnt),
      approvalDate: sourceDay(row.use_aprv_ymd), parkingSpaces: positive(row.prk_cntom),
      heating: text(row.mn_mthd), corridor: text(row.road_type), management: text(row.mng_mthd),
      supplyType: text(row.hh_type), constructor: text(row.bldr),
      coordinates, areaRanges, sourceUpdatedOn: sourceDay(row.mdfcn_ymd),
    });
    ids.add(id);
  }
  if (profiles.length < 100 || new Set(profiles.map(row => row.districtCode)).size < 20) throw new Error('서울시 단지 정보의 지역별 수집 범위가 부족합니다.');
  const snapshot = { schemaVersion: 1, source: PROFILE_SOURCE, sourceUrl: PROFILE_SOURCE_URL, checkedAt,
    profiles: profiles.sort((a, b) => a.id.localeCompare(b.id)) };
  validateProfiles(snapshot);
  return snapshot;
}

export function validateProfiles(snapshot) {
  if (snapshot?.schemaVersion !== 1 || snapshot.source !== PROFILE_SOURCE || snapshot.sourceUrl !== PROFILE_SOURCE_URL
      || !isInstant(snapshot.checkedAt) || !Array.isArray(snapshot.profiles)) throw new Error('단지 기본 정보의 출처 또는 확인일이 올바르지 않습니다.');
  const ids = new Set();
  for (const row of snapshot.profiles) {
    if (!row || !/^[A-Za-z0-9]{5,24}$/.test(row.id) || ids.has(row.id) || !/^11\d{3}$/.test(row.districtCode)
        || typeof row.name !== 'string' || !row.name.trim() || typeof row.dong !== 'string' || !row.dong.trim()
        || ['households', 'buildings', 'parkingSpaces'].some(key => row[key] !== null && (!Number.isSafeInteger(row[key]) || row[key] <= 0))
        || (row.approvalDate !== null && !isDay(row.approvalDate))
        || (row.sourceUpdatedOn !== null && !isDay(row.sourceUpdatedOn))
        || !Array.isArray(row.areaRanges) || row.areaRanges.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] <= 0 || range[0] > range[1])
        || (row.coordinates !== null && (!Array.isArray(row.coordinates) || row.coordinates.length !== 2
          || !row.coordinates.every(Number.isFinite) || row.coordinates[0] <= 126 || row.coordinates[0] >= 128 || row.coordinates[1] <= 37 || row.coordinates[1] >= 38))) {
      throw new Error('단지 기본 정보의 항목을 확인해야 합니다.');
    }
    ids.add(row.id);
  }
  return snapshot;
}

export function apartmentNames(name, dong) {
  const compact = value => value.normalize('NFKC').replace(/[\s()·._-]/g, '').replace(/아파트/g, '').toLocaleLowerCase('ko');
  const full = compact(name);
  const neighborhood = compact(dong);
  const shortDong = neighborhood.replace(/[동읍면]$/, '');
  const variants = new Set([full]);
  for (const prefix of [neighborhood, shortDong]) if (prefix && full.startsWith(prefix) && full.length > prefix.length) variants.add(full.slice(prefix.length));
  return [...variants];
}

export function profileMatcher(profiles) {
  const index = new Map();
  for (const profile of profiles) for (const name of apartmentNames(profile.name, profile.dong)) {
    const key = JSON.stringify([profile.districtCode, profile.dong, name]);
    if (!index.has(key)) index.set(key, new Map());
    index.get(key).set(profile.id, profile);
  }
  return (districtCode, apartment) => {
    const candidates = new Map();
    for (const name of apartmentNames(apartment.aptName, apartment.dong)) {
      for (const [id, profile] of index.get(JSON.stringify([districtCode, apartment.dong, name])) ?? []) candidates.set(id, profile);
    }
    if (candidates.size !== 1) return null;
    const [profile] = candidates.values();
    if (apartment.buildYear && profile.approvalDate && Number(profile.approvalDate.slice(0, 4)) !== apartment.buildYear) return null;
    return profile;
  };
}
