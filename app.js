import {
  activeListings, districtDataPath, filterRecords, listingDataPath, middlePrice, MOLIT_RECORDS_URL, MOLIT_SOURCE_URL,
  moneyWon, parsePriceLimit, seoulDateTime, seoulDay, STALE_AFTER_MS, tradesCsv,
  validateDistrict, validateListings, validateManifest, validateRegions,
} from './market-data.js';

const $ = id => document.getElementById(id);
const controls = Object.fromEntries(['city', 'district', 'area', 'search', 'budget', 'month', 'kind'].map(id => [id, $(id)]));
const tabs = [$('tab-trades'), $('tab-listings')];
const pageSize = 30;
const numbers = new Intl.NumberFormat('ko-KR');
const state = { tab: 'trades', page: 1, regions: [], manifest: null, trades: null, listings: null, listingFeedState: null, error: false };
let request;
let visibleTrades = [];

async function getJson(path, signal) {
  const response = await fetch(`./${path}`, {
    cache: /^data\/(trades|listings)\//.test(path) ? 'default' : 'no-cache',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error('자료를 불러오지 못했습니다.');
  return response.json();
}

function setOptions(control, options, selection = '') {
  control.replaceChildren(...options.map(({ code, name }) => new Option(name, code)));
  if (options.some(option => option.code === selection)) control.value = selection;
}

function setDistricts(selection) {
  const city = state.regions.find(region => region.code === controls.city.value);
  setOptions(controls.district, [{ code: '', name: '시·군·구 선택' }, ...city.districts], selection);
  controls.district.disabled = false;
  const suffix = city.code === '11' ? '개 자치구' : '개 시·군·구';
  $('hero-region').textContent = `${city.name} · ${city.districts.length}${suffix}`;
}

function updateUrl() {
  const url = new URL(location.href);
  for (const [key, value] of [['city', controls.city.value], ['gu', controls.district.value], ['area', controls.area.value === 'all' ? '' : controls.area.value], ['month', controls.month.value], ['view', state.tab === 'listings' ? 'listings' : '']]) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, '', url);
}

function monthLabel(month) {
  return `${month.slice(0, 4)}년 ${Number(month.slice(4))}월`;
}

function updateMonths() {
  const months = state.manifest?.months ?? [];
  const selection = controls.month.value || new URLSearchParams(location.search).get('month');
  setOptions(controls.month, [{ code: '', name: '전체 기간' }, ...[...months].reverse().map(code => ({ code, name: monthLabel(code) }))], selection);
  controls.month.disabled = !months.length;
}

function setStatus() {
  const manifest = state.manifest;
  const timestamp = manifest?.updatedAt;
  const stale = timestamp && Date.now() - Date.parse(timestamp) > STALE_AFTER_MS;
  let label = '데이터 확인 중';
  let tone = 'pending';
  if (state.error || manifest?.state === 'failed') {
    label = state.error ? '자료 불러오기 실패' : '최근 수집 실패';
    tone = 'error';
  } else if (stale) {
    label = '데이터 갱신 지연';
    tone = 'error';
  } else if (timestamp) {
    label = '공식 실거래 제공 중';
    tone = 'ok';
  } else if (manifest) {
    label = '공식 실거래 수집 대기';
  }
  $('data-status').dataset.tone = tone;
  $('data-status').querySelector('strong').textContent = label;
  $('data-timestamp').textContent = timestamp ? `마지막 성공 ${seoulDateTime(timestamp)}` : '마지막 성공 수집 기록 없음';
}

function setEmpty(title, message, retry = false) {
  $('empty').hidden = false;
  $('empty-title').textContent = title;
  $('empty-message').textContent = message;
  $('retry').hidden = !retry;
}

function appendCell(row, label, value, className) {
  const cell = row.insertCell();
  cell.setAttribute('role', 'cell');
  if (label) cell.dataset.label = label;
  if (className) cell.className = className;
  cell.append(value);
  return cell;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function evidence(link, source, instant) {
  const container = node('span', '', 'evidence');
  const anchor = node('a', source);
  anchor.href = link;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  const date = node('time', `${seoulDay(instant)} 확인`);
  date.dateTime = instant;
  date.title = seoulDateTime(instant);
  container.append(anchor, date);
  return container;
}

function renderRows(rows, isTrade) {
  const priceLabel = isTrade ? '실거래가' : '매물 호가';
  const labels = ['아파트', '전용면적', '층', ...(isTrade ? ['계약일', '거래 유형'] : []), priceLabel, '출처 · 확인일'];
  const heading = document.createElement('tr');
  heading.setAttribute('role', 'row');
  for (const label of labels) {
    const cell = node('th', label);
    cell.scope = 'col';
    cell.setAttribute('role', 'columnheader');
    heading.append(cell);
  }
  $('table-head').replaceChildren(heading);
  const body = document.createDocumentFragment();
  for (const record of rows) {
    const row = document.createElement('tr');
    row.setAttribute('role', 'row');
    const name = appendCell(row, '', node('span', record.aptName, 'name'));
    const location = [record.dong, record.building].filter(Boolean).join(' · ');
    if (location) name.append(node('span', location, 'subline'));
    appendCell(row, '전용면적', `${record.areaM2}㎡`, 'area-cell');
    const floor = Number.isInteger(record.floor) ? `${record.floor}층` : (record.floor || '—');
    appendCell(row, '층', floor, 'floor-cell');
    if (isTrade) {
      const contract = node('time', record.dealDate);
      contract.dateTime = record.dealDate;
      appendCell(row, '계약일', contract, 'date-cell');
      appendCell(row, '거래 유형', node('span', record.transactionType, record.transactionType === '직거래' ? 'tag direct' : 'tag'));
    }
    appendCell(row, priceLabel, node('span', moneyWon(isTrade ? record.priceWon : record.askWon), 'money'), 'price-cell');
    appendCell(row, '', isTrade
      ? evidence(MOLIT_SOURCE_URL, '국토교통부 매매 상세 API', record.checkedAt)
      : evidence(record.sourceUrl, record.source, record.verifiedAt), 'source-cell');
    body.append(row);
  }
  $('table-body').replaceChildren(body);
  $('table-caption').textContent = isTrade ? '아파트 매매 실거래 내역' : '아파트 매물 호가 내역';
}

function render() {
  const isTrade = state.tab === 'trades';
  const district = controls.district.value;
  const districtName = district ? controls.district.selectedOptions[0]?.textContent : '';
  const manifest = state.manifest;
  const data = isTrade ? state.trades : state.listings;
  const results = $('results-title').closest('.results');
  const maxWon = controls.budget.validity.badInput ? NaN : parsePriceLimit(controls.budget.value);
  const invalidBudget = Number.isNaN(maxWon);
  controls.budget.setAttribute('aria-invalid', String(invalidBudget));
  $('budget-error').hidden = !invalidBudget;
  $('month-label').hidden = !isTrade;
  $('kind-label').hidden = !isTrade;
  $('source-link').hidden = !isTrade;
  $('listing-links').hidden = isTrade;
  if (!isTrade) {
    const richgoPath = controls.city.value === '11' ? ['서울', districtName].filter(Boolean).map(encodeURIComponent).join('/') : '';
    $('richgo-link').href = richgoPath ? `https://m.richgo.ai/realty/apt-hub/${richgoPath}` : 'https://m.richgo.ai/';
    $('richgo-label').textContent = richgoPath && districtName ? `리치고 ${districtName} 호가 보기` : '리치고에서 보기';
  }
  $('source-link').href = MOLIT_RECORDS_URL;
  $('results-title').textContent = isTrade ? '실거래 내역' : '매물 호가';
  $('results-subtitle').textContent = districtName || '지역별 아파트 조회';
  $('freshness-note').hidden = true;
  $('metrics').hidden = true;
  $('csv').hidden = true;
  $('pagination').hidden = true;
  $('table-wrap').hidden = true;
  $('empty').hidden = true;
  visibleTrades = [];
  results.setAttribute('aria-busy', String(data === null && !state.error));
  setStatus();

  if (state.error) {
    setEmpty('자료를 불러오지 못했습니다', '연결 상태를 확인한 뒤 다시 불러와 주세요.', true);
    return;
  }
  if (data === null) {
    setEmpty('자료를 확인하고 있습니다', '잠시 기다려 주세요.');
    return;
  }
  if (isTrade && !manifest.updatedAt) {
    if (manifest.state === 'failed') {
      setEmpty('첫 실거래 수집에 실패했습니다', `최근 시도 ${seoulDateTime(manifest.lastAttemptAt)}`);
    } else {
      setEmpty('공식 실거래 수집을 기다리고 있습니다', '첫 수집이 완료되면 신고 가격과 확인 날짜가 여기에 표시됩니다.');
    }
    return;
  }
  if (!isTrade && state.listingFeedState === 'failed') {
    setEmpty('최근 매물 수집에 실패했습니다', '위의 사이트에서 매물이나 단지별 호가를 확인할 수 있습니다.');
    return;
  }
  if (!isTrade && state.listingFeedState === 'unconfigured' && !data.length) {
    setEmpty('매물 데이터 제공처 연동 전입니다', '위의 사이트에서 매물이나 단지별 호가를 확인할 수 있습니다.');
    return;
  }
  if (!district) {
    setEmpty('시·군·구를 선택해 주세요', '선택한 지역의 가격을 조회할 수 있습니다.');
    return;
  }
  if (isTrade && !manifest.districts[district]) {
    setEmpty('선택한 지역의 수집을 기다리고 있습니다', '이 지역의 첫 수집이 끝나면 실거래 내역을 조회할 수 있습니다.');
    return;
  }
  if (isTrade) {
    if (manifest.state === 'failed') {
      $('freshness-note').hidden = false;
      $('freshness-note').textContent = `최근 수집 실패 · ${seoulDateTime(manifest.lastAttemptAt)} 시도. 마지막 성공 자료를 표시합니다.`;
    } else if (Date.now() - Date.parse(manifest.updatedAt) > STALE_AFTER_MS) {
      $('freshness-note').hidden = false;
      $('freshness-note').textContent = `마지막 성공 수집이 36시간 이상 지났습니다. ${seoulDateTime(manifest.updatedAt)}에 수집한 자료입니다.`;
    }
  }
  if (invalidBudget) {
    setEmpty('가격 상한을 확인해 주세요', '가격 제한 없이 조회하려면 가격 상한을 비워 주세요.');
    return;
  }
  const available = isTrade ? data : activeListings(data, district);
  const records = filterRecords(available, {
    area: controls.area.value, search: controls.search.value, maxWon,
    month: isTrade ? controls.month.value.replace(/^(\d{4})(\d{2})$/, '$1-$2') : '', kind: isTrade ? controls.kind.value : '',
  });
  const count = numbers.format(records.length);
  const subtitle = [districtName];
  if (isTrade) {
    const months = manifest.months;
    subtitle.push(controls.month.value ? monthLabel(controls.month.value) : `${monthLabel(months[0])} ~ ${monthLabel(months.at(-1))}`);
  }
  subtitle.push(isTrade ? `${count}건` : `게시 매물 ${count}건`);
  $('results-subtitle').textContent = subtitle.join(' · ');
  if (isTrade) {
    visibleTrades = records;
    $('metrics').hidden = false;
    $('count').textContent = `${count}건`;
    $('median').textContent = moneyWon(middlePrice(records, 'priceWon'));
    $('median-source').hidden = !records.length;
    $('median-source').replaceChildren(evidence(MOLIT_SOURCE_URL, '국토교통부 자료', manifest.updatedAt));
    $('last-contract').textContent = records[0]?.dealDate ?? '—';
  }
  if (!records.length) {
    if (!isTrade && !available.length) {
      setEmpty('이 지역에 게시 중인 매물이 없습니다', '다른 지역을 선택하거나 원본 사이트에서 확인해 보세요.');
    } else {
      setEmpty(isTrade ? '검색 조건에 맞는 신고 거래가 없습니다' : '검색 조건에 맞는 유효 매물이 없습니다', '전용면적이나 다른 검색 조건을 조정해 보세요.');
    }
    return;
  }
  $('csv').hidden = !isTrade;
  const pageCount = Math.ceil(records.length / pageSize);
  state.page = Math.min(state.page, pageCount);
  const first = (state.page - 1) * pageSize;
  renderRows(records.slice(first, first + pageSize), isTrade);
  $('table-wrap').hidden = false;
  $('pagination').hidden = pageCount === 1;
  $('prev').disabled = state.page === 1;
  $('next').disabled = state.page === pageCount;
  $('page-label').textContent = `${state.page} / ${pageCount} 페이지`;
}

function setTab(tab) {
  state.tab = tab;
  state.page = 1;
  const isTrade = tab === 'trades';
  $('page-title').textContent = isTrade ? '아파트 매매 실거래가' : '아파트 매물 호가';
  $('hero-copy').textContent = isTrade ? '단지와 전용면적으로 찾는 국토교통부 신고 가격' : '매물별 매도 희망 가격과 출처, 마지막 확인일';
  $('trade-status').hidden = !isTrade;
  document.title = `시세나침반 | ${$('page-title').textContent}`;
  for (const button of tabs) {
    const selected = button.id === `tab-${tab}`;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  $('results-panel').setAttribute('aria-labelledby', `tab-${tab}`);
}

async function load({ bootstrap = false } = {}) {
  request?.abort();
  request = new AbortController();
  const { signal } = request;
  state.error = false;
  state[state.tab] = null;
  render();
  try {
    if (bootstrap || !state.regions.length) {
      const regions = await getJson('data/regions.json', signal);
      validateRegions(regions);
      if (signal.aborted) return;
      const params = new URLSearchParams(location.search);
      const district = params.get('gu');
      const city = regions.find(region => region.districts.some(entry => entry.code === district))?.code ?? params.get('city');
      state.regions = regions;
      setOptions(controls.city, regions, city);
      controls.city.disabled = regions.length === 1;
      setDistricts(district);
      const area = params.get('area');
      if (['59', '74', '84'].includes(area)) controls.area.value = area;
    }
    if (state.tab === 'listings') {
      const data = await getJson('data/listings.json', signal);
      if (signal.aborted) return;
      const code = controls.district.value;
      const hash = data.districts?.[code];
      const snapshot = hash === undefined ? data : await getJson(listingDataPath(code, hash), signal);
      if (signal.aborted) return;
      state.listings = validateListings(snapshot);
      state.listingFeedState = data.feedState ?? (state.listings.length ? 'ok' : 'unconfigured');
    } else {
      const manifest = validateManifest(await getJson('data/transactions.json', signal));
      if (signal.aborted) return;
      state.manifest = manifest;
      updateMonths();
      const code = controls.district.value;
      if (manifest.districts[code]) {
        const data = await getJson(districtDataPath(manifest, code), signal);
        if (signal.aborted) return;
        state.trades = validateDistrict(data, manifest, code);
      } else {
        state.trades = [];
      }
    }
    if (!signal.aborted) render();
  } catch {
    if (signal.aborted) return;
    state.error = true;
    render();
  }
}

$('filters').addEventListener('submit', event => event.preventDefault());
controls.city.addEventListener('change', () => {
  setDistricts('');
  state.page = 1;
  updateUrl();
  load();
});
controls.district.addEventListener('change', () => {
  state.page = 1;
  updateUrl();
  load();
});
for (const key of ['area', 'search', 'budget', 'month', 'kind']) {
  controls[key].addEventListener(['search', 'budget'].includes(key) ? 'input' : 'change', () => {
    state.page = 1;
    if (key === 'area' || key === 'month') updateUrl();
    render();
  });
}
$('reset').addEventListener('click', () => {
  controls.area.value = 'all';
  for (const key of ['search', 'budget', 'month', 'kind']) controls[key].value = '';
  state.page = 1;
  updateUrl();
  render();
});
for (const [index, button] of tabs.entries()) {
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-selected') === 'true') return;
    setTab(button.id.replace('tab-', ''));
    updateUrl();
    load();
  });
  button.addEventListener('keydown', event => {
    const target = { ArrowLeft: tabs[1 - index], ArrowRight: tabs[1 - index], Home: tabs[0], End: tabs.at(-1) }[event.key];
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.click();
  });
}
$('retry').addEventListener('click', () => load());
for (const [id, step] of [['prev', -1], ['next', 1]]) {
  $(id).addEventListener('click', () => {
    state.page += step;
    render();
    $('results-title').scrollIntoView({ block: 'start' });
  });
}
$('csv').addEventListener('click', () => {
  const filename = `sisena-${controls.district.value}-${controls.month.value || 'all'}.csv`;
  const content = tradesCsv(visibleTrades, controls.district.selectedOptions[0]?.textContent);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const initialTab = new URLSearchParams(location.search).get('view') === 'listings' ? 'listings' : 'trades';
setTab(initialTab);
load({ bootstrap: true });
