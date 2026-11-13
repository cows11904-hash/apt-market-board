import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeListings, districtDataPath, validateDistrict, validateListings, validateManifest, validateRegions } from '../market-data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const json = async relative => JSON.parse(await readFile(join(root, relative), 'utf8'));
const regions = validateRegions(await json('data/regions.json'));
const regionCodes = new Set(regions.map(region => region.code));
const manifest = validateManifest(await json('data/transactions.json'));
const listingsFile = await json('data/listings.json');
const listings = validateListings(listingsFile);
const files = ['.nojekyll', 'index.html', 'styles.css', 'app.js', 'market-data.js', 'data/regions.json', 'data/transactions.json'];
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
if (listings.some(listing => !regionCodes.has(listing.districtCode))) throw new Error('공개 지역 목록에 없는 매물 호가가 있습니다.');

await rm(output, { recursive: true, force: true });
for (const path of files) {
  const target = join(output, path);
  await mkdir(join(target, '..'), { recursive: true });
  await cp(join(root, path), target);
}
const now = new Date();
const activeIds = new Set(regions.flatMap(region => activeListings(listings, region.code, now))
  .map(row => JSON.stringify([row.providerId, row.listingId])));
const publishedListings = listingsFile.listings.filter(row => activeIds.has(JSON.stringify([row.providerId, row.listingId])));
const activeProviders = new Set(publishedListings.map(row => row.providerId));
await writeFile(join(output, 'data/listings.json'), JSON.stringify({
  providers: listingsFile.providers.filter(provider => activeProviders.has(provider.id)),
  listings: publishedListings,
}) + '\n');
console.log(`Pages 배포 파일 검증 완료: ${regions.length}개 시·군·구, 정상 매매 ${total}건`);
