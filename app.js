import { districtDataPath, filterRecords, middlePrice, moneyWon, MOLIT_SOURCE_URL, parsePriceLimit,
  seoulDateTime, seoulDay, STALE_AFTER_MS, tradesCsv, validateDistrict, validateManifest, validateRegions } from './market-data.js';
import { complexCatalogPath, complexKey, searchComplexes, validateComplexCatalog } from './complex-data.js';
import { createQuoteMap, kakaoMapLink } from './quote-map.js';

const $ = id => document.getElementById(id);
const controls = Object.fromEntries(['district', 'search', 'area', 'budget', 'month', 'kind'].map(id => [id, $(id)]));
const params = new URLSearchParams(location.search);
const state = { manifest: null, config: null, bounds: {}, catalog: [], districts: [], selected: null,
  trades: [], cache: new Map(), loading: true, failed: false, page: 1, limit: 8,
  view: ['complexes', 'map', 'listings'].includes(params.get('view')) ? 'complexes' : 'trades' };
const districtNames = new Map();
const catalogByKey = new Map();
const pageSize = 30;
const numbers = new Intl.NumberFormat('ko-KR');
let request;
let composing = false;
let visibleTrades = [];
const showMap = createQuoteMap({ raster: $('map-raster'), canvas: $('map-kakao'), placeholder: $('map-placeholder'), hint: $('map-hint') });

