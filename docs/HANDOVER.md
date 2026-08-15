# 동네옥션 Phase 0 — 인계 문서

작성: 2026-08-15 (5차)
이전 인계 문서를 이 문서로 **교체**합니다.

---

## ⚠️ 시작 전에

**다음 세션은 코드 작업이 거의 없습니다.** 경품 규정 · LEGO SKU · 광고 카피가 본론입니다.
그래서 **이 문서 하나만 올리면 충분합니다.**

코드를 만질 일이 생기면 그때 추가로 올리세요.

```
docs\AppsScript_Code.gs     ← Apps Script 편집기 현행본이 정확 (저장소 사본보다)
web\live.html / result.html / index.html / predict.html / js\common.js
```

```
git clone https://github.com/miname20002-cloud/dongne-auction.git
```

⚠️ 파일은 창을 넘지 않습니다. 인계 문서만 넘어갑니다.
⚠️ `.gs`는 저장소 사본보다 **편집기 현행본**을 쓰세요. 테스트 함수가 편집기에만 있을 수 있습니다.

---

## 확인 (지금 상태)

**Phase 0 엔진 검증이 종료됐습니다. 남은 것은 사업 준비뿐입니다.**

사용자 루프가 끝까지 연결됐고 실측으로 검증됐습니다.
`광고 → 예측 → LIVE → 결과 → 다음 회차` 중 마지막 두 칸이 이번에 생겼습니다.

- 백엔드 `action=result` 신설 · 배포 완료 · 실응답 확인
- `state`에 `lot_duration` 추가 (게이지 분모)
- `result.html` 신규 · `live.html` 대수술
- **GitHub Pages 배포 완료** — `file://` 제약 해제

```
https://miname20002-cloud.github.io/dongne-auction/web/live.html
https://miname20002-cloud.github.io/dongne-auction/web/result.html
```

Web App URL은 **바뀌지 않았습니다.** `common.js` 수정 불필요.

---

## 확정 (뒤집으면 안 되는 것)

이전 인계 문서의 확정 사항(사업 정의 · Phase 0 목적 · 절대 원칙 · 어휘 · 등급 6단계 · 예측왕)은 **전부 유효**합니다. 아래는 이번 세션에서 추가된 것만.

| 확정 | 이유 |
|---|---|
| 등급 계산의 유일 기준은 `result.html` | `state`엔 `has_bid`가 없어 `live`는 WATCHER/ROOKIE를 구분 못 함 |
| `live.html`은 종료 시 결과로 넘기기만 | 두 곳 계산 시 같은 사용자에게 다른 등급이 뜸 |
| 게이지 분모 = `lot_duration` (누적 연장 미포함) | 연장 시 25% 재충전이 "30초가 다시 생겼다"를 보여줌 |
| `next_round.available:true`여도 CTA 미부착 | `getRound_`는 active만 봄 → 끝난 회차로 되돌아감 |
| `round_id` 화면 비노출 | 운영 식별자. 다른 문구 치환도 금지 |
| 없는 다음 회차 날짜를 만들지 않음 | 없는 약속은 재방문율 지표를 직접 오염 |

### 협업 구조 — 지금은 도입하지 않음 (08-15 결정)
`ai/TASK.md` · `AI_THREAD.md` · `CONTROL.md` 로 Claude↔GPT 파일 기반 협업을 하는 안이 나왔으나 **보류**.
- 이 구조의 가치는 코드 변경량에 비례하는데, 남은 일 4개 중 3개가 코드가 아니다 (경품·광고·SKU)
- `CONTROL.md` 같은 상태 머신은 한 번만 갱신을 빠뜨려도 **틀린 상태가 권위 있게 남는다**
- 오늘 시간을 먹은 것은 복붙이 아니라 캐시·재배포·시트 열 밀림이었다 — 파일 공유로 안 풀린다

**살아나는 조건**: 실전 회차 후 개선 또는 MVP 착수 등 코드를 다시 크게 만질 때.
그때도 `HANDOVER.md` + `ai/AI_THREAD.md`(판단이 갈릴 때만) 두 개까지만.

**역할 분담은 유효**: Claude = 구현·검증·diff / GPT = 제품 판단·리뷰.

### `action=result` 응답 (구현 완료)

