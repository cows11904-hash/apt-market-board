import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activeListings, filterRecords, middlePrice, moneyWon, parsePriceLimit, seoulDay, tradesCsv, validateListings, validateRegions } from '../market-data.js';

const common = { aptName: '가상 단지', dealDate: '2026-01-09', priceWon: 1_000_010_000, transactionType: '직거래',
  dong: '검증동', building: '', floor: 3, checkedAt: '2026-01-12T15:00:00.000Z' };
const provider = { id: 'example', name: '검증 제공처', publicRedistributionAllowed: true, approvedOn: '2026-01-01', validThrough: '2026-01-31' };
const listing = { providerId: 'example', listingId: 'fixture-id', districtCode: '11110', aptName: '가상 단지', areaM2: 84.25,
  askWon: 1_100_000_000, sourceUrl: 'https://example.org/listings/fixture-id', verifiedAt: '2026-01-12T15:00:00.000Z',
  expiresAt: '2026-01-14T00:00:00.000Z', status: 'active' };

test('서울 25개 코드를 제공하고 다른 시·도 항목을 확장할 수 있다', async () => {
  const regions = JSON.parse(await readFile(new URL('../data/regions.json', import.meta.url), 'utf8'));
  assert.equal(regions.find(region => region.code === '11').districts.length, 25);
  const districts = validateRegions(regions);
  assert.equal(new Set(districts.map(x => x.code)).size, districts.length);
  if (!regions.some(region => region.code === '28')) {
    assert.equal(validateRegions([...regions, { code: '28', name: '인천광역시', districts: [{ code: '28110', name: '중구' }] }]).length, districts.length + 1);
  }
});

test('전용면적, 단지명 공백, 상한, 계약월과 직거래를 함께 필터링한다', () => {
  const fitting = { ...common, areaM2: 84.25 };
  const rows = [fitting, fitting, { ...common, areaM2: 59 }, { ...common, areaM2: 76 }, { ...common, areaM2: 102 },
    { ...fitting, priceWon: 1_100_000_000 }, { ...fitting, dealDate: '2026-02-01' }, { ...fitting, transactionType: '중개거래' }];
  const filtered = filterRecords(rows, { area: '84', search: '가상단지', maxWon: parsePriceLimit('10.0001'), month: '2026-01', kind: '직거래' });
  assert.deepEqual(filtered, [fitting, fitting]);
  assert.ok(Number.isNaN(parsePriceLimit('-1')));
  assert.equal(middlePrice([fitting, { ...fitting, priceWon: 1_000_000_000 }], 'priceWon'), 1_000_005_000);
  assert.equal(moneyWon(1_000_005_000), '10억 5,000 원');
});

test('조회 CSV는 동일 계약을 보존하고 가격 원 단위와 출처, 한국 확인일을 포함한다', () => {
  const row = { ...common, aptName: '=fixture,"단지"', areaM2: 84.25 };
  const lines = tradesCsv([row, row], '종로구').trimEnd().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], lines[2]);
  assert.match(lines[1], /'=fixture,""단지""/);
  assert.match(lines[1], /1000010000/);
  assert.match(lines[1], /data\.go\.kr/);
  assert.match(lines[1], /2026-01-13 00:00 KST/);
  assert.equal(seoulDay(row.checkedAt), '2026-01-13');
});

test('법정동 접미사를 생략해도 같은 단지가 검색된다', () => {
  const target = { ...common, aptName: '가상동아파트', dong: '가상동', areaM2: 84.25 };
  const differentNeighborhood = { ...target, dong: '검증동' };
  const records = [target, differentNeighborhood];
  const filters = { area: 'all', search: '가상 아파트' };
  assert.deepEqual(filterRecords(records, filters), [target]);
  assert.deepEqual(filterRecords(records, { ...filters, search: '가상동아파트' }), records);
});

test('게시 승인·매물 ID·원본·확인일을 요구하고 유효 기간 밖 호가를 숨긴다', () => {
  const data = { providers: [provider], listings: [listing] };
  assert.equal(activeListings(validateListings(data), '11110', new Date('2026-01-13T00:00:00Z')).length, 1);
  assert.equal(activeListings(validateListings(data), '11110', new Date('2026-01-14T00:00:00Z')).length, 0);
  assert.throws(() => validateListings({ ...data, providers: [{ ...provider, publicRedistributionAllowed: 'false' }] }), /승인/);
  for (const row of [{ ...listing, listingId: '' }, { ...listing, sourceUrl: 'javascript:alert(1)' }, { ...listing, verifiedAt: '' }]) {
    assert.throws(() => validateListings({ ...data, listings: [row] }), /유효 기간/);
  }
  assert.equal(activeListings(validateListings({ ...data, listings: [{ ...listing, status: 'withdrawn' }] }), '11110', new Date('2026-01-13T00:00:00Z')).length, 0);
});
