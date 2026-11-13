import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectMonth, makePageFetcher, normalizeKey, recentMonths, refreshTrades } from './fetch-transactions.mjs';
import { districtDataPath } from '../market-data.js';

const region = { code: '11110', name: '종로구' };
const row = {
  sggCd: '11110', aptNm: '검증단지', dealAmount: '100,001', dealYear: '2026', dealMonth: '1', dealDay: '7',
  excluUseAr: '84.8', floor: '5', dealingGbn: '중개거래', cdealType: '',
};
const instant = value => () => new Date(value);
const january = instant('2026-01-13T05:00:00.000Z');
const quiet = () => {};
const batch = (items, page = 1, pageSize = 1000, total = items.length) => ({ items, page, pageSize, total });

async function workspace(testContext) {
  const project = await mkdtemp(join(tmpdir(), 'sisena-'));
  testContext.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, 'data'));
  await cp(new URL('../data/transactions.json', import.meta.url), join(project, 'data/transactions.json'));
  const data = JSON.parse(await readFile(join(project, 'data/transactions.json'), 'utf8'));
  Object.assign(data, { state: 'awaiting_key', lastAttemptAt: null, updatedAt: null, revision: null, months: [], districts: {} });
  await writeFile(join(project, 'data/transactions.json'), JSON.stringify(data));
  await writeFile(join(project, 'data/regions.json'), JSON.stringify([{ code: '11', name: '서울특별시', districts: [region] }]));
  return project;
}

test('한국 날짜로 계약월 네 개를 계산하고 인코딩된 키를 한 번만 풀어낸다', () => {
  assert.deepEqual(recentMonths(new Date('2025-12-31T15:00:00.000Z')), ['202510', '202511', '202512', '202601']);
  assert.equal(normalizeKey(' demo%2Bkey%2F%3D '), 'demo+key/=');
  assert.equal(normalizeKey('demo+key/='), 'demo+key/=');
  assert.throws(() => normalizeKey('abc%Q'), /인코딩/);
});

test('일시적 오류를 다시 시도하고 공식 조회 경로만 사용한다', async () => {
  let attempts = 0;
  const fetchPage = makePageFetcher('demo+key/=', async (url, options) => {
    assert.equal(url.hostname, 'apis.data.go.kr');
    assert.equal(url.searchParams.get('serviceKey'), 'demo+key/=');
    assert.equal(url.searchParams.get('LAWD_CD'), '11110');
    assert.equal(url.searchParams.get('DEAL_YMD'), '202601');
    assert.equal(options.redirect, 'error');
    attempts++;
    if (attempts < 2) return new Response('unavailable', { status: 503 });
    return new Response('<response><header><resultCode>000</resultCode></header><body><items/><totalCount>0</totalCount><numOfRows>1000</numOfRows><pageNo>1</pageNo></body></response>');
  }, async () => {});
  assert.equal((await fetchPage(region, '202601', 1)).total, 0);
  assert.equal(attempts, 2);
});

test('인증 HTTP 오류는 반복하지 않고 인증값이나 원문을 로그에 남기지 않는다', async () => {
  let attempts = 0;
  const fetchPage = makePageFetcher('demo-test-key', async () => {
    attempts++;
    return new Response('demo-test-key', { status: 400 });
  }, async () => {});
  await assert.rejects(fetchPage(region, '202601', 1), error => error.message.includes('HTTP 400') && !error.message.includes('demo-test-key'));
  assert.equal(attempts, 1);
});

test('여러 페이지를 합쳐 동일 조건의 별개 거래를 유지하고 해제 건을 검산한다', async () => {
  const result = await collectMonth(region, '202601', async (_, __, page) =>
    page === 1 ? batch([row, { ...row, cdealType: 'O' }], page, 2, 3) : batch([row], page, 2, 3), january);
  assert.deepEqual(result.counts, { raw: 3, included: 2, canceled: 1, nonSale: 0 });
  assert.deepEqual(result.records[0], result.records[1]);
  assert.equal(result.pages, 2);
});

test('페이지 누락과 요청 도중 변경된 원자료 건수를 감지한다', async () => {
  for (const second of [batch([], 2, 1, 2), batch([row], 1, 1, 2), batch([row], 2, 1, 3)]) {
    await assert.rejects(collectMonth(region, '202601', async (_, __, page) => page === 1 ? batch([row], 1, 1, 2) : second, january), /전체 건수/);
  }
});

test('키 없이 배포를 준비할 수 있고 공식 데이터를 만들지 않는다', async t => {
  const project = await workspace(t);
  const result = await refreshTrades({ project, clock: january, log: quiet });
  assert.equal(result.state, 'awaiting_key');
  assert.equal(result.updatedAt, null);
  assert.deepEqual(result.districts, {});
});

test('수집 실패와 전체 0건에서 직전 성공의 파일과 확인 시각을 보존한다', async t => {
  const project = await workspace(t);
  const first = await refreshTrades({ project, key: 'demo', clock: january, log: quiet,
    fetchPage: async (_, month) => batch(month === '202601' ? [row] : []) });
  const dataPath = join(project, districtDataPath(first, region.code));
  const firstData = await readFile(dataPath, 'utf8');
  const nextDay = instant('2026-01-14T05:00:00.000Z');
  for (const fetchPage of [async () => { throw new Error('API error'); }, async () => batch([])]) {
    await assert.rejects(refreshTrades({ project, key: 'demo', fetchPage, clock: nextDay, log: quiet }), /API error|0건/);
    const status = JSON.parse(await readFile(join(project, 'data/transactions.json'), 'utf8'));
    assert.equal(status.state, 'failed');
    assert.equal(status.revision, first.revision);
    assert.equal(status.updatedAt, first.updatedAt);
    assert.equal(status.lastAttemptAt, nextDay().toISOString());
    assert.equal(await readFile(dataPath, 'utf8'), firstData);
  }
});

test('같은 계약월을 다시 조회해 뒤늦은 해제를 반영하고 수집 실패 상태를 복구한다', async t => {
  const project = await workspace(t);
  const first = await refreshTrades({ project, key: 'demo', clock: january, log: quiet,
    fetchPage: async (_, month) => batch(month === '202601' ? [row, row] : []) });
  const nextDay = instant('2026-01-14T05:00:00.000Z');
  await assert.rejects(refreshTrades({ project, key: 'demo', fetchPage: async () => batch([]), clock: nextDay, log: quiet }), /0건/);
  const second = await refreshTrades({ project, key: 'demo', clock: instant('2026-01-15T05:00:00.000Z'), log: quiet,
    fetchPage: async (_, month) => batch(month === '202601' ? [row, { ...row, cdealDay: '20260114' }] : []) });
  assert.equal(second.state, 'ok');
  assert.notEqual(second.revision, first.revision);
  assert.equal(second.districts['11110'].count, 1);
  assert.equal(second.districts['11110'].months['202601'].canceled, 1);
});
