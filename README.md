# 시세나침반

서울 25개 자치구의 아파트 매매 실거래가를 조회하는 공개 웹사이트입니다. 지역, 계약월, 전용면적, 단지명, 가격 상한, 거래 유형으로 검색합니다. 거래별 가격에는 국토교통부 출처와 확인일이 표시됩니다. 매물 호가 · 지도에서는 지역과 단지를 선택하고 리치고 원문과 주변 지도를 열 수 있습니다.

## 실행

Node.js 22 이상이 필요합니다. 브라우저에서는 최신 Chrome, Edge, Firefox, Safari를 사용합니다.

```bash
npm ci --ignore-scripts
npm test
npm run build
python -m http.server 8000 --directory dist
```

`http://localhost:8000/`에서 확인합니다. 시·군·구는 `?gu=11110`, 전용면적은 `&area=84`, 계약월은 `&month=202610` 형식으로 공유할 수 있습니다. 단지명과 가격 상한은 해당 브라우저 화면에서 적용됩니다.

## GitHub Pages 배포

1. 공개 저장소의 기본 브랜치를 `main`으로 만들고 프로젝트 파일을 올립니다. `.github/workflows/update-trades.yml`과 `.nojekyll`을 포함합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
3. [공공데이터포털에서 아파트 매매 실거래가 상세 자료](https://www.data.go.kr/data/15126468/openapi.do)의 활용을 신청합니다.
4. 저장소 **Settings → Secrets and variables → Actions → New repository secret**에서 이름은 `MOLIT_SERVICE_KEY`, 값은 발급된 일반 인증키로 저장합니다. 인코딩된 키도 지원합니다.
5. **Actions → Publish 시세나침반 → Run workflow**에서 `main`을 실행합니다. **Test and collect official trades**와 **Deploy to GitHub Pages** 결과를 확인합니다. 배포 화면에 표시된 URL을 로그인하지 않은 브라우저에서 엽니다.

인증키를 넣기 전에는 실거래 수집 대기 화면을 게시할 수 있습니다. 인증키는 소스코드와 공개 파일에 포함하지 않습니다. 로컬에서 실제 수집을 확인할 때는 `.env.example`을 `.env`로 복사해 값을 입력한 뒤 `node --env-file=.env scripts/fetch-transactions.mjs`를 실행합니다.

### 운영

- GitHub Actions는 매일 06:17 KST에 현재 월과 직전 3개월을 다시 조회합니다. `main` 변경과 수동 실행 때도 같은 과정을 수행합니다. 예약 실행에는 지연이 생길 수 있습니다.
- `data/transactions.json`에는 마지막 성공 시각, 최근 시도, 월별 검산 건수, 지역별 데이터 파일 버전이 들어갑니다. 각 지역 데이터에는 계약일과 공식 응답을 받은 시각이 별도로 기록됩니다.
- 응답 오류, 페이지 누락, 예상 밖 지역·계약월, 전체 0건은 새 가격 공개를 중단합니다. 직전 수집이 30건 이상인 구·계약월의 원자료 건수가 절반 미만으로 내려가도 새 자료 게시를 보류합니다. 해당 월의 원자료를 검토한 뒤 다시 수집합니다.
- 수집 실패 시 직전 성공 가격과 확인일을 유지하고 실패 시도를 화면에 표시합니다. 마지막 성공으로부터 36시간이 지나면 갱신 지연을 표시합니다. 최신 자료의 검증이 실패하면 기존 Pages 배포가 유지됩니다.
- 매물 호가 · 지도 화면은 GitHub Pages의 자치구별 집계 파일을 조회합니다. [리치고 데이터 제휴](https://m.richgo.ai/en/partners)에서 웹 화면과 공개 JSON 게시 권한이 확인되면 아래 설정으로 자동 수집을 연결합니다.

### 리치고 호가 피드

1. 저장소 **Settings → Secrets and variables → Actions → Secrets**에 `RICHGO_QUOTES_FEED_URL`과 필요한 경우 `RICHGO_QUOTES_FEED_TOKEN`을 저장합니다. 공개용 피드가 전달될 때 인증 방식과 자료 형식을 확인합니다.
2. **Variables**의 `RICHGO_PUBLIC_THROUGH`에 계약상 허용된 마지막 게시일을 한국 날짜 `YYYY-MM-DD` 형식으로 설정합니다.
3. 기존 배포 작업이 매일 06:17 KST와 수동 실행 및 코드 배포 시점에 공급 피드를 한 번 조회합니다. 확인한 집계를 구별 파일로 저장합니다. 방문자 검색은 사이트의 저장 파일을 사용합니다.

피드 형식과 게시 범위는 [데이터 운영 정책](docs/DATA_POLICY.md)에 있습니다.

### 지도

[카카오디벨로퍼스](https://developers.kakao.com/)에서 카카오맵 사용을 활성화하고 웹 JavaScript 키의 허용 도메인에 `https://cows11904-hash.github.io`를 추가합니다. 저장소 **Settings → Secrets and variables → Actions → Variables**에 `KAKAO_MAP_JAVASCRIPT_KEY`를 등록하고 배포 작업을 실행합니다. 이 키는 브라우저에서 지도 SDK를 불러오는 공개 값입니다. 키가 없거나 지도를 불러오지 못하면 OpenStreetMap으로 지역 범위를 표시합니다. 선택한 단지는 카카오맵 공유 링크로 열 수 있습니다.

## 전국 확장

`data/regions.json`에 시·도 코드와 그 아래 5자리 법정 시·군·구 코드 목록을 추가하면 지역 선택과 API 조회에 반영됩니다. 지역별 JSON은 선택한 구역만 불러옵니다. 여러 시·도를 운영하기 전에는 전체 호출량, API 쿼터, Actions 실행시간과 스냅샷 크기를 확인합니다.

## 브라우저 보안

두 화면은 자원 로드 전에 HTML 메타 태그로 CSP를 적용합니다. 스크립트와 데이터 요청을 같은 출처로 제한하고 인라인 이벤트, 외부 프레임, 플러그인과 폼 전송을 차단합니다. 지도 화면에서는 OpenStreetMap 타일 이미지와 지도 배치에 필요한 인라인 스타일을 허용합니다. 카카오 웹 키가 설정된 빌드는 지도 화면에서 공식 SDK와 카카오 리소스 출처도 허용합니다.

GitHub Pages는 응답 헤더를 직접 설정하는 기능을 제공하지 않아, 메타 태그에서 지원되지 않는 `frame-ancestors`, `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy`는 호스팅 계층에서 추가해야 합니다. 현재 공개 페이지의 외부 프레임 삽입 차단은 완료되지 않았습니다. [GitHub 안내](https://github.com/orgs/community/discussions/54257) · [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)

CSV 내보내기는 전각 문자를 포함한 수식 시작 문자열에 탭을 붙여 스프레드시트의 수식 해석을 완화합니다. 해당 문자열의 CSV 값에는 이 탭이 포함됩니다. 가격·면적·층의 숫자형 필드는 그대로 유지합니다. 스프레드시트에서 재저장하거나 다른 프로그램으로 가져오는 동작은 프로그램별로 확인해야 합니다. [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection)