```json
pending : { ok, status:"pending", round_id, server_time }
final   : { ok, status:"final", round_id, server_time,
            my_result:{ has_bid, won_lots, total_lots },
            prediction_winner, next_round:{ available, auction_start_at } }
```

읽기 전용 — `setValue`/`appendRow` 0건. 예측왕 재계산 불가 구조.
`result.html`은 **`state` → `result` 순서 고정** (state가 만료 LOT을 마감시킴).

---

## 2026-08-15 — Phase 0 엔진 검증 종료

### ✅ has_bid A/B/C 실측 통과
| 세션 | 조건 | 결과 |
|---|---|---|
| A | 입찰 O / 최고가 0 | **ROOKIE** |
| B | 입찰 O / 최고가 2 | **BIDDER** |
| C | 입찰 X / 최고가 0 | **WATCHER** |

`won_lots` 우회 없이 `events.accepted` 기준으로만 판정.

### ✅ rankPredictions() 재집계 검증
기존 결과 초기화 후 회차 전체 재정렬 정상.
**운영 순서: LOT5 종료 → phase=ended → `rankPredictions()` → 결과 공개**
(안 돌리면 이전 회차 예측왕이 그대로 노출된다 — 08-15 실제 재현)

### ✅ LIVE 최종 회귀
- 1,000원 단위 검증 / 입찰 한도 검증
- 연타: 프론트 요청 중 버튼 잠금으로 선행 차단 (서버 `RATE_LIMIT_MS` 는 2차 방어)
- 30초 연장 정상
- 게이지 재충전 실측 `25/120 = 20.8%`
- 게이지 감소 실측 `104초 86.7% / 87초 72.5% / 65초 54.2%`
- 모바일 실기기 정상

### ✅ 기능 검증 종료
**더 이상의 UI/엔진 개선은 치명적 버그가 아닌 이상 보류.**
목표가 바뀌었다 — "잘 작동하나?" 가 아니라 **"모르는 사람이 실제로 들어와 참여하나?"**

### ⚠️ 실전부터 round_id 재사용 금지
```
KR-R1 = 테스트 데이터 (버릴 것)
첫 실전 = KR-R2 신규 생성 · KR-R1 은 active=FALSE
```
같은 round_id 를 재사용하면 `predictions` / `events` 에 여러 날 데이터가 겹쳐
예측왕이 이전 회차 값을 물고, `has_bid` 도 어제 입찰 기록으로 true 가 된다.

---

## 측정 — 대시보드 탭 (08-15 구축)

시트에 `대시보드` 탭. 열 문자를 하드코딩하지 않고 **헤더 이름으로 열 위치를 찾는다**
(`B25:B30 = MATCH(헤더명, events!$1:$1, 0)`). `events` A열의 `1` 을 나중에 지워도 안 깨진다.
`B2` 의 회차 값만 바꾸면 전체가 그 회차 기준으로 재계산된다.

```
◆ LOT별 고유 입찰자 (LOT01~05) + 3명 이상 경쟁 LOT   ← 사망선 판정
◆ 퍼널  랜딩 / 예측 / LIVE 진입 / 입찰 / 2개 이상 LOT 참여자
◆ 운영  총 accepted bid / events 총건수 / 마지막 이벤트
```

⚠️ **`COUNTA` 를 고유 카운트에 쓰지 말 것.** `COUNTA(#N/A)` 가 **1** 을 반환해서
`IFERROR` 를 통과한다. 실제 0명인 LOT 이 1명으로 표시돼 사망선 판정이 오염된다.
`ROWS(UNIQUE(FILTER(...)))` 로 쓸 것 — `ROWS` 는 오류를 전파한다.
(08-15 KR-R1 대조에서 LOT03·04·05 가 가짜 1 로 나와 발견)

⚠️ `session_id` 는 브라우저 단위다. 같은 사람의 폰·PC·시크릿창이 별개로 잡힌다.
**실인원보다 많게, 재방문율은 낮게** 나온다. 로그인 없이는 못 고친다.

---

## 🔴 다음 첫 행동 — 첫 유입 준비

```
1  KR-R2 신규 생성        config 에 행 추가 · KR-R1 active=FALSE
2  LEGO SKU 확정          "LEGO 인기 세트" 는 자리표시자. 세트명 + invalid_above
3  경품 규정 고정  ★      광고보다 먼저
4  광고 소재 3~4종
```

