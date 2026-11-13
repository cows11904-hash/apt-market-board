import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isDay } from '../market-data.js';

const parser = new XMLParser({ parseTagValue: false, trimValues: true });
const nullMarkers = new Set(['', '-', '0', '00000000']);
const notCanceled = new Set(['', '-', '0', 'N', 'X']);
const canceled = new Set(['O', 'Y', '1', '해제', '취소']);
const nonSale = /증여|무상|상속|교환|신탁|판결/;
const integer = /^\d+$/;
const validAmount = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/;

function value(item, ...keys) {
  for (const key of keys) {
    const candidate = item?.[key];
    if (typeof candidate === 'number') return String(candidate);
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

export function parseRecord(item, { code, month, checkedAt }) {
  const mode = value(item, 'dealingGbn', '거래유형');
  const reason = value(item, 'transferType', 'transactionCause', '거래원인', '등기원인', '거래구분');
  if (nonSale.test(mode) || nonSale.test(reason)) return { disposition: 'nonSale' };

  const flag = value(item, 'cdealType', '해제여부').toUpperCase();
  const canceledAt = value(item, 'cdealDay', '해제사유발생일');
  if (canceled.has(flag) || !nullMarkers.has(canceledAt)) return { disposition: 'canceled' };
  if (!notCanceled.has(flag)) throw new Error('해제여부 값이 공식 자료 형식과 다릅니다.');

  const district = value(item, 'sggCd', '지역코드');
  const amount = value(item, 'dealAmount', '거래금액').replace(/\s/g, '');
  const priceWon = Number(amount.replaceAll(',', '')) * 10_000;
  const area = value(item, 'excluUseAr', '전용면적');
  const areaM2 = Number(area);
  const floorText = value(item, 'floor', '층');
  const floor = floorText === '' || floorText === '-' ? null : Number(floorText);
  const year = value(item, 'dealYear', '년');
  const monthText = value(item, 'dealMonth', '월');
  const day = value(item, 'dealDay', '일');
  const dealDate = `${year}-${monthText.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const aptName = value(item, 'aptNm', '아파트');
  if (district !== code || !validAmount.test(amount) || !Number.isSafeInteger(priceWon) || priceWon <= 0
    || !/^\d+(\.\d+)?$/.test(area) || !Number.isFinite(areaM2) || areaM2 <= 0
    || (floor !== null && (!/^-?\d+$/.test(floorText) || !Number.isSafeInteger(floor)))
    || !isDay(dealDate) || dealDate.slice(0, 7).replace('-', '') !== month || !aptName) {
    throw new Error('지역코드, 계약일, 금액, 면적, 층 또는 단지명이 공식 자료 형식과 다릅니다.');
  }
  return {
    disposition: 'included',
    record: {
      aptName,
      dong: value(item, 'umdNm', '법정동'),
      building: value(item, 'aptDong', '아파트동명'),
      areaM2, floor, dealDate, priceWon,
      transactionType: ['직거래', '중개거래'].includes(mode) ? mode : '구분 미확인',
      checkedAt,
    },
  };
}

function readInteger(body, key, min) {
  const raw = value(body, key);
  const number = Number(raw);
  if (!integer.test(raw) || !Number.isSafeInteger(number) || number < min) throw new Error(`응답 ${key} 값이 올바르지 않습니다.`);
  return number;
}

export class ApiResponseError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

export function parseResponse(xml) {
  // XML의 사용자 정의 엔티티나 DTD는 공식 응답에 필요하지 않습니다.
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('올바른 XML 응답을 받지 못했습니다.');
  const parsed = parser.parse(xml);
  const gateway = parsed.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gateway) {
    const code = value(gateway, 'returnReasonCode');
    throw new ApiResponseError(`공공데이터포털 응답 코드 ${integer.test(code) && code.length <= 3 ? code : '미확인'}`,
      { retryable: ['01', '02', '04', '05', '23'].includes(code) });
  }
  const { header, body } = parsed.response ?? {};
  const code = value(header, 'resultCode');
  if (!['00', '000'].includes(code)) {
    throw new ApiResponseError(`국토교통부 응답 코드 ${integer.test(code) && code.length <= 3 ? code : '미확인'}`,
      { retryable: ['01', '02', '04', '05', '23'].includes(code) });
  }
  if (!body || !Object.hasOwn(body, 'items')) throw new Error('응답에 거래 목록이 없습니다.');
  const raw = body.items?.item;
  const items = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  if (items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('응답에 읽을 수 없는 거래가 있습니다.');
  return {
    items,
    total: readInteger(body, 'totalCount', 0),
    page: readInteger(body, 'pageNo', 1),
    pageSize: readInteger(body, 'numOfRows', 1),
  };
}
