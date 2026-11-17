import { districtDataPath, moneyWon, seoulDateTime, validateDistrict, validateManifest, validateRegions } from './market-data.js';
import {
  canDisplayQuotes, matchesQuoteArea, quoteDistrictPath, richgoComplexUrl, richgoDistrictUrl,
  RICHGO_SOURCE, validateQuoteDistrict, validateQuoteManifest,
} from './richgo-quotes.js';
import { createQuoteMap, kakaoMapLink } from './quote-map.js';

const $ = id => document.getElementById(id);
const districtSelect = $('quote-district');
const complexSelect = $('quote-complex');
const areaSelect = $('quote-area');
const state = { cities: [], areas: {}, manifest: null, rows: [], complexes: [], busy: true, regionsFailed: false, feedFailed: false };
let request;
let tradeManifest;
const showMap = createQuoteMap({
  frame: $('map-frame'), canvas: $('map-kakao'), placeholder: $('map-placeholder'),
  hint: $('map-hint'), credit: $('map-osm-credit'),
});

async function readJson(path, signal) {
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch('./' + path, {
    cache: /^data\/(trades|richgo-quotes)\//.test(path) ? 'default' : 'no-cache',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('자료를 확인하지 못했습니다.');
  return response.json();
}

function selectedRegion() {
  const code = districtSelect.value;
  const city = state.cities.find(region => region.districts.some(district => district.code === code)) ?? state.cities[0];
  return { city, district: city?.districts.find(district => district.code === code) };
}

function syncUrl() {
  const url = new URL(location.href);
  const trade = new URL('./', url);
  for (const [key, value] of [['gu', districtSelect.value], ['area', areaSelect.value === 'all' ? '' : areaSelect.value]]) {
    if (value) {
      url.searchParams.set(key, value);
      trade.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  history.replaceState(null, '', url);
  $('trades-link').href = trade.href;
}

function catalog(trades, quotes) {
  const entries = new Map();
  const nameKey = row => JSON.stringify([row.dong, row.aptName]);
  const quoteNames = new Set(quotes.map(nameKey));
  for (const row of quotes) entries.set(row.aptId, { ...row, key: row.aptId });
  for (const row of trades) {
    const key = nameKey(row);
    if (!quoteNames.has(key)) entries.set(key, { aptName: row.aptName, dong: row.dong, key });
  }
  return [...entries.values()].sort((a, b) => a.aptName.localeCompare(b.aptName, 'ko') || a.dong.localeCompare(b.dong, 'ko'));
}

function setComplexes(complexes, hint) {
  state.complexes = complexes;
  complexSelect.replaceChildren(new Option(hint, ''), ...complexes.map(complex =>
    new Option([complex.aptName, complex.dong].filter(Boolean).join(' · '), complex.key)));
  complexSelect.disabled = !complexes.length;
}

function renderQuoteRows(rows) {
  const body = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.setAttribute('role', 'row');
    const area = row.areaMinM2 === row.areaMaxM2 ? String(row.areaMinM2) : [row.areaMinM2, row.areaMaxM2].join('~');
    let range = '호가 확인 자료 없음';
    if (row.lowestWon !== null) {
      const prices = row.lowestWon === row.highestWon ? [row.lowestWon] : [row.lowestWon, row.highestWon];
      range = prices.map(moneyWon).join('~');
    }
    const source = document.createElement('a');
    source.textContent = RICHGO_SOURCE;
    source.href = richgoComplexUrl(row.aptId);
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    const sourceDetails = document.createElement('span');
    sourceDetails.className = 'evidence';
    sourceDetails.append(source);
    if (row.asOf) {
      const time = document.createElement('time');
      time.textContent = row.asOf + ' 기준';
      time.dateTime = row.asOf;
      sourceDetails.append(time);
    }
    for (const [label, value, className] of [
      ['', row.aptName + ' · ' + area + '㎡', 'name'],
      ['매물 수', row.count.toLocaleString('ko-KR') + '건'],
      ['호가', range, 'money price-cell'],
      ['출처 · 기준일', sourceDetails, 'source-cell'],
    ]) {
      const td = tr.insertCell();
      td.setAttribute('role', 'cell');
      if (label) td.dataset.label = label;
      if (className) td.className = className;
      td.append(value);
    }
    body.append(tr);
  }
  $('quote-rows').replaceChildren(body);
}

function setQuoteStatus(label, message, tone) {
  $('quote-status').dataset.tone = tone;
  $('quote-status').textContent = label;
  $('quote-message').textContent = message;
}

function render() {
  const { city, district } = selectedRegion();
  const complex = state.complexes.find(item => item.key === complexSelect.value);
  const scope = [city?.name ?? '서울특별시', district?.name].filter(Boolean).join(' ');
  const query = [scope, complex?.dong, complex?.aptName].filter(Boolean).join(' ');
  $('map-kakao-link').href = kakaoMapLink(query);
  $('map-selection').textContent = [scope, complex?.aptName].filter(Boolean).join(' · ');
  $('quote-selection').textContent = [district?.name ?? city?.name ?? '서울 아파트', complex?.aptName].filter(Boolean).join(' · ');
  $('quote-richgo').href = complex?.aptId ? richgoComplexUrl(complex.aptId) : richgoDistrictUrl(city?.code ?? '11', district?.name);
  $('quote-richgo-label').textContent = district ? '리치고 ' + district.name + ' 호가 확인' : '리치고에서 호가 확인';
  if (complex?.aptId) $('quote-richgo-label').textContent = '리치고 단지에서 확인';
  if (city) $('quote-region-name').textContent = city.name + ' · ' + city.districts.length + (city.code === '11' ? '개 자치구' : '개 시·군·구');
  $('quote-result').setAttribute('aria-busy', String(state.busy));
  $('quote-table').hidden = true;
  $('quote-rows').replaceChildren();
  if (city) {
    showMap({ bounds: state.areas[district?.code ?? city.code], regionName: scope, query, districtName: district?.name,
      complex, kakaoJavaScriptKey: state.manifest?.kakaoJavaScriptKey });
  }
  if (state.busy) {
    setQuoteStatus('확인 중', '선택한 지역의 자료를 확인하고 있습니다.', 'pending');
    return;
  }
  if (state.regionsFailed || state.feedFailed || state.manifest?.state === 'failed') {
    setQuoteStatus('자료 확인 필요', '현재 호가 자료를 불러오지 못했습니다. 리치고에서 확인할 수 있습니다.', 'error');
    return;
  }
  if (!canDisplayQuotes(state.manifest ?? {})) {
    setQuoteStatus('공급 연결 대기', '사이트 내 호가 집계는 공개용 데이터가 연결되면 표시됩니다. 리치고에서 현재 호가를 확인할 수 있습니다.', 'pending');
    return;
  }
  if (!district) {
    setQuoteStatus('공급 중', '시·군·구를 선택하면 전용면적별 호가를 볼 수 있습니다.', 'ready');
    return;
  }
  const rows = state.rows.filter(row => (!complex || row.aptId === complex.aptId) && matchesQuoteArea(row, areaSelect.value));
  const lastCheck = '피드 확인 ' + seoulDateTime(state.manifest.checkedAt);
  if (!rows.length) {
    setQuoteStatus('공급 자료 없음', '선택한 조건에 해당하는 호가 자료가 없습니다. ' + lastCheck, 'pending');
    return;
  }
  setQuoteStatus('호가 집계', rows.length.toLocaleString('ko-KR') + '개 단지·면적 집계 · ' + lastCheck, 'ready');
  renderQuoteRows(rows);
  $('quote-table').hidden = false;
}

async function loadTradeCatalog(code, signal) {
  tradeManifest ??= validateManifest(await readJson('data/transactions.json', signal));
  if (!tradeManifest.districts[code]) return [];
  return validateDistrict(await readJson(districtDataPath(tradeManifest, code), signal), tradeManifest, code);
}

async function loadDistrict() {
  request?.abort();
  request = new AbortController();
  const { signal } = request;
  const code = districtSelect.value;
  const hash = canDisplayQuotes(state.manifest ?? {}) ? state.manifest.districts[code] : null;
  state.rows = [];
  state.feedFailed = state.manifest === null;
  state.busy = Boolean(code);
  setComplexes([], code ? '단지 확인 중' : '시·군·구를 먼저 선택하세요');
  syncUrl();
  render();
  if (!code) return;
  const [trades, quotes] = await Promise.allSettled([
    loadTradeCatalog(code, signal),
    hash ? readJson(quoteDistrictPath(code, hash), signal).then(data => validateQuoteDistrict(data, code, state.manifest.checkedAt)) : [],
  ]);
  if (signal.aborted) return;
  state.feedFailed ||= quotes.status === 'rejected';
  state.rows = quotes.status === 'fulfilled' ? quotes.value : [];
  const complexes = catalog(trades.status === 'fulfilled' ? trades.value : [], state.rows);
  const hint = trades.status === 'rejected' && !complexes.length ? '단지 자료를 확인하지 못했습니다' : '전체 단지';
  setComplexes(complexes, hint);
  state.busy = false;
  render();
}

async function initialize() {
  const [regions, map, manifest] = await Promise.allSettled([
    readJson('data/regions.json').then(data => { validateRegions(data); return data; }),
    readJson('data/district-map.json'),
    readJson('data/richgo-quotes.json').then(validateQuoteManifest),
  ]);
  if (map.status === 'fulfilled') state.areas = map.value.bounds ?? {};
  if (manifest.status === 'fulfilled') state.manifest = manifest.value;
  if (regions.status === 'rejected') {
    state.regionsFailed = true;
    state.busy = false;
    districtSelect.replaceChildren(new Option('지역을 확인하지 못했습니다', ''));
    $('map-placeholder').textContent = '지역 지도를 확인하지 못했습니다.';
    render();
    return;
  }
  state.cities = regions.value;
  districtSelect.replaceChildren(new Option('시·군·구 선택', ''));
  for (const city of state.cities) {
    const group = document.createElement('optgroup');
    group.label = city.name;
    group.append(...city.districts.map(district => new Option(district.name, district.code)));
    districtSelect.append(group);
  }
  const params = new URLSearchParams(location.search);
  if (state.cities.some(city => city.districts.some(district => district.code === params.get('gu')))) {
    districtSelect.value = params.get('gu');
  }
  if (['59', '74', '84'].includes(params.get('area'))) areaSelect.value = params.get('area');
  districtSelect.disabled = false;
  loadDistrict();
}

$('quote-filters').addEventListener('submit', event => event.preventDefault());
districtSelect.addEventListener('change', loadDistrict);
complexSelect.addEventListener('change', render);
areaSelect.addEventListener('change', () => { syncUrl(); render(); });
$('quote-reset').addEventListener('click', () => {
  if (state.regionsFailed) return;
  districtSelect.value = '';
  areaSelect.value = 'all';
  loadDistrict();
});
initialize();