**3번이 4번보다 먼저다.** 랜딩이 이미 `예측왕에게 3만원` 을 약속하고 있다.
유입이 시작된 뒤 규정을 바꾸면 신뢰가 먼저 깨진다. 고정해야 할 것:

```
지급 대상 · 동률 처리 · 지급 방식 · 발표 시점 · 미수령 처리 · 시크릿창 어뷰징 대책
```

---

## KR-R3 후보 — 즉시경매 비교실험 (08-15 기록 · 실행 보류)

**목적**
KR-R2 에서 광고→예측은 발생하는데 21시 LIVE 복귀가 크게 이탈할 경우,
**대기시간이 병목인지** 검증한다.

```
KR-R2 (현행)   TikTok → index → predict → 21:00 LIVE → result
KR-R3 (후보)   TikTok → 즉시 LIVE → LOT 120초 → 30초 intermission
                      → 다음 LOT 자동 open → 5 LOT → result
```
5 LOT 한 사이클 약 12분 (+연장).

**구현 예상 — 실제 코드를 뜯어본 산출**

| 위치 | 내용 | 줄 |
|---|---|---|
| `autoCloseExpired_` → `autoAdvance_` | 마감 후 인터미션 경과 시 다음 wait LOT 자동 open | +30 |
| 〃 | `auction_start` 도달 시 LOT1 자동 open | +8 |
| `phaseOf_` | `intermission` phase 추가 | +3 |
| `buildState_` | `next_open_at` 필드 추가 | +2 |
| `live.html` | 대기 화면 카운트다운 | +15 |

**새 열이 거의 필요 없다** — `closeLot` 이 `close_at` 을 지우지 않으므로
`마지막으로 닫힌 LOT 의 close_at + intermission` 으로 다음 오픈 시각을 파생할 수 있다.
이것이 이 설계가 싼 이유다.

⚠️ **시간 기반 트리거를 쓰지 말 것.** 30초 연장이 걸린 LOT 을 트리거가 강제로 넘긴다.
`state` 폴링 시 서버가 상태를 전진시키는 **lazy transition** 이어야 연장과 충돌하지 않는다.
동시성은 기존 패턴 재사용 — 캐시 가드 1초 + `tryLock(2000)` + 락 안 재확인.
⚠️ `handleAdmin_` 은 건드리지 않는다. 사고 시 사람이 개입할 수단이 남아야 한다.

**같이 재설계해야 하는 것 3개**
1. **예측왕/3만원** — 즉시경매는 입장 시점이 제각각이라 "사전 예측" 개념이 깨진다.
   없애거나 "다음 LOT 가격 맞히기" 같은 별도 게임으로 다시 설계.
   ⚠️ 현재 랜딩·광고가 3만원을 약속하고 있으므로 문구도 함께 바꿔야 한다.
2. **무관중 시 정지** — 폴링하는 사람이 없으면 다음 LOT 이 안 열린다.
   오랜 공백 후 첫 방문자가 들어왔을 때 여러 LOT 을 catch-up 할지 정의할 것.
3. **자동전환 회귀 테스트** — 새 실패 모드다. 리허설을 다시 한다.

**실행 조건**
KR-R2 에서 **예측 전환은 유의미한데 LIVE 복귀율이 낮을 때** 우선 실험.

```
예측 35 → LIVE 복귀 8   → 병목은 대기시간. KR-R3 실행
예측 5                  → 병목은 경매 제안 자체. 즉시경매로도 안 풀림
```

⚠️ **KR-R2 를 지금 바꾸지 말 것.** 두 변수를 동시에 바꾸면 무엇이 원인이었는지 알 수 없다.
`광고 → live.html 직행` 도 같은 이유로 기각됐다 (08-15) — 엔진은 안 바뀌지만
예측 화면을 건너뛰어 KR-R2 의 핵심 퍼널을 측정할 수 없게 된다.

---

## has_bid 원인 (규명 완료 · 기록용)

`events` 시트 **A열에 헤더 이름이 `1` 인 빈 열**이 있었다.
옛 `logEvent_` 는 위치 기반 `appendRow([...])` 라 전 컬럼이 한 칸씩 밀렸다
— `session_id` 열을 읽으면 닉네임이 나왔다.
`selfTest` 는 열 **존재**만 검사하므로 이걸 통과시킨다.

