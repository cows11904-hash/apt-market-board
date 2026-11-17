import assert from 'node:assert/strict';
import test from 'node:test';
import { canDisplayQuotes, matchesQuoteArea, quoteDistrictPath, validateQuoteDistrict } from '../richgo-quotes.js';
import { kakaoMapLink, validMapBounds } from '../quote-map.js';
import { prepareRichgoQuotes } from './richgo-quotes-feed.mjs';

const morning = () => new Date('2026-11-16T21:17:00.000Z');
const options = {
  url: 'https://feed.example/quotes',
  regionCodes: new Set(['11110', '11410']),
  publicThrough: '2026-11-30',
  clock: morning,
};

function fixture() {
  return {
    complexes: [{
      districtCode: '11110',
      dong: '예제동',
      snapshot: {
        danji_id: 'aTest01',
        name: '예제단지',
        irrelevant: '공개할 필요 없는 공급 필드',
        pyeongs: [{
          private_area_m2: '84.78~84.96',
          sale_listings: { count: 2, asking_min_manwon: 50_000, asking_max_manwon: 51_000, as_of: '2026-11-17' },
        }],
      },
    }],
  };
}

test('공개 이용 기간이나 피드 주소가 없으면 수집 요청을 보내지 않는다', async () => {
  const fetcher = () => assert.fail('피드를 호출했습니다.');
  for (const config of [{ publicThrough: undefined }, { publicThrough: '2026-11-16' }, { url: '' }]) {
    const result = await prepareRichgoQuotes({ ...options, ...config, fetcher });
    assert.equal(result.state, 'awaiting_feed');
    assert.equal(result.districts.size, 0);
  }
});

test('허용된 피드를 한 번 읽어 서울의 평형별 호가와 기준일을 저장한다', async () => {
  let calls = 0;
  const result = await prepareRichgoQuotes({
    ...options,
    fetcher: async () => {
      calls += 1;
      return Response.json(fixture());
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.state, 'ok');
  assert.equal(result.checkedAt, '2026-11-16T21:17:00.000Z');
  const [row] = validateQuoteDistrict({ districtCode: '11110', rows: result.districts.get('11110') }, '11110', result.checkedAt);
  assert.deepEqual(row, {
    aptId: 'aTest01', aptName: '예제단지', dong: '예제동', areaMinM2: 84.78, areaMaxM2: 84.96,
    count: 2, lowestWon: 500_000_000, highestWon: 510_000_000, asOf: '2026-11-17',
  });
  assert.equal(matchesQuoteArea(row, '84'), true);
  assert.equal(matchesQuoteArea(row, '59'), false);
  assert.equal(canDisplayQuotes(result, new Date('2026-11-30T14:59:00Z')), true);
  assert.equal(canDisplayQuotes(result, new Date('2026-11-30T15:00:00Z')), false);
});

test('미래 기준일, 금액 오류, 피드 실패는 가격을 게시하지 않는다', async () => {
  const future = fixture();
  future.complexes[0].snapshot.pyeongs[0].sale_listings.as_of = '2026-11-18';
  const reversed = fixture();
  reversed.complexes[0].snapshot.pyeongs[0].sale_listings.asking_min_manwon = 52_000;
  for (const response of [Response.json(future), Response.json(reversed), new Response('unavailable', { status: 503 })]) {
    const result = await prepareRichgoQuotes({ ...options, fetcher: async () => response });
    assert.equal(result.state, 'failed');
    assert.equal(result.districts.size, 0);
  }
});

test('구별 자료 경로와 카카오맵 검색 링크를 안전하게 구성한다', () => {
  assert.equal(quoteDistrictPath('11110', '1234567890ab'), 'data/richgo-quotes/11110.1234567890ab.json');
  assert.throws(() => quoteDistrictPath('11110', '../path'));
  const map = new URL(kakaoMapLink('서울특별시 종로구 예제단지'));
  assert.equal(map.origin, 'https://map.kakao.com');
  assert.equal(decodeURIComponent(map.pathname), '/link/search/서울특별시 종로구 예제단지');
  assert.equal(validMapBounds([126.90, 37.50, 127.10, 37.60]), true);
  assert.equal(validMapBounds([127.10, 37.50, 126.90, 37.60]), false);
});
