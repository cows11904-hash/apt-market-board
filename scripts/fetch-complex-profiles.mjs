import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeProfiles, PROFILE_DOWNLOAD_URL, validateProfiles } from '../complex-profiles.js';

const target = fileURLToPath(new URL('../data/complex-profiles.json', import.meta.url));
const regions = JSON.parse(await readFile(new URL('../data/regions.json', import.meta.url), 'utf8'));
const previous = await readFile(target, 'utf8').then(value => validateProfiles(JSON.parse(value))).catch(() => null);
const body = new URLSearchParams({ srvType: 'S', infId: 'OA-15818', serviceKind: '1', pageNo: '1',
  gridTotalCnt: '', ssUserId: 'SAMPLE_VIEW', strWhere: '', strOrderby: 'SN ASC', filterCol: '필터선택', txtFilter: '' });
try {
  const response = await fetch(PROFILE_DOWNLOAD_URL, {
    method: 'POST', body, headers: { Referer: 'https://data.seoul.go.kr/' }, signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error('서울시 단지 정보 다운로드에 실패했습니다.');
  const snapshot = normalizeProfiles(await response.json(), regions, new Date().toISOString());
  if (previous && snapshot.profiles.length < previous.profiles.length * 0.8) throw new Error('단지 정보 건수가 크게 줄어 새 자료 게시를 보류합니다.');
  await writeFile(target + '.tmp', JSON.stringify(snapshot) + '\n');
  await rename(target + '.tmp', target);
  console.log(`서울시 단지 기본 정보 검증 완료: ${snapshot.profiles.length}개 단지`);
} catch (error) {
  console.warn(`::warning::${error.message}${previous ? ' 마지막 성공 자료를 유지합니다.' : ''}`);
  if (!previous) process.exitCode = 1;
}