**수정**
- `logEvent_` → 헤더명 매핑 + 헤더 1행만 읽기 (`readTable_` 전체 스캔 제거)
- `buildResult_` 의 `won > 0 ||` 우회 제거

**검증** — `debugResultSession()` 재실행 시 `④ has_bid : true`, `▶ 처음 0 이 되는 지점 : 없음`

⚠️ **A열 `1` 은 아직 지우지 않았다.** 옛 186행이 어떻게 밀렸는지 확인할 증거라
리허설이 끝난 뒤 정리한다. 헤더 매핑이 들어갔으므로 있어도 정상 동작한다.

## 오늘 완료한 것

### 백엔드 (배포 완료)
| | 내용 |
|---|---|
| F | `action=result` 신설 — `buildResult_` / `hasAcceptedBid_` / `predictionWinner_` / `nextRound_` / `testResult` |
| G | `buildState_`에 `lot_duration: cfg.lot_duration` 한 줄 |

`nextRound_`는 `active`가 아니라 `round_id`로 현재 회차를 제외합니다 (미리 켜두는 운영/꺼두는 운영 양쪽 지원).

### result.html (신규)
- Hero(성적)+등급 **한 카드** — 390px에서 291px 지점까지, 첫 화면 안에 `오늘의 결과 / n/전체 / 등급`
- 등급은 정수 산술 (`won*10 > total*6`) — 3/5=60% 경계 부동소수 오판 방지
- pending 최대 5회 × 3초 → 새로고침 버튼
- 예측왕 `null` → `예측 결과 집계 중` (프론트 재계산 없음)
- `next_round.available:false` → `준비 중`

### live.html
- 카운트다운을 **상품 이미지 안 원형**으로 (88px, SVG 3층: disc r37 / track r40 / arc r40)
- 게이지 = `left / STATE.lot_duration`, clamp 0~1, `rotate(-90deg)`로 12시 시작 시계방향 감소
- 30초 이하 `stroke` 만 `--live`로 (형태 불변), 10초 이하 숫자 opacity pulse
- 독립 카운터 · `SECONDS LEFT` · 입찰 횟수 표시 제거
- **입찰창 `position:fixed` → 흐름 안 카드** (현재가 바로 아래)
- `tierOf` / MY RESULT 블록 제거 → `오늘의 결과 보기 →`
- `내일 밤 9시에 다시 만나요` 제거
- 로고 `동네`=라임 / `옥션`=흰색 (양쪽 화면 동일)
- 빈 `src=""` 제거 (`imgFail` 콘솔 예외)

---

## 미완료

### 실전 리허설
**전 항목 완료 (08-15).** 위 "엔진 검증 종료" 참조.

### 첫 유입 준비 (다음 세션 본론)
- [x] ~~**KR-R2 생성 + 활성화** — config 4행 · lots 7~11행 · KR-R1 `active=FALSE`~~
      시각(`predict_close_at`/`auction_start_at`)은 **아직 비어 있음** — 광고 일정 확정 후 입력
- [x] ~~**LEGO SKU 확정** — 72537 호랑이 더피와 까치 서씨~~
      화면명 `레고 K-POP 데몬 헌터스` · `demon.jpg` (1200×1200 정규화)
      ⚠️ `invalid_above=109900` 은 **임시값**. 실전 당일 실제 구매 가능 최저가로 재검증
- [x] ~~**경품 규정 고정**~~ — 예측왕 3만원 1명 + 커피 추첨 10명 유지
      결과 화면에 수령 확인 코드(`session_id`) + 구글폼 링크
      https://forms.gle/xvKd7o7G9vSewtCa9
      커피는 **당첨자 통보가 아니라 참여자 응모** 방식 (연락 수단이 없으므로)
      동률: 먼저 제출 우선 / 발표: 종료 후 10분 내 / 미수령: 7일 소멸, 재추첨 없음
      중복 당첨: 예측왕 우선, 커피는 재추첨 (예측왕 확정 후 추첨할 것)
