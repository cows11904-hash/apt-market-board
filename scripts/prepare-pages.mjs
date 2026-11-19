import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { districtDataPath, validateDistrict, validateManifest, validateRegions } from '../market-data.js';
import { validMapBounds } from '../quote-map.js';
import { pageSecurityPolicy } from './page-security.mjs';
import { buildComplexCatalog, complexCatalogPath, validateComplexCatalog } from '../complex-data.js';
import { validateProfiles } from '../complex-profiles.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const regions = validateRegions(await json('data/regions.json'));
const regionCodes = new Set(regions.map(row => row.code));
const bounds = (await json('data/district-map.json')).bounds;
if (!validMapBounds(bounds?.['11']) || regions.some(row => !validMapBounds(bounds[row.code]))) throw new Error('지역별 지도 범위를 확인해야 합니다.');
const manifest = validateManifest(await json('data/transactions.json'));
const profiles = validateProfiles(await json('data/complex-profiles.json'));
const files = ['.nojekyll', 'data/regions.json', 'data/transactions.json', 'data/district-map.json'];
const tradesByDistrict = new Map();
let total = 0;
if (manifest.revision) for (const code of Object.keys(manifest.districts)) {
  if (!regionCodes.has(code)) throw new Error('공개 지역 목록에 없는 거래입니다.');
  const path = districtDataPath(manifest, code);
  const rows = validateDistrict(await json(path), manifest, code);
  tradesByDistrict.set(code, rows); files.push(path); total += rows.length;
}
if (manifest.revision && !total) throw new Error('수집 기록에 연결된 정상 매매가 없습니다.');

await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
const contentHash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
async function asset(name, replacements = {}) {
  let content = await readFile(join(root, name), 'utf8');
  for (const [source, target] of Object.entries(replacements)) content = content.replaceAll('./' + source, './' + target);
  const extension = extname(name);
  const published = name.slice(0, -extension.length) + '.' + contentHash(content) + extension;
  await writeFile(join(output, published), content); return published;
}
const styles = await asset('styles.css');
const marketData = await asset('market-data.js');
const profileModule = await asset('complex-profiles.js', { 'market-data.js': marketData });
const richgoModule = await asset('richgo-quotes.js', { 'market-data.js': marketData });
const complexModule = await asset('complex-data.js', { 'market-data.js': marketData, 'richgo-quotes.js': richgoModule, 'complex-profiles.js': profileModule });
const mapModule = await asset('quote-map.js');
const app = await asset('app.js', { 'market-data.js': marketData, 'complex-data.js': complexModule, 'quote-map.js': mapModule });
const legacy = await asset('quotes.js');
const leaflet = join(root, 'node_modules/leaflet');
const leafletPath = 'vendor/leaflet-' + contentHash(await readFile(join(leaflet, 'dist/leaflet.js')));
await mkdir(join(output, leafletPath), { recursive: true });
for (const name of ['leaflet.js', 'leaflet.js.map', 'leaflet.css', 'images']) await cp(join(leaflet, 'dist', name), join(output, leafletPath, name), { recursive: true });
await cp(join(leaflet, 'LICENSE'), join(output, leafletPath, 'LICENSE'));
const configuredKey = process.env.KAKAO_MAP_JAVASCRIPT_KEY?.trim() || '';
const kakaoJavaScriptKey = /^[a-zA-Z0-9_-]{20,128}$/.test(configuredKey) ? configuredKey : '';
for (const [page, source, compiled, map] of [['index.html', 'app.js', app, true], ['quotes.html', 'quotes.js', legacy, false]]) {
  const html = (await readFile(join(root, page), 'utf8'))
    .replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, '$1' + pageSecurityPolicy({ map, kakao: Boolean(kakaoJavaScriptKey) }) + '$2')
    .replace('./styles.css', './' + styles).replaceAll('./vendor/leaflet/', './' + leafletPath + '/').replace('./' + source, './' + compiled);
  await writeFile(join(output, page), html);
}
for (const path of files) { const target = join(output, path); await mkdir(dirname(target), { recursive: true }); await cp(join(root, path), target); }
const apartments = buildComplexCatalog(tradesByDistrict, new Map(), profiles.profiles);
const catalog = { schemaVersion: 1, tradeRevision: manifest.revision, apartments };
validateComplexCatalog(catalog, regionCodes);
const content = JSON.stringify(catalog) + '\n';
const catalogHash = contentHash(content);
const target = join(output, complexCatalogPath(catalogHash));
await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
await writeFile(join(output, 'data/app-config.json'), JSON.stringify({ schemaVersion: 1, catalogHash,
  profileCheckedAt: profiles.checkedAt, profileCount: profiles.profiles.length, kakaoJavaScriptKey }) + '\n');
console.log(`Pages 배포 파일 검증 완료: ${regions.length}개 자치구, 정상 매매 ${total}건, 단지 기본 정보 ${profiles.profiles.length}개`);
