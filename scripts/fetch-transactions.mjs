import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MOLIT_SOURCE, MOLIT_SOURCE_URL, seoulDay,
  validateDistrict, validateManifest, validateRegions,
} from '../market-data.js';
import { ApiResponseError, parseRecord, parseResponse } from './parse.mjs';

const ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const PAGE_SIZE = 1000;
const PROJECT = fileURLToPath(new URL('../', import.meta.url));

export function recentMonths(now) {
  const [year, month] = seoulDay(now).split('-').map(Number);
  return [3, 2, 1, 0].map(offset => new Date(Date.UTC(year, month - 1 - offset, 1))
    .toISOString().slice(0, 7).replace('-', ''));
}

export function normalizeKey(input) {
  const key = input?.trim() ?? '';
  if (!key.includes('%')) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    throw new Error('API 인증키 인코딩을 확인하세요.');
  }
}

export function makePageFetcher(key, fetchImpl = fetch, wait = sleep) {
  return async (region, month, page) => {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      serviceKey: key, LAWD_CD: region.code, DEAL_YMD: month, pageNo: String(page), numOfRows: String(PAGE_SIZE),
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let response;
        try {
          response = await fetchImpl(url, {
            headers: { Accept: 'application/xml, text/xml' },
            redirect: 'error', signal: AbortSignal.timeout(20_000),
          });
        } catch {
          throw new ApiResponseError('공식 API에 연결하지 못했습니다.', { retryable: true });
        }
        if (!response.ok) {
          throw new ApiResponseError(`공식 API HTTP ${response.status}`,
            { retryable: response.status === 429 || response.status >= 500 });
        }
        const xml = await response.text().catch(() => {
          throw new ApiResponseError('공식 API 응답을 끝까지 읽지 못했습니다.', { retryable: true });
        });
        return parseResponse(xml);
      } catch (error) {
        if (!error.retryable || attempt === 2) throw new Error(`${region.code}/${month}/${page}: ${error.message}`);
        await wait(1000 * 2 ** attempt);
      }
    }
  };
}

export async function collectMonth(region, month, fetchPage, clock = () => new Date()) {
  const first = await fetchPage(region, month, 1);
  const pages = Math.max(1, Math.ceil(first.total / first.pageSize));
  if (pages > 40) throw new Error(`${region.code}/${month}: 한 달 페이지 수가 상한을 넘었습니다.`);
  const counts = { raw: first.total, included: 0, canceled: 0, nonSale: 0 };
  const records = [];
  for (let page = 1; page <= pages; page++) {
    const result = page === 1 ? first : await fetchPage(region, month, page);
    const expected = Math.min(first.pageSize, first.total - (page - 1) * first.pageSize);
    if (result.total !== first.total || result.page !== page || result.pageSize !== first.pageSize
      || result.items.length !== expected) throw new Error(`${region.code}/${month}/${page}: 응답 페이지와 전체 건수가 일치하지 않습니다.`);
    const checkedAt = clock().toISOString();
    for (const item of result.items) {
      try {
        const { disposition, record } = parseRecord(item, { code: region.code, month, checkedAt });
        counts[disposition]++;
        if (record) records.push(record);
      } catch (error) {
        throw new Error(`${region.code}/${month}/${page}: ${error.message}`);
      }
    }
  }
  return { counts, records, pages };
}

async function writeManifest(directory, manifest) {
  const temp = join(directory, `transactions.${process.pid}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(validateManifest(manifest), null, 2) + '\n');
    await rename(temp, join(directory, 'transactions.json'));
  } finally {
    await rm(temp, { force: true });
  }
}

export async function refreshTrades({ project = PROJECT, key, fetchPage, clock = () => new Date(), log = console.log } = {}) {
  const directory = join(project, 'data');
  const previous = validateManifest(JSON.parse(await readFile(join(directory, 'transactions.json'), 'utf8')));
  const started = clock();
  let draftPath;
  let publishedPath;
  let manifestWritten = false;
  try {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey && !previous.updatedAt) {
      log('공식 데이터 첫 연결 대기: MOLIT_SERVICE_KEY를 설정하면 수집이 시작됩니다.');
      return previous;
    }
    if (!normalizedKey) throw new Error('MOLIT_SERVICE_KEY가 없어 이전 자료를 유지합니다.');
    const requestPage = fetchPage ?? makePageFetcher(normalizedKey);
    const regions = validateRegions(JSON.parse(await readFile(join(directory, 'regions.json'), 'utf8')));
    const months = recentMonths(started);
    const districtFiles = new Map();
    const summaries = {};
    let totalTrades = 0;
    let totalPages = 0;
    for (const region of regions) {
      const transactions = [];
      const monthly = {};
      for (const month of months) {
        const { counts, records, pages } = await collectMonth(region, month, requestPage, clock);
        const priorCount = previous.districts[region.code]?.months[month]?.raw ?? 0;
        if (priorCount >= 30 && counts.raw < priorCount / 2) {
          throw new Error(`${region.code}/${month}: 직전 수집보다 원자료 건수가 절반 미만입니다.`);
        }
        for (const record of records) transactions.push(record);
        monthly[month] = counts;
        totalPages += pages;
      }
      transactions.sort((a, b) => b.dealDate.localeCompare(a.dealDate));
      totalTrades += transactions.length;
      summaries[region.code] = { count: transactions.length, months: monthly };
      districtFiles.set(region.code, transactions);
    }
    if (totalTrades === 0) throw new Error('전체 범위의 정상 매매가 0건이어서 이전 자료를 유지합니다.');

    const updatedAt = clock().toISOString();
    const revision = updatedAt.replace(/[-:.]/g, '');
    const manifest = {
      schemaVersion: 1, state: 'ok', lastAttemptAt: updatedAt, updatedAt, revision,
      source: MOLIT_SOURCE, sourceUrl: MOLIT_SOURCE_URL, months, districts: summaries,
    };
    const tradeDirectory = join(directory, 'trades');
    await mkdir(tradeDirectory, { recursive: true });
    draftPath = join(tradeDirectory, `.${revision}.${process.pid}.tmp`);
    await mkdir(draftPath);
    for (const [code, transactions] of districtFiles) {
      const data = { districtCode: code, revision, transactions };
      validateDistrict(data, manifest, code);
      await writeFile(join(draftPath, `${code}.json`), JSON.stringify(data) + '\n');
    }
    const destination = join(tradeDirectory, revision);
    await rename(draftPath, destination);
    publishedPath = destination;
    await writeManifest(directory, manifest);
    manifestWritten = true;
    if (previous.revision && previous.revision !== revision) {
      await rm(join(tradeDirectory, previous.revision), { recursive: true, force: true })
        .catch(() => log('이전 지역 파일이 작업 디렉터리에 남았습니다. 새 배포에는 현재 버전만 포함됩니다.'));
    }
    log(`공식 수집 완료: ${regions.length}개 시·군·구, ${totalPages}페이지, 정상 매매 ${totalTrades}건`);
    return manifest;
  } catch (error) {
    if (!manifestWritten) {
      if (publishedPath) await rm(publishedPath, { recursive: true, force: true });
      await writeManifest(directory, { ...previous, state: 'failed', lastAttemptAt: clock().toISOString() });
    }
    throw error;
  } finally {
    if (draftPath) await rm(draftPath, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await refreshTrades({ key: process.env.MOLIT_SERVICE_KEY });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
