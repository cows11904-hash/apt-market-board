import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pageSecurityPolicy } from './page-security.mjs';

const directives = policy => new Map(policy.split('; ').map(part => {
  const [name, ...values] = part.split(' ');
  return [name, values];
}));

test('통합 화면과 이전 주소의 CSP가 자원 로드 전에 적용된다', async () => {
  for (const [name, map] of [['index.html', true], ['quotes.html', false]]) {
    const html = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    assert.ok(match);
    assert.ok(match.index < html.indexOf('<script'));
    if (html.includes('<link')) assert.ok(match.index < html.indexOf('<link'));
    assert.equal(match[1], pageSecurityPolicy({ map }));
    const policy = directives(match[1]);
    assert.deepEqual(policy.get('script-src'), ["'self'"]);
    assert.deepEqual(policy.get('script-src-attr'), ["'none'"]);
    for (const directive of ['base-uri', 'object-src', 'frame-src', 'form-action']) {
      assert.deepEqual(policy.get(directive), ["'none'"]);
    }
    assert.equal(policy.has('frame-ancestors'), false);
  }
});

test('지도 CSP는 타일 이미지를 허용하고 카카오 SDK는 설정된 지도 페이지에서만 허용한다', () => {
  const basic = directives(pageSecurityPolicy({ map: true }));
  assert.ok(basic.get('img-src').includes('https://tile.openstreetmap.org'));
  assert.deepEqual(basic.get('connect-src'), ["'self'"]);
  const kakao = directives(pageSecurityPolicy({ map: true, kakao: true }));
  assert.ok(kakao.get('script-src').includes('https://dapi.kakao.com'));
  assert.ok(kakao.get('script-src').includes('https://*.kakaocdn.net'));
  assert.ok(!kakao.get('script-src').some(source => source.includes('unsafe')));
  assert.equal(pageSecurityPolicy({ kakao: true }), pageSecurityPolicy());
});
