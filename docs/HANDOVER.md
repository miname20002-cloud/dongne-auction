# 동네옥션 Phase 0 — 인계 문서

작성: 2026-08-14 (3차)
이전 인계 문서를 이 문서로 **교체**합니다.

---

## ⚠️ 시작 전에

**파일은 창을 넘지 않습니다.** 인계 문서는 넘어가지만 작업 파일은 사라집니다.
저장소가 생겼으니 이제 clone 한 번이면 됩니다.

```
git clone https://github.com/miname20002-cloud/dongne-auction.git
```

**새 창 첫 행동: 아래 2개를 함께 올릴 것.**

```
docs\HANDOVER.md            ← 이 문서
docs\AppsScript_Code.gs     ← Apps Script 편집기 현행본이 정확
```

작업 대상에 따라 `web\live.html` / `index.html` / `predict.html` / `js\common.js` 추가.

⚠️ `.gs`는 저장소 사본보다 **Apps Script 편집기 현행본**을 쓰세요.
테스트 함수 6개가 편집기에만 있을 수 있습니다.

---

## 확인 (지금 상태)

**백엔드 A~E 5건 수정 완료 · 재배포 완료 · `selfTest()` 전체 통과.**
**A/B `is_mine` 실동작 확인 — 승자 창에만 `내가 최고가입니다`, 패자 창엔 `익명XXXX 님이 최고가`.**

이게 오늘의 핵심입니다. 지금까지 아무에게도 안 뜨던 문제가 닫혔습니다.

같이 확인된 것:
- `lot_already_closed` — 종료된 LOT 재오픈 차단 실동작
- 30초 자동 연장 — 양쪽 창 모두 `close_at` 동기화
- `holder_session` 열이 시트에 이미 존재 (`selfTest`가 필수 열로 검사)

프론트 문구도 확정 어휘로 통일 완료. GitHub 저장소 생성 + 푸시 완료 (`eb2ccbc`).

---

## 확정 (뒤집으면 안 되는 것)

### 사업 정의
> 버리긴 아깝고 당근에 올리긴 귀찮은 물건을, 동네 사람들에게 경쟁시켜 처분하는 플랫폼.
> 중고거래가 아니라 **처분 시장(disposal market)**.

### Phase 0의 목적
매출이 아니라 **행동 검증**. 핵심 KPI는 **1인당 참여 LOT 수** (입찰 횟수 아님).

### 절대 원칙
| 원칙 | 이유 |
|---|---|
| 운영자 데이터(`invalid_above`, `model`)를 state 응답에 넣지 않음 | 개발자도구로 읽히면 앵커링 |
| 마감·연장·유효성 판정은 **전부 서버** | 클라이언트 시계 불신 |
| 승자 판정은 **session_id 기준**, 서버가 `is_mine` 판정 | 닉네임은 변경 가능 |
| 등급은 **최고가 LOT 수 비율**, 입찰 횟수 아님 | 연타 유도 방지 |
| quick 버튼은 즉시 입찰 금지, 입력창에 금액만 세팅 | 계단식 오염 방지 |
| LOT 개수는 **`s.lots.length`가 유일 기준** | 회차마다 5개/10개 가변 |
| `_hs`는 서버 내부 전용, 응답 직전 제거 | 남의 session_id 노출 금지 |

### 사용자 화면 어휘 (확정)
```
✅ 최종가 · 최고가 · 현재가 · 종료 · 입찰 한도 · 예상 최종가 · 지난 최종가
❌ 낙찰 · 낙찰가 · SOLD · 실제 낙찰가 · 상한선
```
`CLOSED` / `LIVE` / `CURRENT` 는 UI 섹션 라벨이라 허용.
고지: `모의경매 · 실제 상품 판매가 아닙니다. / 결제·배송은 발생하지 않습니다.`

⚠️ **미결**: `index.html` · `predict.html`의 `<h1>나의 낙찰가는?` (title/og 포함).
광고 후크라 범위 밖으로 두었음. 광고 소재 정할 때 함께 결정.
후보: `나의 최종가는?` / `얼마까지 갈까?` / 예외 인정.

### 등급 6단계
| 등급 | 기준 | 5 LOT | 10 LOT |
|---|---|---|---|
| WATCHER | accepted 입찰 0회 | — | — |
| ROOKIE | accepted 입찰 ≥1, 최고가 0개 | 0/5 | 0/10 |
| BIDDER | 최고가 >0% ~ 40% | 1~2 | 1~4 |
| HUNTER | >40% ~ 60% | 3 | 5~6 |
| ACE | >60% ~ <100% | 4 | 7~9 |
| SWEEP | 100% | 5 | 10 |