function node(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function readJson(path, signal) {
  const response = await fetch('./' + path, {
    cache: /^data\/(trades|complexes)\//.test(path) ? 'default' : 'no-cache',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('자료를 불러오지 못했습니다.');
  return response.json();
}

function syncUrl() {
  const url = new URL(location.href);
  for (const [key, value] of [['gu', controls.district.value], ['q', controls.search.value.trim()],
    ['area', controls.area.value === 'all' ? '' : controls.area.value], ['month', controls.month.value],
    ['budget', controls.budget.value], ['kind', controls.kind.value], ['apt', state.selected?.key],
    ['view', state.view === 'complexes' ? 'complexes' : '']]) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  url.searchParams.delete('city');
  history.replaceState(null, '', url);
}

const monthLabel = value => value.slice(0, 4) + '년 ' + Number(value.slice(4)) + '월';
function periodLabel() {
  const months = state.manifest?.months ?? [];
  return controls.month.value ? monthLabel(controls.month.value) : months.length ? monthLabel(months[0]) + ' ~ ' + monthLabel(months.at(-1)) : '수집기간 확인 중';
}

function matchingCatalog() {
  return searchComplexes(state.catalog, { district: controls.district.value, query: controls.search.value, area: controls.area.value }, districtNames);
}

function filteredTrades(matches, selected = true) {
  const keys = new Set(matches.map(row => row.key));
  const records = filterRecords(state.trades, { area: controls.area.value, search: '',
    maxWon: parsePriceLimit(controls.budget.value), month: controls.month.value.replace(/^(\d{4})(\d{2})$/, '$1-$2'), kind: controls.kind.value });
  return records.filter(row => keys.has(complexKey(row.districtCode, row.dong, row.aptName))
    && (!selected || !state.selected || complexKey(row.districtCode, row.dong, row.aptName) === state.selected.key));
}

function renderProfile() {
  const apartment = state.selected;
  $('selected-complex').hidden = !apartment;
  if (!apartment) return;
  const profile = apartment.profile;
  $('complex-name').textContent = apartment.aptName;
  $('complex-address').textContent = profile?.roadAddress || [districtNames.get(apartment.districtCode), apartment.dong].join(' · ');
  const parkingRatio = profile?.parkingSpaces && profile?.households ? (profile.parkingSpaces / profile.households).toFixed(2) + '대' : '미확인';
  const fields = [
    ['세대수', profile?.households ? numbers.format(profile.households) + '세대' : '미확인'],
    ['동수', profile?.buildings ? numbers.format(profile.buildings) + '개 동' : '미확인'],
    ['사용승인일', profile?.approvalDate || '미확인'],
    ['주차대수', profile?.parkingSpaces ? numbers.format(profile.parkingSpaces) + '대' : '미확인'],
    ['세대당 주차', parkingRatio], ['난방방식', profile?.heating || '미확인'],
    ['복도유형', profile?.corridor || '미확인'], ['분양형태', profile?.supplyType || '미확인'],
  ];
  const fragment = document.createDocumentFragment();
  for (const [label, value] of fields) {
    const cell = node('div', '');
    cell.append(node('dt', label), node('dd', value, value === '미확인' ? 'unconfirmed' : ''));
    fragment.append(cell);
  }
  $('profile-grid').replaceChildren(fragment);
  $('profile-evidence').hidden = !profile;
  $('profile-note').textContent = profile
    ? [profile.constructor && '시공사 ' + profile.constructor, profile.management && '관리 ' + profile.management,
      profile.sourceUpdatedOn && '원자료 수정일 ' + profile.sourceUpdatedOn].filter(Boolean).join(' · ')
    : '이 단지와 일치하는 공식 기본 정보를 확인하지 못했습니다. 미확인 항목은 추정하지 않습니다.';
  $('profile-checked-at').textContent = state.config?.profileCheckedAt ? seoulDay(state.config.profileCheckedAt) + ' 확인' : '';
}

function renderStatus() {
  const manifest = state.manifest;
  const stale = manifest?.updatedAt && Date.now() - Date.parse(manifest.updatedAt) > STALE_AFTER_MS;
  const label = state.failed ? '자료 불러오기 실패' : manifest?.state === 'failed' ? '최근 수집 실패'
    : stale ? '실거래 갱신 지연' : manifest?.updatedAt ? '공식 실거래 제공 중' : '공식 실거래 수집 대기';
  $('data-status').dataset.tone = state.failed || stale || manifest?.state === 'failed' ? 'error' : manifest?.updatedAt ? 'ok' : 'pending';
  $('data-status').querySelector('strong').textContent = manifest ? label : '데이터 확인 중';
  $('data-timestamp').textContent = manifest?.updatedAt ? '마지막 성공 ' + seoulDateTime(manifest.updatedAt) : '마지막 성공 수집 기록 확인 중';
  $('freshness-note').hidden = !manifest?.updatedAt || (!stale && manifest.state !== 'failed');
  $('freshness-note').textContent = manifest?.updatedAt ? '최근 실거래 갱신이 지연되어 ' + seoulDateTime(manifest.updatedAt) + ' 수집 자료를 표시합니다.' : '';
}

function selectComplex(apartment, { tradeView = true, focus = true } = {}) {
  state.selected = apartment;
  controls.district.value = apartment.districtCode;
  controls.search.value = '';
  state.page = 1;
  if (tradeView) state.view = 'trades';
  syncUrl();
  loadTrades().then(() => { if (focus && state.selected?.key === apartment.key) $('complex-name').focus({ preventScroll: false }); });
}

function renderRows(rows) {
  const fragment = document.createDocumentFragment();
  for (const record of rows) {
    const row = document.createElement('tr');
    row.setAttribute('role', 'row');
    const apartment = catalogByKey.get(complexKey(record.districtCode, record.dong, record.aptName));
    const label = node('span', '');
    const button = node('button', record.aptName, 'complex-name-button');
    button.type = 'button';
    button.setAttribute('aria-label', record.aptName + ' 단지 정보 보기');
    button.addEventListener('click', () => apartment && selectComplex(apartment));
    label.append(button, node('span', [districtNames.get(record.districtCode), record.dong, record.building].filter(Boolean).join(' · '), 'subline'));
    const date = node('time', record.dealDate); date.dateTime = record.dealDate;
    const source = node('span', '', 'evidence');
    const link = node('a', '국토교통부'); link.href = MOLIT_SOURCE_URL; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const checked = node('time', seoulDay(record.checkedAt) + ' 확인'); checked.dateTime = record.checkedAt; checked.title = seoulDateTime(record.checkedAt);
    source.append(link, checked);
    for (const [name, value, cls] of [
      ['아파트', label, ''], ['전용면적 · 층', record.areaM2 + '㎡ · ' + (record.floor === null ? '층 미확인' : record.floor + '층'), 'area-cell'],
      ['계약일', date, 'date-cell'], ['거래 유형', node('span', record.transactionType, record.transactionType === '직거래' ? 'tag direct' : 'tag'), ''],
      ['실거래가', node('span', moneyWon(record.priceWon), 'money'), 'price-cell'], ['출처 · 확인일', source, 'source-cell'],
    ]) {
      const td = row.insertCell(); td.setAttribute('role', 'cell'); td.dataset.label = name; if (cls) td.className = cls; td.append(value);
    }
    fragment.append(row);
  }
  $('table-body').replaceChildren(fragment);
}

function renderComplexes(matches, records, invalidBudget) {
  const stats = new Map();
  for (const row of records) {
    const key = complexKey(row.districtCode, row.dong, row.aptName);
    if (!stats.has(key)) stats.set(key, { count: 0, latest: row.dealDate });
    stats.get(key).count++;
  }
  const requiresTrade = Boolean(controls.budget.value || controls.month.value || controls.kind.value);
  const apartments = invalidBudget ? [] : matches.filter(row => !requiresTrade || stats.has(row.key))
    .sort((a, b) => (stats.get(b.key)?.count ?? 0) - (stats.get(a.key)?.count ?? 0) || a.aptName.localeCompare(b.aptName, 'ko'));
  $('complex-results-count').textContent = state.loading ? '조건에 맞는 단지를 확인하고 있습니다.' : state.failed ? '자료를 불러오지 못했습니다.'
    : (districtNames.get(controls.district.value) || '서울 전체') + ' · ' + numbers.format(apartments.length) + '개 단지';
  $('complex-results').setAttribute('aria-busy', String(state.loading));
  $('complex-results-empty').hidden = state.loading || apartments.length > 0;
  $('complex-results-empty').textContent = invalidBudget ? '실거래 가격 상한을 확인해 주세요.' : state.failed ? '실거래 내역 탭에서 다시 불러오기를 눌러 주세요.' : '조건에 맞는 단지가 없습니다. 검색어나 면적·거래 조건을 조정해 보세요.';
  $('complex-more').hidden = apartments.length <= state.limit || state.loading;
  const fragment = document.createDocumentFragment();
  for (const apartment of apartments.slice(0, state.limit)) {
    const stat = stats.get(apartment.key);
    const profile = apartment.profile;
    const button = node('button', '', 'complex-result'); button.type = 'button';
    button.dataset.selected = String(apartment.key === state.selected?.key);
    const label = node('span', '', 'complex-result-name');
    label.append(node('strong', apartment.aptName), node('span', [districtNames.get(apartment.districtCode), apartment.dong].join(' · '), 'complex-location'));
    const info = node('span', '', 'complex-result-info');
    info.append(node('span', [profile?.households ? numbers.format(profile.households) + '세대' : '세대수 미확인',
      profile?.approvalDate ? profile.approvalDate.slice(0, 4) + '년 사용승인' : ''].filter(Boolean).join(' · ')),
      node('small', stat ? '조건 내 실거래 ' + numbers.format(stat.count) + '건 · 최근 ' + stat.latest : '조건 내 신고 거래 없음'));
    button.append(label, info); button.addEventListener('click', () => selectComplex(apartment)); fragment.append(button);
  }
  $('complex-results').replaceChildren(fragment);
  $('complex-catalog-note').textContent = '서울시 등록 단지와 ' + periodLabel() + ' 매매 신고 기준. 단지를 누르면 기본 정보와 실거래가 함께 표시됩니다.';
}

function renderMap() {
  if (state.view !== 'complexes' || !state.config) return;
  const apartment = state.selected;
  const code = apartment?.districtCode || controls.district.value;
  const districtName = districtNames.get(code) || '';
  const regionName = ['서울특별시', districtName].filter(Boolean).join(' ');
  const query = apartment?.profile?.roadAddress || [regionName, apartment?.dong, apartment?.aptName].filter(Boolean).join(' ');
  $('map-selection').textContent = apartment ? apartment.aptName : regionName;
  $('map-kakao-link').href = kakaoMapLink(query);
  void showMap({ bounds: state.bounds[code || '11'], regionName, query, districtName, complex: apartment,
    kakaoJavaScriptKey: state.config.kakaoJavaScriptKey || '' });
}

function render() {
  renderProfile(); renderStatus();
  for (const name of ['trades', 'complexes']) {
    const selected = state.view === name;
    $('tab-' + name).setAttribute('aria-selected', String(selected)); $('tab-' + name).tabIndex = selected ? 0 : -1;
    $(name + '-panel').hidden = !selected;
  }
  const invalidBudget = controls.budget.validity.badInput || Number.isNaN(parsePriceLimit(controls.budget.value));
  controls.budget.setAttribute('aria-invalid', String(invalidBudget)); $('budget-error').hidden = !invalidBudget;
  $('advanced-summary').textContent = [controls.month.value && monthLabel(controls.month.value), controls.kind.value].filter(Boolean).join(' · ');
  const matches = matchingCatalog();
  const allRecords = invalidBudget ? [] : filteredTrades(matches, false);
  const records = state.selected ? allRecords.filter(row => complexKey(row.districtCode, row.dong, row.aptName) === state.selected.key) : allRecords;
  visibleTrades = records;
  $('metrics').hidden = state.loading || state.failed || invalidBudget;
  $('count').textContent = numbers.format(records.length) + '건'; $('median').textContent = moneyWon(middlePrice(records, 'priceWon')); $('last-contract').textContent = records[0]?.dealDate || '—';
  $('trades-panel').setAttribute('aria-busy', String(state.loading));
  $('results-title').textContent = state.selected ? state.selected.aptName + ' 실거래' : '실거래 내역';
  $('results-subtitle').textContent = [(districtNames.get(controls.district.value) || '서울 전체'), periodLabel(), state.loading ? '불러오는 중' : numbers.format(records.length) + '건'].join(' · ');
  $('table-wrap').hidden = state.loading || state.failed || invalidBudget || !records.length;
  $('empty').hidden = !$('table-wrap').hidden;
  $('retry').hidden = !state.failed;
  $('empty-title').textContent = state.loading ? '자료를 확인하고 있습니다' : state.failed ? '자료를 불러오지 못했습니다' : invalidBudget ? '가격 상한을 확인해 주세요' : '조건에 맞는 신고 거래가 없습니다';
  $('empty-message').textContent = state.loading ? '잠시 기다려 주세요.' : state.failed ? '연결 상태를 확인한 뒤 다시 불러와 주세요.' : '전용면적이나 계약월 등 검색 조건을 조정해 보세요. 단지 기본 정보는 거래 유무와 관계없이 확인할 수 있습니다.';
  $('csv').hidden = $('table-wrap').hidden;
  const pages = Math.max(1, Math.ceil(records.length / pageSize)); state.page = Math.min(state.page, pages);
  $('pagination').hidden = $('table-wrap').hidden || pages <= 1;
  $('prev').disabled = state.page <= 1; $('next').disabled = state.page >= pages; $('page-label').textContent = state.page + ' / ' + pages + ' 페이지';
  if (!$('table-wrap').hidden) renderRows(records.slice((state.page - 1) * pageSize, state.page * pageSize));
  renderComplexes(state.selected ? matches.filter(row => row.key === state.selected.key) : matches, records, invalidBudget);
  renderMap();
}

async function loadTrades() {
  request?.abort(); request = new AbortController(); const { signal } = request;
  state.loading = true; state.failed = false; state.trades = []; render();
  try {
    const codes = controls.district.value ? [controls.district.value] : state.districts.map(row => row.code);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(6, codes.length) }, async () => {
      while (cursor < codes.length && !signal.aborted) {
        const code = codes[cursor++];
        if (state.cache.has(code) || !state.manifest.districts[code]) continue;
        const raw = await readJson(districtDataPath(state.manifest, code), signal);
        const rows = validateDistrict(raw, state.manifest, code).map(row => ({ ...row, districtCode: code }));
        if (!signal.aborted) state.cache.set(code, rows);
      }
    }));
    if (signal.aborted) return;
    state.trades = codes.flatMap(code => state.cache.get(code) || []).sort((a, b) => b.dealDate.localeCompare(a.dealDate) || a.aptName.localeCompare(b.aptName, 'ko'));
    state.loading = false; render();
  } catch {
    if (signal.aborted) return;
    state.loading = false; state.failed = true; render();
  }
}

