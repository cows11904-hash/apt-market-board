// Preserve bookmarked searches while keeping one application and one set of filters.
const target = new URL('./', location.href);
const params = new URLSearchParams(location.search);
for (const key of ['gu', 'area', 'q', 'apt', 'month', 'budget', 'kind']) {
  if (params.has(key)) target.searchParams.set(key, params.get(key));
}
target.searchParams.set('view', 'complexes');
location.replace(target.href);
