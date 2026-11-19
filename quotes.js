import { districtDataPath, filterRecords, moneyWon, MOLIT_SOURCE_URL, seoulDateTime, seoulDay, STALE_AFTER_MS, validateDistrict, validateManifest, validateRegions } from './market-data.js';
import {
  canDisplayQuotes, matchesQuoteArea, quoteDistrictPath, richgoComplexUrl, richgoDistrictUrl,
  RICHGO_SOURCE, validateQuoteDistrict, validateQuoteManifest,
} from './richgo-quotes.js';
import { createQuoteMap, kakaoMapLink } from './quote-map.js';
import { complexCatalogPath, complexKey, searchComplexes, validateComplexCatalog } from './complex-data.js';

const $ = id => document.getElementById(id);
const districtSelect = $('quote-district');
const searchInput = $('quote-search');
const areaSelect = $('quote-area');
const state = {
  cities: [], areas: {}, manifest: null, tradeManifest: null, rows: [], trades: [], complexes: [],
  selected: null, busy: false, catalogLoading: true, catalogFailed: false,
  regionsFailed: false, feedFailed: false, tradeFailed: false, resultLimit: 6, tradeLimit: 6,
};
const districtNames = new Map();
let request;
let composing = false;
const showMap = createQuoteMap({
  raster: $('map-raster'), canvas: $('map-kakao'), placeholder: $('map-placeholder'), hint: $('map-hint'),
});

