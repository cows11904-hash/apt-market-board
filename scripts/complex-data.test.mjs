import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplexCatalog, complexCatalogPath, searchComplexes, validateComplexCatalog } from '../complex-data.js';

const trade = { aptName: '홍은동벽산', dong: '홍은동', areaM2: 84.9, dealDate: '2026-11-01' };
const catalogue = () => buildComplexCatalog(new Map([
  ['11410', [trade, { ...trade, areaM2: 59.9, dealDate: '2026-11-02' }]],
  ['11110', [{ ...trade, dong: '가상동' }]],
]), new Map());

test('전체 지역 단지 목록은 동명이의 단지를 구분하고 중복 면적과 신고 건수를 집계한다', () => {
  const apartments = catalogue();
  const rows = validateComplexCatalog({ schemaVersion: 1, apartments }, new Set(['11410', '11110']));
  assert.equal(rows.length, 2);
  const target = rows.find(row => row.districtCode === '11410');
  assert.equal(target.tradeCount, 2);
  assert.equal(target.lastTradeDate, '2026-11-02');
  assert.deepEqual(target.areaRanges, [[59.9, 59.9], [84.9, 84.9]]);
  assert.throws(() => complexCatalogPath('../private'), /경로/);
});

test('동 이름을 줄여 쓴 검색어와 공백 검색이 지역·면적 조건과 함께 동작한다', () => {
  const rows = catalogue();
  const names = new Map([['11410', '서대문구'], ['11110', '종로구']]);
  for (const query of ['홍은벽산', '홍은 벽산', '홍은동 벽산', '서대문구 벽산']) {
    assert.equal(searchComplexes(rows, { district: '11410', query, area: '84' }, names)[0].districtCode, '11410');
    assert.equal(searchComplexes(rows, { district: '11410', query, area: '84' }, names).length, 1);
  }
  assert.equal(searchComplexes(rows, { query: '홍은벽산' }, names).length, 1);
  assert.equal(searchComplexes(rows, { district: '11110', query: '벽산', area: '59' }, names).length, 0);
  assert.equal(searchComplexes(rows, { query: '<img onerror=alert(1)>' }, names).length, 0);
});
