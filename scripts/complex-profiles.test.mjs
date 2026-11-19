import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { profileMatcher, normalizeProfiles, validateProfiles } from '../complex-profiles.js';
import { buildComplexCatalog, searchComplexes, validateComplexCatalog } from '../complex-data.js';
import { tradesCsv } from '../market-data.js';

const snapshot = JSON.parse(await readFile(new URL('../data/complex-profiles.json', import.meta.url), 'utf8'));
const profiles = validateProfiles(snapshot).profiles;

test('실제 서울시 자료의 지역과 단지 이름을 대조하고 단계·유사명·건축연도 충돌은 구분한다', () => {
  const match = profileMatcher(profiles);
  const target = match('11410', { aptName: '홍은동벽산', dong: '홍은동' });
  assert.equal(target.name, '홍은벽산'); assert.equal(target.households, 1509);
  assert.equal(target.approvalDate, '1997-09-30');
  assert.equal(match('11380', { aptName: '홍은동벽산', dong: '홍은동' }), null);
  assert.equal(match('11410', { aptName: '홍은동벽산', dong: '홍은동', buildYear: 2015 }), null);
  const first = match('11380', { aptName: '북한산힐스테이트(1차)아파트', dong: '불광동' });
  const third = match('11380', { aptName: '북한산힐스테이트3차', dong: '불광동' });
  assert.notEqual(first.id, third.id);
  assert.equal(match('11380', { aptName: '북한산힐스테이트', dong: '불광동' }), null);
  const duplicate = { ...target, id: 'A99999999' };
  assert.equal(profileMatcher([target, duplicate])('11410', { aptName: '홍은동벽산', dong: '홍은동' }), null);
});

test('최근 거래가 없는 공식 단지도 검색되며 공란과 0인 주차대수는 추정하지 않는다', () => {
  const catalog = buildComplexCatalog(new Map(), new Map(), profiles);
  validateComplexCatalog({ schemaVersion: 1, apartments: catalog }, new Set(profiles.map(row => row.districtCode)));
  const targets = searchComplexes(catalog, { district: '11380', query: '북한산힐스테이트1차', area: 'all' });
  assert.equal(targets.length, 1); assert.equal(targets[0].tradeCount, 0); assert.equal(targets[0].profile.households, 603);
  assert.equal(searchComplexes(catalog, { district: '11380', query: '북한산힐스테이트1차', area: '84' }).length, 0);
  assert.equal(profiles.find(row => row.name === '북한산힐스테이트7차').parkingSpaces, null);
  assert.throws(() => normalizeProfiles({ DATA: [] }, [], snapshot.checkedAt), /전체 목록/);
});

test('서로 다른 구의 거래를 내보낼 때 실제 시군구와 원 단위 가격을 보존한다', () => {
  const rows = ['11380', '11410'].map((districtCode, i) => ({ districtCode, aptName: '검증단지', dong: '검증동', building: '',
    areaM2: 84, floor: 3, dealDate: '2026-11-01', priceWon: 800_000_000 + i * 10_000_000,
    transactionType: '중개거래', checkedAt: '2026-11-19T00:00:00.000Z' }));
  const csv = tradesCsv(rows, row => ({ '11380': '은평구', '11410': '서대문구' })[row.districtCode]);
  assert.match(csv, /은평구/); assert.match(csv, /서대문구/); assert.match(csv, /800000000/); assert.match(csv, /810000000/);
});