async function bootstrap() {
  state.loading = true; state.failed = false; render();
  try {
    const [cities, manifest, config, map] = await Promise.all([
      readJson('data/regions.json'), readJson('data/transactions.json'), readJson('data/app-config.json'), readJson('data/district-map.json'),
    ]);
    state.districts = validateRegions(cities); state.manifest = validateManifest(manifest); state.config = config; state.bounds = map.bounds;
    const catalog = await readJson(complexCatalogPath(config.catalogHash));
    if (catalog.tradeRevision !== manifest.revision) throw new Error('단지 목록과 실거래 버전이 일치하지 않습니다.');
    state.catalog = validateComplexCatalog(catalog, new Set(state.districts.map(row => row.code)));
    state.cache.clear(); catalogByKey.clear(); districtNames.clear();
    for (const row of state.catalog) catalogByKey.set(row.key, row);
    controls.district.replaceChildren(new Option('서울 전체', ''), ...state.districts.map(row => new Option(row.name, row.code)));
    controls.district.disabled = false;
    for (const row of state.districts) districtNames.set(row.code, row.name);
    const current = new URLSearchParams(location.search);
    if (districtNames.has(current.get('gu'))) controls.district.value = current.get('gu');
    if (['59', '74', '84'].includes(current.get('area'))) controls.area.value = current.get('area');
    controls.search.value = (current.get('q') || '').slice(0, 120);
    controls.budget.value = current.get('budget') || '';
    if (['중개거래', '직거래', '구분 미확인'].includes(current.get('kind'))) controls.kind.value = current.get('kind');
    controls.month.replaceChildren(new Option('전체 수집기간', ''), ...[...manifest.months].reverse().map(month => new Option(monthLabel(month), month)));
    if (manifest.months.includes(current.get('month'))) controls.month.value = current.get('month');
    $('advanced-filters').open = Boolean(controls.month.value || controls.kind.value);
    state.selected = catalogByKey.get(current.get('apt')) || null;
    if (state.selected) controls.district.value = state.selected.districtCode;
    syncUrl(); await loadTrades();
  } catch { state.loading = false; state.failed = true; render(); }
}