- [x] ~~대시보드 탭 구축~~ (위 "측정" 참조)
- [ ] 광고 소재 3~4종 (`?src=` 분리, **"모의경매" 고지 필수**)
- [ ] 상품 이미지 정규화 (1:1 · 흰 배경 · 여백 10%)
- [ ] `<h1>나의 낙찰가는?` 결정 — 광고 소재 정할 때 함께
- [ ] 주간 랭킹 + 일요일 추첨 — 규정은 1회차 시작 **전** 고정

---

## 회귀 목록 (매번 확인)

기존 항목 유지 + 이번 추가 4건:

- 30초 연장 — 남은 20초 입찰 → 30초 복구, 양쪽 창 배너 각 1회
- 무효선 초과 거절 — 900,000 → "입찰 한도를 넘었습니다"
- closed LOT에서 `is_mine` 유지
- `1 / 5 종료` 카운터와 실제 카드 수 일치
- **`live`/`result` 등급이 각각 계산되지 않는가** (`tierOf` 재발)
- **다음 회차 날짜를 하드코딩하지 않았는가**
- **`.bidbar`가 `position:fixed`로 되돌아가지 않았는가**
- **배포 후 확인은 `Ctrl+Shift+R`**

---

## 함정 (이번에 새로 배운 것)

| 증상 | 원인 |
|---|---|
| Claude가 Pages를 열었는데 화면이 빔 | `createPoller`가 `document.hidden`이면 폴링 안 함. 확장이 여는 탭은 백그라운드 → **Claude는 렌더 결과를 볼 수 없음** |
| Apps Script 편집기 자동화 실패 | SPA가 `document_idle`에 도달 안 함. screenshot 5초·get_page_text 45초 전부 타임아웃 → **편집기 작업은 사람이 직접** |
| `file://` 페이지 접근 불가 | 확장이 `https://file:///`로 변환. Pages 배포 전엔 자동화 불가 |
| 고쳤는데 콘솔 오류가 그대로 | 브라우저 캐시. `?v=커밋해시` 또는 `Ctrl+Shift+R` |
| 재배포 직후 POST 404 | 일시적. 몇 초 뒤 정상 |
| `events` 값이 엉뚱한 열에 | `logEvent_`만 배열 순서로 append. 다른 곳은 헤더명 기준 |
| 두 창의 상태가 어긋남 | 뒤에 가려진 창은 `document.hidden` 으로 폴링 정지. **반드시 나란히, 겹치지 않게** |

기존 함정(파일이 창을 안 넘어감 / PowerShell 한글 깨짐 / `node --check` 필수 / 타임존 누락 / 이미지 대소문자)은 전부 유효.

---

## 백엔드 참조

**저장소**: `https://github.com/miname20002-cloud/dongne-auction` (Public)
최신 커밋 `37d61a5`
**시트**: `1oFnQ1Q0JuVQbLhOu-1cqosElMMOPfD2BRTqnSrK7I1Q` — `events` / `lots` / `predictions` / `config`

**Web App** (변경 없음)
```
https://script.google.com/macros/s/AKfycbyAk1IKlgPWLaL2dcsWcD9nUyt_tVZYdIpIRpKsyL3w9PajZmKKSYBHxlpOhkbYXSOG/exec
```

⚠️ 재배포는 **`배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포`**.
`새 배포`를 누르면 URL이 바뀌어 `common.js`도 고쳐야 함.

**편집기 함수**: `setupAdminToken`(최초 1회만) / `selfTest` / `checkIsMine` / `rankPredictions`
/ `testResult` / `testTime` / `openLot1` / `openLotN` / `nextLot` / `closeNow` / `resetAll`

⚠️ `testTime()`의 `MIN`은 **15 이상**. 5면 예측 마감이 즉시라 `predict`가 거절됩니다
(`predict_close = auction_start - 5분`).

**상품 (KR-R1)**: Switch OLED 299,000(무효선 300,000) · AirPods 4 ANC 205,000(210,000) ·
LEGO 미확정 · Helinox Chair One 115,000(115,000) · Stanley Quencher 35,000(35,000)
전부 1,000원 START · 1,000원 단위 자유입찰 · 마감 30초 내 입찰 시 30초 연장

---

**권장 모델 티어**: 표준. 설계 판단은 끝났고 남은 건 진단 1건 + 리허설입니다.