거절된 입찰(`accepted=FALSE`)은 참여로 계산하지 않음 — 어뷰징 방지.
분모는 해당 회차 `s.lots.length` (종료된 LOT 수 아님).

### 예측왕
회차 전체 **1명**. 집계 단위는 **예측 1건** (여러 LOT 예측 시 예측권 여러 장).
동점: `diff` → `ts_server` → 시트 행 순서.
주간 랭킹은 `predictions.rank`를 재사용하지 말고 별도 집계.
`rankPredictions()`는 idempotent — 실행 시 해당 round의 `final_price`/`diff`/`rank`를 먼저 비움.

### `action=result` 응답 (미구현, 형태 확정)
```json
{
  "ok": true,
  "round_id": "KR-R1",
  "my_result": { "has_bid": true, "won_lots": 3, "total_lots": 5 },
  "prediction_winner": {
    "nickname": "익명3295", "lot_no": 2,
    "predicted_price": 42000, "final_price": 43000, "diff": 1000
  }
}
```
`state`와 분리된 별도 엔드포인트 (state는 공통 캐시, result는 세션별 집계).
`prediction_winner`는 **항상 객체 1건** — 동점이어도 배열로 만들지 않음.
`bid_count`는 서버 계산은 하되 **사용자 응답에 비노출**.

---

## 오늘 완료한 것

### 백엔드 A~E (재배포 완료)
| | 내용 |
|---|---|
| A | `lots.holder_session` 필수 열 승격, 닉네임 폴백 제거. `handleBid_`에서 `colIndex_`를 쓰기 전에 평가해 부분 기록 방지 |
| B | `admin next` 조기 return 제거 → `open`/`close`/`next`/`reset` 모든 성공 경로가 `flush` + cache remove |
| C | `open`이 기존 onair를 닫을 때 `final_price` 먼저 → `state=closed`. `closed` 재오픈 차단(`lot_already_closed`), **onair 재-open은 no-op**(`already_open`) — 타이머 재시작 금지 |
| D | 캐시된 `server_time` 재사용 금지 → 응답 직전 `out.server_time = nowIso_()`. LIVE 중 캐시 1초 / 그 외 2초 |
| E | `rankPredictions` 회차 전체 통합 순위 + 재실행 안전(초기화 후 재집계) |

공통 `closeLot()`으로 통일 → `open`/`close`/`next` 모두 `lot_closed` 이벤트 기록.

### 프론트
- `index` / `predict` / `live` / `common.js` 문구를 확정 어휘로 통일
- `index`: JS가 `#rule1`/`#rule2`를 덮어쓰던 코드 제거 (HTML이 유일 기준)
- `predict`: CTA를 phase에 따라 `경매장 들어가기` / `LIVE 경매 참여하기`
- `live`: 종료 카드에 `최종가` 라벨, `1 / 5 종료` 카운터(`s.lots.length` 기준)
- `live`: 연장 알림을 **단일 경로**로 — `r.extended` 즉시 표시 제거, 모든 창이 `close_at`
  변화만으로 판정. LOT 진입 시 기준선만 잡고 지난 연장은 표시 안 함
- `live`: `.ext`가 숨김 상태에서 높이를 먹던 문제 수정(`max-height:0`) + 여백 약 90px 축소

---

## 다음 첫 행동 — 남은 검증

```
1  resetAll → testTime → openLot1
2  A/B 두 창을 나란히 띄우고(둘 다 보이게) 경쟁 입찰
3  20초 남았을 때 입찰 → 양쪽 모두 배너 1회 · 다음 폴링에서 반복 없음   ← 오늘 수정분
4  closeNow → 승자 창 Network Response 에서 closed LOT 의 is_mine:true   ← result.html 전제
5  openLotN(LOT2) 강제전환 → checkIsMine() 로그에서 LOT1 의 final + session 둘 다 확인
6  거절 로그 6종 — 1,500원(bad_unit) / 연타(rate_limit) / 900,000원(over_limit)
7  LOT 5 완주 → phase=ended
8  rankPredictions 실행 → rank=1 이 정확히 1건
```

⚠️ **3번은 뒷창이 보이는 상태여야 합니다.** `document.hidden`이면 폴링이 멈춰 배너를 못 받습니다.

⚠️ **4번이 `result.html`의 전제입니다.** closed LOT에서 `is_mine`이 유지돼야 등급 계산이 성립합니다.

같은 Response에서 `Ctrl+F` → `invalid_above` · `model` · `_hs` → **0건** 확인.

통과하면 → `action=result` 엔드포인트 → `result.html`.

---

## 미완료

### result.html (검증 통과 직후)
- [ ] `action=result` 엔드포인트 신설
- [ ] 화면: 전체 LOT 최종가 / 내가 최고가였던 LOT / `n / 전체` / 등급 / 예측왕 / 다음 회차
- [ ] `index.html`의 `ended` CTA를 `result.html`로 연결 (현재 `live.html`)

