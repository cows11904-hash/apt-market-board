# 시세나침반

서울 25개 자치구의 아파트 매매 실거래가를 조회하는 공개 웹사이트입니다. 지역, 계약월, 전용면적, 단지명, 가격 상한, 거래 유형으로 검색합니다. 거래별 가격에는 국토교통부 출처와 확인일이 표시됩니다. 매물 호가는 게시 권한과 개별 확인일을 갖춘 유효 매물만 표시합니다.

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
- 매물 호가는 승인된 공급처의 전체 피드를 배포할 때 확인합니다. 수집 실패와 연동 전 상태를 화면에 표시합니다. 피드 형식, 승인 범위 및 인증 설정은 [데이터 운영 정책](docs/DATA_POLICY.md)을 참고하세요.

## 전국 확장

`data/regions.json`에 시·도 코드와 그 아래 5자리 법정 시·군·구 코드 목록을 추가하면 지역 선택과 API 조회에 반영됩니다. 지역별 JSON은 선택한 구역만 불러옵니다. 여러 시·도를 운영하기 전에는 전체 호출량, API 쿼터, Actions 실행시간과 스냅샷 크기를 확인합니다.
