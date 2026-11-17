import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { districtDataPath, listingDataPath, LISTINGS_ENABLED, validateDistrict, validateManifest, validateRegions } from '../market-data.js';
import { quoteDistrictPath, validateQuoteManifest } from '../richgo-quotes.js';
import { validMapBounds } from '../quote-map.js';
import { prepareListings } from './listings-feed.mjs';
import { prepareRichgoQuotes } from './richgo-quotes-feed.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const json = async relative => JSON.parse(await readFile(join(root, relative), 'utf8'));
const regions = validateRegions(await json('data/regions.json'));
const regionCodes = new Set(regions.map(region => region.code));
const mapBounds = (await json('data/district-map.json')).bounds;
if (!mapBounds || !validMapBounds(mapBounds['11'])
    || regions.some(region => region.code.startsWith('11') && !validMapBounds(mapBounds[region.code]))) {
  throw new Error('서울 지도 범위를 확인해야 합니다.');
}
const manifest = validateManifest(await json('data/transactions.json'));
const files = ['.nojekyll', 'data/regions.json', 'data/transactions.json', 'data/district-map.json'];
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
const listingData = LISTINGS_ENABLED
  ? await prepareListings({
    local: await json('data/listings.json'), regionCodes,
    url: process.env.LISTINGS_FEED_URL, token: process.env.LISTINGS_FEED_TOKEN,
  })
  : null;
if (listingData?.feedState === 'failed') {
  console.warn('::warning::호가 피드 조회 또는 게시 검증에 실패했습니다. 피드의 호가는 게시하지 않습니다.');
}
const richgoQuotes = await prepareRichgoQuotes({
  regionCodes, url: process.env.RICHGO_QUOTES_FEED_URL, token: process.env.RICHGO_QUOTES_FEED_TOKEN,
  publicThrough: process.env.RICHGO_PUBLIC_THROUGH,
});
if (richgoQuotes.state === 'failed') console.warn('::warning::리치고 호가 피드를 확인하지 못했습니다.');

const configuredMapKey = process.env.KAKAO_MAP_JAVASCRIPT_KEY?.trim() ?? '';
const kakaoJavaScriptKey = /^[a-zA-Z0-9_-]{20,128}$/.test(configuredMapKey) ? configuredMapKey : '';

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const contentHash = content => createHash('sha256').update(content).digest('hex').slice(0, 12);

const leaflet = join(root, 'node_modules/leaflet');
const leafletPath = `vendor/leaflet-${contentHash(await readFile(join(leaflet, 'dist/leaflet.js')))}`;
const leafletOutput = join(output, leafletPath);
await mkdir(leafletOutput, { recursive: true });
for (const asset of ['leaflet.js', 'leaflet.js.map', 'leaflet.css', 'images']) {
  await cp(join(leaflet, 'dist', asset), join(leafletOutput, asset), { recursive: true });
}
await cp(join(leaflet, 'LICENSE'), join(leafletOutput, 'LICENSE'));

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
const richgoModule = await writeAsset('richgo-quotes.js',
  (await readFile(join(root, 'richgo-quotes.js'), 'utf8')).replace('./market-data.js', `./${marketData}`));
const mapModule = await writeAsset('quote-map.js', await readFile(join(root, 'quote-map.js')));
const quotes = (await readFile(join(root, 'quotes.js'), 'utf8'))
  .replace('./market-data.js', `./${marketData}`)
  .replace('./richgo-quotes.js', `./${richgoModule}`)
  .replace('./quote-map.js', `./${mapModule}`);
const quotesName = await writeAsset('quotes.js', quotes);
for (const [page, script, compiled] of [['index.html', 'app.js', appName], ['quotes.html', 'quotes.js', quotesName]]) {
  const html = (await readFile(join(root, page), 'utf8'))
    .replace('./styles.css', `./${styles}`)
    .replaceAll('./vendor/leaflet/', `./${leafletPath}/`)
    .replace(`./${script}`, `./${compiled}`);
  await writeFile(join(output, page), html);
}

for (const path of files) {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, path), target);
}
if (listingData) {
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
}
const quoteVersions = {};
for (const [code, rows] of richgoQuotes.districts) {
  const content = JSON.stringify({ districtCode: code, rows }) + '\n';
  const hash = contentHash(content);
  const target = join(output, quoteDistrictPath(code, hash));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  quoteVersions[code] = hash;
}
const quotesManifest = validateQuoteManifest({
  schemaVersion: 1, state: richgoQuotes.state, districts: quoteVersions, checkedAt: richgoQuotes.checkedAt,
  publicThrough: richgoQuotes.publicThrough, kakaoJavaScriptKey,
});
await writeFile(join(output, 'data/richgo-quotes.json'), JSON.stringify(quotesManifest) + '\n');
console.log(`Pages 배포 파일 검증 완료: ${regions.length}개 시·군·구, 정상 매매 ${total}건`);
