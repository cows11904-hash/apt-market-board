export function pageSecurityPolicy({ map = false, kakao = false } = {}) {
  const kakaoScripts = map && kakao
    ? ' https://dapi.kakao.com https://*.kakaocdn.net https://*.daumcdn.net'
    : '';
  const kakaoRequests = map && kakao
    ? ' https://*.kakao.com https://*.kakaocdn.net https://*.daumcdn.net'
    : '';
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "script-src 'self'" + kakaoScripts,
    "script-src-attr 'none'",
    map ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data:" + (map ? ' https://tile.openstreetmap.org' : '') + kakaoRequests,
    "connect-src 'self'" + kakaoRequests,
    "font-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