async function readJson(path, signal) {
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch('./' + path, {
    cache: /^data\/(trades|richgo-quotes|complexes)\//.test(path) ? 'default' : 'no-cache',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('자료를 확인하지 못했습니다.');
  return response.json();
}

function selectedRegion() {
  const code = state.selected?.districtCode ?? districtSelect.value;
  const city = state.cities.find(region => region.districts.some(district => district.code === code)) ?? state.cities[0];
  return { city, district: city?.districts.find(district => district.code === code) };
}

function syncUrl() {
  const url = new URL(location.href);
  const trade = new URL('./', url);
  for (const [key, value] of [['gu', districtSelect.value], ['area', areaSelect.value === 'all' ? '' : areaSelect.value], ['q', searchInput.value.trim()], ['apt', state.selected?.key]]) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  const code = state.selected?.districtCode ?? districtSelect.value;
  if (code) trade.searchParams.set('gu', code);
  if (areaSelect.value !== 'all') trade.searchParams.set('area', areaSelect.value);
  history.replaceState(null, '', url);
  $('trades-link').href = trade.href;
}

function matchingComplexes() {
  const matches = searchComplexes(state.complexes, {
    district: districtSelect.value, query: searchInput.value, area: areaSelect.value,
  }, districtNames);
  return matches.sort((a, b) => b.tradeCount - a.tradeCount || a.aptName.localeCompare(b.aptName, 'ko'));
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function periodLabel() {
  const months = state.tradeManifest?.months ?? [];
  if (!months.length) return '';
  const label = month => month.slice(0, 4) + '.' + month.slice(4);
  return [label(months[0]), label(months.at(-1))].join('~');
}

function renderSearch() {
  $('complex-results-panel').hidden = Boolean(state.selected);
  const matches = matchingComplexes();
  $('complex-results-heading').textContent = searchInput.value.trim() ? '검색 결과' : '수집기간 거래순 단지';
  const scope = districtNames.get(districtSelect.value) ?? '서울 전체';
  $('complex-results-count').textContent = state.catalogLoading ? '단지 목록을 불러오는 중입니다.'
    : state.catalogFailed ? '단지 목록을 불러오지 못했습니다.' : scope + ' · ' + matches.length.toLocaleString('ko-KR') + '개 단지';
  $('complex-results').setAttribute('aria-busy', String(state.catalogLoading));
  $('complex-results-empty').hidden = state.catalogLoading || state.catalogFailed || matches.length > 0;
  $('complex-retry').hidden = !state.catalogFailed;
  $('complex-more').hidden = state.catalogLoading || matches.length <= state.resultLimit;
  const fragment = document.createDocumentFragment();
  for (const apartment of matches.slice(0, state.resultLimit)) {
    const location = [districtNames.get(apartment.districtCode), apartment.dong].filter(Boolean).join(' · ');
    const button = node('button', '', 'complex-result');
    button.type = 'button';
    button.setAttribute('aria-label', apartment.aptName + ' ' + location + ' 상세보기');
    const label = node('span', '', 'complex-result-name');
    label.append(node('strong', apartment.aptName), node('span', location, 'complex-location'));
    const detail = node('span', '', 'complex-result-info');
    detail.append(node('span', apartment.tradeCount ? '실거래 ' + apartment.tradeCount.toLocaleString('ko-KR') + '건 · 전체면적' : '호가 공급 단지'));
    if (apartment.lastTradeDate) detail.append(node('small', '최근 계약 ' + apartment.lastTradeDate));
    button.append(label, detail);
    button.addEventListener('click', () => selectComplex(apartment));
    fragment.append(button);
  }
  $('complex-results').replaceChildren(fragment);
  const timestamp = state.tradeManifest?.updatedAt;
  $('complex-catalog-note').textContent = timestamp
    ? '국토교통부 ' + periodLabel() + ' 신고 단지 기준 · ' + seoulDay(timestamp) + ' 확인'
    : '공식 실거래와 공개용 호가 공급 자료에 포함된 단지를 검색합니다.';
}

function selectComplex(apartment) {
  state.selected = apartment;
  state.tradeLimit = 6;
  syncUrl();
  loadDistrict();
}

function renderDetail() {
  const apartment = state.selected;
  $('complex-detail').hidden = !apartment;
  if (!apartment) return;
  $('complex-name').textContent = apartment.aptName;
  $('complex-address').textContent = [districtNames.get(apartment.districtCode), apartment.dong].filter(Boolean).join(' · ');
  const area = areaSelect.value === 'all' ? '전체 전용면적' : areaSelect.selectedOptions[0].textContent;
  $('complex-scope').textContent = area + ' · ' + periodLabel() + ' 계약 신고 기준';
  $('complex-trade-period').textContent = periodLabel();
  $('complex-metrics').hidden = true;
  $('complex-evidence').hidden = true;
  $('complex-trades-table').hidden = true;
  $('complex-trades-more').hidden = true;
  $('trade-notice').hidden = true;
  $('complex-trades-empty').hidden = false;
  const records = filterRecords(state.trades.filter(row => row.aptName === apartment.aptName && row.dong === apartment.dong), {
    area: areaSelect.value, search: '', month: '', kind: '', maxWon: null,
  });
  if (state.busy) {
    $('complex-trades-empty').textContent = '선택한 단지의 실거래를 확인하고 있습니다.';
    return;
  }
  if (state.tradeFailed) {
    $('complex-trades-empty').textContent = '실거래 자료를 불러오지 못했습니다. 단지를 다시 선택해 주세요.';
    return;
  }
  if (!records.length) {
    $('complex-trades-empty').textContent = '수집기간에 선택한 면적의 공개 매매 신고가 없습니다.';
    return;
  }
  const latest = records[0];
  const prices = records.map(row => row.priceWon);
  $('complex-latest-price').textContent = moneyWon(latest.priceWon);
  $('complex-latest-spec').textContent = latest.dealDate + ' · ' + latest.areaM2 + '㎡ · ' + (latest.floor === null ? '층 미확인' : latest.floor + '층');
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  $('complex-price-range').textContent = min === max ? moneyWon(min) : moneyWon(min) + '~' + moneyWon(max);
  $('complex-trade-count').textContent = records.length.toLocaleString('ko-KR') + '건';
  $('complex-trade-types').textContent = ['중개거래', '직거래', '구분 미확인'].map(type => {
    const count = records.filter(row => row.transactionType === type).length;
    return count ? type + ' ' + count + '건' : '';
  }).filter(Boolean).join(' · ');
  $('complex-checked-at').textContent = seoulDay(state.tradeManifest.updatedAt) + ' 확인';
  $('complex-metrics').hidden = false;
  $('complex-evidence').hidden = false;
  if (state.tradeManifest.state === 'failed' || Date.now() - Date.parse(state.tradeManifest.updatedAt) > STALE_AFTER_MS) {
    $('trade-notice').textContent = '최근 갱신이 지연되어 ' + seoulDateTime(state.tradeManifest.updatedAt) + ' 수집 자료를 표시합니다.';
    $('trade-notice').hidden = false;
  }
  const fragment = document.createDocumentFragment();
  for (const record of records.slice(0, state.tradeLimit)) {
    const tr = document.createElement('tr');
    tr.setAttribute('role', 'row');
    const date = node('time', record.dealDate);
    date.dateTime = record.dealDate;
    const badge = node('span', record.transactionType, record.transactionType === '직거래' ? 'tag direct' : 'tag');
    const evidence = node('span', '', 'evidence');
    const source = node('a', '국토교통부');
    source.href = MOLIT_SOURCE_URL;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    const time = node('time', seoulDay(record.checkedAt) + ' 확인');
    time.dateTime = record.checkedAt;
    evidence.append(source, time);
    for (const [label, value, className] of [
      ['계약일', date, 'date-cell'],
      ['전용면적 · 층', record.areaM2 + '㎡ · ' + (record.floor === null ? '미확인' : record.floor + '층'), ''],
      ['실거래가', moneyWon(record.priceWon), 'money price-cell'],
      ['거래 유형', badge, ''], ['출처 · 확인일', evidence, 'source-cell'],
    ]) {
      const td = tr.insertCell();
      td.setAttribute('role', 'cell');
      td.dataset.label = label;
      if (className) td.className = className;
      td.append(value);
    }
    fragment.append(tr);
  }
  $('complex-trade-rows').replaceChildren(fragment);
  $('complex-trades-empty').hidden = true;
  $('complex-trades-table').hidden = false;
  $('complex-trades-more').hidden = records.length <= state.tradeLimit;
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
  const complex = state.selected;
  const scope = [city?.name ?? '서울특별시', district?.name].filter(Boolean).join(' ');
  const query = [scope, complex?.dong, complex?.aptName].filter(Boolean).join(' ');
  $('map-kakao-link').href = kakaoMapLink(query);
  $('map-selection').textContent = [scope, complex?.aptName].filter(Boolean).join(' · ');
  $('quote-selection').textContent = [district?.name ?? city?.name ?? '서울 아파트', complex?.aptName].filter(Boolean).join(' · ');
  $('quote-richgo').href = complex?.aptId ? richgoComplexUrl(complex.aptId) : richgoDistrictUrl(city?.code ?? '11', district?.name);
  $('quote-richgo-label').textContent = district ? '리치고 ' + district.name + ' 호가 확인' : '리치고에서 호가 확인';
  if (complex?.aptId) $('quote-richgo-label').textContent = '리치고 단지에서 확인';
  if (city) $('quote-region-name').textContent = city.name + ' · ' + city.districts.length + (city.code === '11' ? '개 자치구' : '개 시·군·구');
  renderSearch();
  renderDetail();
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
    setQuoteStatus('공급 연결 대기', '공개용 호가 데이터 연결을 준비하고 있습니다. 현재 호가는 리치고 원문에서 확인할 수 있습니다.', 'pending');
    return;
  }
  if (!district) {
    setQuoteStatus('공급 중', '시·군·구를 선택하면 전용면적별 호가를 볼 수 있습니다.', 'ready');
    return;
  }
  const matches = new Set(matchingComplexes().map(apartment => apartment.key));
  const rows = state.rows.filter(row => (complex ? row.aptName === complex.aptName && row.dong === complex.dong
    : matches.has(complexKey(district.code, row.dong, row.aptName))) && matchesQuoteArea(row, areaSelect.value));
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
  if (!state.tradeManifest) throw new Error('실거래 자료 목록을 확인하지 못했습니다.');
  if (!state.tradeManifest.districts[code]) return [];
  return validateDistrict(await readJson(districtDataPath(state.tradeManifest, code), signal), state.tradeManifest, code);
}

async function loadDistrict() {
  request?.abort();
  request = new AbortController();
  const { signal } = request;
  const code = state.selected?.districtCode ?? districtSelect.value;
  const hash = canDisplayQuotes(state.manifest ?? {}) ? state.manifest.districts[code] : null;
  state.rows = [];
  state.trades = [];
  state.tradeFailed = false;
  state.feedFailed = state.manifest === null;
  state.busy = Boolean(code);
  syncUrl();
  render();
  if (!code) return;
  const [trades, quotes] = await Promise.allSettled([
    state.selected ? loadTradeCatalog(code, signal) : [],
    hash ? readJson(quoteDistrictPath(code, hash), signal).then(data => validateQuoteDistrict(data, code, state.manifest.checkedAt)) : [],
  ]);
  if (signal.aborted) return;
  state.feedFailed ||= quotes.status === 'rejected';
  state.tradeFailed = trades.status === 'rejected';
  state.trades = trades.status === 'fulfilled' ? trades.value : [];
  state.rows = quotes.status === 'fulfilled' ? quotes.value : [];
  state.busy = false;
  render();
}

async function initialize() {
  const [regions, map, manifest, trades] = await Promise.allSettled([
    readJson('data/regions.json').then(data => { validateRegions(data); return data; }),
    readJson('data/district-map.json'),
    readJson('data/richgo-quotes.json').then(validateQuoteManifest),
    readJson('data/transactions.json').then(validateManifest),
  ]);
  if (map.status === 'fulfilled') state.areas = map.value.bounds ?? {};
  if (manifest.status === 'fulfilled') state.manifest = manifest.value;
  if (trades.status === 'fulfilled') state.tradeManifest = trades.value;
  if (regions.status === 'rejected') {
    state.regionsFailed = true;
    state.catalogFailed = true;
    state.catalogLoading = false;
    state.busy = false;
    districtSelect.replaceChildren(new Option('지역을 확인하지 못했습니다', ''));
    $('map-placeholder').textContent = '지역 지도를 확인하지 못했습니다.';
    render();
    return;
  }
  state.cities = regions.value;
  districtSelect.replaceChildren(new Option('서울 전체', ''));
  for (const city of state.cities) {
    const group = document.createElement('optgroup');
    group.label = city.name;
    group.append(...city.districts.map(district => new Option(district.name, district.code)));
    districtSelect.append(group);
    for (const district of city.districts) districtNames.set(district.code, district.name);
  }
  try {
    const catalog = await readJson(complexCatalogPath(state.manifest?.catalogHash));
    if (state.tradeManifest && catalog.tradeRevision !== state.tradeManifest.revision) throw new Error('단지 목록 갱신이 필요합니다.');
    state.complexes = validateComplexCatalog(catalog, new Set(districtNames.keys()));
  } catch {
    state.catalogFailed = true;
  }
  state.catalogLoading = false;
  const params = new URLSearchParams(location.search);
  if (state.cities.some(city => city.districts.some(district => district.code === params.get('gu')))) {
    districtSelect.value = params.get('gu');
  }
  if (['59', '74', '84'].includes(params.get('area'))) areaSelect.value = params.get('area');
  searchInput.value = (params.get('q') ?? '').slice(0, 120);
  state.selected = state.complexes.find(apartment => apartment.key === params.get('apt')) ?? null;
  districtSelect.disabled = false;
  areaSelect.disabled = false;
  searchInput.disabled = state.catalogFailed;
  loadDistrict();
}

$('quote-filters').addEventListener('submit', event => {
  event.preventDefault();
  if (composing || state.catalogLoading || state.catalogFailed) return;
  const matches = matchingComplexes();
  if (matches.length === 1) selectComplex(matches[0]);
});
searchInput.addEventListener('compositionstart', () => { composing = true; });
searchInput.addEventListener('compositionend', () => { composing = false; });
searchInput.addEventListener('input', () => {
  if (state.selected) {
    request?.abort();
    state.selected = null;
    state.trades = [];
    state.rows = [];
    state.busy = false;
  }
  state.resultLimit = 6;
  syncUrl();
  render();
});
districtSelect.addEventListener('change', () => {
  state.selected = null;
  state.resultLimit = 6;
  loadDistrict();
});
areaSelect.addEventListener('change', () => { state.resultLimit = 6; syncUrl(); render(); });
$('complex-back').addEventListener('click', () => { state.selected = null; loadDistrict(); });
$('complex-more').addEventListener('click', () => { state.resultLimit += 6; renderSearch(); });
$('complex-trades-more').addEventListener('click', () => { state.tradeLimit += 6; renderDetail(); });
$('complex-retry').addEventListener('click', () => location.reload());
$('quote-reset').addEventListener('click', () => {
  if (state.regionsFailed) return;
  districtSelect.value = '';
  areaSelect.value = 'all';
  searchInput.value = '';
  state.selected = null;
  state.resultLimit = 6;
  loadDistrict();
});
initialize();
