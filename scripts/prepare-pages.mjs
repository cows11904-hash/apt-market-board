import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { districtDataPath, listingDataPath, validateDistrict, validateManifest, validateRegions } from '../market-data.js';
import { prepareListings } from './listings-feed.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const json = async relative => JSON.parse(await readFile(join(root, relative), 'utf8'));
const regions = validateRegions(await json('data/regions.json'));
const regionCodes = new Set(regions.map(region => region.code));
const manifest = validateManifest(await json('data/transactions.json'));
const files = ['.nojekyll', 'data/regions.json', 'data/transactions.json'];
let total = 0;
if (manifest.revision) {
  for (const code of Object.keys(manifest.districts)) {
    if (!regionCodes.has(code)) throw new Error(`공개 지역 목록에 없는 시·군·구입니다. (${code})`);
    const path = districtDataPath(manifest, code);
    total += validateDistrict(await json(path), manifest, code).length;
    files.push(path);
  }
  if (!total) throw new Error('수집 기록에 연결된 정상 매매가 없습니다.');
}
const listingData = await prepareListings({
  local: await json('data/listings.json'), regionCodes,
  url: process.env.LISTINGS_FEED_URL, token: process.env.LISTINGS_FEED_TOKEN,
});
if (listingData.feedState === 'failed') {
  console.warn('::warning::호가 피드 조회 또는 게시 검증에 실패했습니다. 피드의 호가는 게시하지 않습니다.');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const contentHash = content => createHash('sha256').update(content).digest('hex').slice(0, 12);

async function writeAsset(name, content) {
  const extension = extname(name);
  const publishedName = `${name.slice(0, -extension.length)}.${contentHash(content)}${extension}`;
  await writeFile(join(output, publishedName), content);
  return publishedName;
}

const styles = await writeAsset('styles.css', await readFile(join(root, 'styles.css')));
const marketData = await writeAsset('market-data.js', await readFile(join(root, 'market-data.js')));
const app = (await readFile(join(root, 'app.js'), 'utf8')).replace('./market-data.js', `./${marketData}`);
const appName = await writeAsset('app.js', app);
const index = (await readFile(join(root, 'index.html'), 'utf8'))
  .replace('./styles.css', `./${styles}`)
  .replace('./app.js', `./${appName}`);
await writeFile(join(output, 'index.html'), index);

for (const path of files) {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, path), target);
}
const districtVersions = {};
for (const [code, snapshot] of listingData.districts) {
  const content = JSON.stringify(snapshot) + '\n';
  const hash = contentHash(content);
  const target = join(output, listingDataPath(code, hash));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  districtVersions[code] = hash;
}
await writeFile(join(output, 'data/listings.json'), JSON.stringify({
  feedState: listingData.feedState, districts: districtVersions, providers: [], listings: [],
}) + '\n');
console.log(`Pages 배포 파일 검증 완료: ${regions.length}개 시·군·구, 정상 매매 ${total}건`);
