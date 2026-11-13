import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecord, parseResponse } from './parse.mjs';

const context = { code: '11110', month: '202601', checkedAt: '2026-02-01T00:00:00.000Z' };
const row = {
  sggCd: '11110', aptNm: '테스트단지', dealAmount: '100,250', dealYear: '2026', dealMonth: '1', dealDay: '9',
  excluUseAr: '84.962', floor: '3', dealingGbn: '중개거래', cdealType: '', umdNm: '테스트동',
};

function xmlPage(items = [], { total = items.length, size = 1000, page = 1 } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body>
    <items>${items.map(entry => `<item>${Object.entries(entry).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}</item>`).join('')}</items>
    <numOfRows>${size}</numOfRows><pageNo>${page}</pageNo><totalCount>${total}</totalCount></body></response>`;
}

test('공식 매매 금액을 원 단위로 변환하고 전용면적과 확인일을 유지한다', () => {
  const { disposition, record } = parseRecord(row, context);
  assert.equal(disposition, 'included');
  assert.equal(record.priceWon, 1_002_500_000);
  assert.equal(record.areaM2, 84.962);
  assert.equal(record.dealDate, '2026-01-09');
  assert.equal(record.checkedAt, context.checkedAt);
});

test('해제 여부와 해제 사유 발생일을 각각 검사한다', () => {
  assert.equal(parseRecord({ ...row, cdealType: 'O' }, context).disposition, 'canceled');
  assert.equal(parseRecord({ ...row, cdealDay: '20260115' }, context).disposition, 'canceled');
  assert.equal(parseRecord({ ...row, cdealType: 'N', cdealDay: '00000000' }, context).disposition, 'included');
  assert.throws(() => parseRecord({ ...row, cdealType: 'UNKNOWN' }, context), /해제여부/);
});

test('금액이 들어 있어도 명시적 증여, 무상 이전 및 상속을 제외한다', () => {
  assert.equal(parseRecord({ ...row, dealingGbn: '증여' }, context).disposition, 'nonSale');
  assert.equal(parseRecord({ ...row, transferType: '무상 소유권이전' }, context).disposition, 'nonSale');
  assert.equal(parseRecord({ ...row, 등기원인: '상속' }, context).disposition, 'nonSale');
});

test('직거래, 중개거래 및 원자료에 구분이 없는 경우를 유지한다', () => {
  assert.equal(parseRecord({ ...row, dealingGbn: '직거래' }, context).record.transactionType, '직거래');
  assert.equal(parseRecord(row, context).record.transactionType, '중개거래');
  assert.equal(parseRecord({ ...row, dealingGbn: '' }, context).record.transactionType, '구분 미확인');
});

test('층이 비면 미확인으로 두고 잘못된 층, 가격, 지역 또는 날짜는 거부한다', () => {
  for (const fields of [{ floor: '미정' }, { dealAmount: '12,34' }, { sggCd: '11140' }, { dealMonth: '2' }, { dealDay: '32' }]) {
    assert.throws(() => parseRecord({ ...row, ...fields }, context), /공식 자료 형식/);
  }
  assert.equal(parseRecord({ ...row, floor: '-1' }, context).record.floor, -1);
  assert.equal(parseRecord({ ...row, floor: '' }, context).record.floor, null);
});

test('공식 XML에서 0건, 단일 행, 여러 행을 처리한다', () => {
  assert.deepEqual(parseResponse(xmlPage()), { items: [], total: 0, pageSize: 1000, page: 1 });
  assert.deepEqual(parseResponse(xmlPage([row])).items, [row]);
  assert.equal(parseResponse(xmlPage([row, row])).items.length, 2);
});

test('잘못된 XML, 게이트웨이 인증 오류, 불완전한 성공 응답을 거부한다', () => {
  assert.throws(() => parseResponse('<html>blocked</html>'), /코드 미확인/);
  assert.throws(() => parseResponse('<response><header></response>'), /XML/);
  assert.throws(() => parseResponse('<!DOCTYPE response><response/>'), /XML/);
  assert.throws(() => parseResponse('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'), /응답 코드 30/);
  assert.throws(() => parseResponse(xmlPage().replace('<totalCount>0</totalCount>', '')), /totalCount/);
});