### 그 다음
- [ ] **GitHub Pages 배포** — 지금 `file://`로만 테스트. **모바일 미검증**
- [ ] 이미지 대소문자 확인 (`Helinox.jpg` / `Stanley.jpg`) — Pages는 대소문자 구분
- [ ] LEGO SKU 확정 + 가격 검증 (`LEGO 인기 세트`는 자리표시자)
- [ ] 상품 이미지 정규화 (1:1 · 흰 배경 · 여백 10%) — 자동수집 없이 수동 5장
- [ ] `<h1>나의 낙찰가는?` 결정
- [ ] 리허설 9항목
- [ ] 광고 소재 3~4종 (`?src=` 분리, **"모의경매" 고지 필수**)
- [ ] 주간 랭킹 + 일요일 추첨 — 경품 규정은 1회차 시작 **전** 고정. 시크릿창 어뷰징 대책

### 보류
- 상품 자동수집 파이프라인 — 저작권·약관 위험 + 본사업 미연결.
  살아나는 조건: 주 3회 이상 회차 / 미스터리박스 전환 / 판매자 등록 파이프라인

---

## 회귀 목록 (매번 확인)

- 30초 연장 — 남은 20초 입찰 → 30초 복구, **양쪽 창 배너 각 1회**
- 무효선 초과 거절 — 900,000 → "입찰 한도를 넘었습니다"
- `nextLot()` 후 다음 폴링 1회 안에 전환 (캐시 2초가 더 붙지 않는지)
- `open` 강제전환 시 이전 LOT의 `final_price` + `holder_session` 보존
- closed LOT에서 `is_mine` 유지
- `server_time` 신선도 — **1초 이상 간격** 요청 시 진행되는지
- `1 / 5 종료` 카운터와 실제 카드 수가 일치하는지 (어긋나면 데이터 문제 신호)
- LOT 5 완주 → `phase=ended`

---

## 함정

| 증상 | 원인 |
|---|---|
| 파일이 있다고 착각 | 창이 바뀌면 컨테이너 초기화. 인계 문서만 넘어감 |
| 검수 기준이 정상을 실패로 오판 | `nowIso_()`는 초 단위 · 폴링은 3초. **상수를 먼저 확인하고 기준을 쓸 것** |
| 테스트 함수가 사라짐 | `.gs` 전체를 덮어쓰면 편집기에만 있던 `testTime`/`resetAll` 등이 날아감 |
| 시트를 못 찾음 | Apps Script가 독립 프로젝트 / 헤더가 1행이 아니라 2행 |
| 한글 깨짐 | PowerShell `Set-Content`가 인코딩 변경. **PS로 한글 파일 고치지 말 것** |
| 타이머 멈춤 | JS 문법 오류 1개로 스크립트 전체 정지. **`node --check` 필수** |
| 이미지 안 뜸 | 파일이 Downloads에 있음 / 0바이트 / **Pages 대소문자 구분** |
| 55시간 카운트다운 | 타임존(`+09:00`) 누락 |

---

## 백엔드 참조

**저장소**: `https://github.com/miname20002-cloud/dongne-auction` (Public)
**시트**: `1oFnQ1Q0JuVQbLhOu-1cqosElMMOPfD2BRTqnSrK7I1Q` — `events` / `lots` / `predictions` / `config`

**Web App**
```
https://script.google.com/macros/s/AKfycbyAk1IKlgPWLaL2dcsWcD9nUyt_tVZYdIpIRpKsyL3w9PajZmKKSYBHxlpOhkbYXSOG/exec
```

⚠️ 재배포는 **`배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포`**.
`새 배포`를 누르면 URL이 바뀌어 `common.js`도 고쳐야 함.

**편집기 함수**: `setupAdminToken`(최초 1회만) / `selfTest` / `checkIsMine` / `rankPredictions`
/ `testTime` / `openLot1` / `openLotN` / `nextLot` / `closeNow` / `resetAll`

⚠️ `setupAdminToken`을 다시 실행하면 토큰이 재발급되어 기존 토큰이 무효화됨.

**상품 (KR-R1)**: Switch OLED 299,000(무효선 300,000) · AirPods 4 ANC 205,000(210,000) ·
LEGO 미확정 · Helinox Chair One 115,000(115,000) · Stanley Quencher 35,000(35,000)
전부 1,000원 START · 1,000원 단위 자유입찰 · 마감 30초 내 입찰 시 30초 연장

---

**권장 모델 티어**: 표준. 남은 건 검증과 `result.html` 구현이라 설계 판단은 거의 끝났습니다.