$('filters').addEventListener('submit', event => event.preventDefault());
controls.district.addEventListener('change', () => { state.selected = null; state.page = 1; state.limit = 8; syncUrl(); loadTrades(); });
for (const name of ['area', 'search', 'budget', 'month', 'kind']) controls[name].addEventListener(['search', 'budget'].includes(name) ? 'input' : 'change', () => {
  if (composing) return;
  if (name === 'search') state.selected = null;
  state.page = 1; state.limit = 8; syncUrl(); render();
});
controls.search.addEventListener('compositionstart', () => { composing = true; });
controls.search.addEventListener('compositionend', () => { composing = false; state.selected = null; state.page = 1; state.limit = 8; syncUrl(); render(); });
$('reset').addEventListener('click', () => {
  for (const name of ['search', 'budget', 'month', 'kind']) controls[name].value = '';
  controls.area.value = 'all'; state.selected = null; state.page = 1; state.limit = 8; $('advanced-filters').open = false; syncUrl(); render();
});
$('clear-complex').addEventListener('click', () => { state.selected = null; state.page = 1; syncUrl(); render(); controls.search.focus(); });
const tabs = [$('tab-trades'), $('tab-complexes')];
for (const [index, button] of tabs.entries()) {
  button.addEventListener('click', () => { state.view = index ? 'complexes' : 'trades'; syncUrl(); render(); });
  button.addEventListener('keydown', event => {
    const target = { ArrowLeft: tabs[1 - index], ArrowRight: tabs[1 - index], Home: tabs[0], End: tabs[1] }[event.key];
    if (target) { event.preventDefault(); target.focus(); target.click(); }
  });
}
$('complex-more').addEventListener('click', () => { state.limit += 12; render(); });
for (const [id, step] of [['prev', -1], ['next', 1]]) $(id).addEventListener('click', () => { state.page += step; render(); $('results-title').scrollIntoView({ block: 'start' }); });
$('retry').addEventListener('click', () => bootstrap());
$('csv').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([tradesCsv(visibleTrades, row => districtNames.get(row.districtCode) || '미확인')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'sisena-' + (controls.district.value || 'seoul') + '-' + (controls.month.value || 'all') + '.csv';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

void bootstrap();
