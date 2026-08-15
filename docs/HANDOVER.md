# 동네옥션 KR-R2 — 인계 문서

작성: **2026-08-15 사무실 작업 종료 시점**
최종 갱신: **2026-08-16 — 광고 시작 전 개발 작업 완료**
이전 인계 문서를 이 문서로 **교체**합니다.

---

## 🟢 지금 상태 (한 줄)

> **광고 시작 전 개발 작업 완료. 남은 것은 광고 유입 테스트와 지표 확인뿐이다.**

```
✅ 광고 테스트용 랜딩 index.html   완료
✅ LIVE 경매 live.html             완료
✅ 경품 안내 result.html           완료
✅ Apps Script 경매 엔진           검증 완료 · 동결(freeze)
```

⚠️ **엔진은 동결이다.** 광고 테스트 중 **실제 버그가 발견될 때만** 재개한다.
추첨 기능은 지금 개발하지 않는다.

---

## 현재 경매 규칙 (확정 · 가동 중)

```
LOT      내부 명칭은 유지. 사용자 화면에는 "경매" 로만 표시한다
상품당   60초
연장     남은 시간 15초 이하에서 입찰 발생 시, 마감시각 = 입찰시각 + 30초
         반복 연장 가능 (횟수 제한 없음)
상품 사이 10초
진행     5개 상품 자동 진행 · auto_run=TRUE 상태에서 자동
운영     Apps Script 함수 수동 실행 불필요
```

`extend_trigger_sec`(15) / `extend_sec`(30) 분리는 **완료**됐다.
`live.html` 의 빨강(hot) 구간도 `extend_trigger_sec` 를 쓴다 — `extend_sec`(30) 로 되돌리지 말 것.

---

## 오늘 완료한 테스트 (08-15)

**수동 조작 기준으로 전부 통과했다.**

```
✅ selfTest()                     전체 통과
✅ checkCycle()                   정상
✅ reset                          정상
✅ LOT1 수동 오픈                 정상
✅ 실제 입찰 1,000원 → 6,000원    정상
✅ LOT1 종료 및 최종가 표시       정상
✅ intermission + NEXT LOT 프리뷰  정상
✅ LOT2 수동 오픈                 정상
✅ 사이클 UI / 종료 이력 표시      정상
✅ 로컬 프론트 → 배포된 Apps Script API / Google Sheet 연동  정상
```

## 미완료 → 08-16 해소 결과

```
✅ 연장 규칙 분리 (extend_trigger_sec 15 / extend_sec 30)
✅ auto_run=TRUE 자동 반복 (LOT1→5→다음 cycle)
✅ 15초 막판입찰 → 30초 연장
✅ LOT5 종료 → cycle 초기화 자동 실행
✅ stale recover
✅ 경계 69 / 70 / 71초
✅ 파일 배포 (GitHub Pages)
❌ 광고 소재 3종                      ← 개발 아님. 광고 착수 시 진행
❌ invalid_above 당일 최저가 재검증    ← LOT3 109,900 임시값 (아래 "상품" 참조)
```

---

## 오늘 변경한 것

### 시트

**config — 열 5개 추가** (KR-R2 행에만 값 입력)

```
cycle_no          1
campaign_day      1
intermission_sec  10
cooldown_sec      10
auto_run          FALSE   ← 리허설 전까지 FALSE 유지
```

⚠️ `lot_duration_sec=120` · `extend_sec=30` 은 **아직 안 바꿨다.**
현행 배포본이 읽는 값이라 지금 바꾸면 돌고 있는 경매가 즉시 변한다.

**events — 열 1개 추가**

```
cycle_id     D1-C007 형식
```

⚠️ `events` A열에 헤더 이름이 `1` 인 정체불명 열이 아직 있다.
`logEvent_` 가 헤더명 매핑이라 동작에는 문제없다. 리허설 후 정리한다.

### Code.gs — 1,304줄 / 44함수 / 중복 0

| | 내용 |
|---|---|
| 교체 | `getRound_` (cycle 필드 5개) · `phaseOf_` (live/intermission/ended/idle) |
| 교체 | `autoCloseExpired_` → **`autoAdvance_`** (마감·인터미션·다음LOT·리셋·복구) |
| 신규 | `lastCloseAt_` · `openLotRow_` · `closeLotRow_` · `resetCycle_` · `writeBid_` · `checkCycle` |
| 수정 | `logEvent_` 헤더 1행만 읽기 + `cycle_id` |
| 수정 | `buildState_` cfg/lots 재조회 순서 + 신규 6필드 |
| 수정 | `handleBid_` 배치 쓰기 + 사이클 3중 방어 |
| 수정 | `handleAdmin_` `cmd:'cycle'` 추가 · 수동 `lot_closed` 에 `cycle_id` |
| 수정 | `selfTest` 신규 열 검사 · predictions 는 advisory |
| 삭제 | `debugResultSession` (임시 진단, `LOG_ORDER` 가 낡음) |
| 보존 | `handlePredict_` · `rankPredictions` · `buildResult_` 계열 · `testTime` 등 운영 함수 전부 |

### 프론트

**live.html** — 반복 LIVE 본체
```
+ intermission / ended 대기 화면 (서버 next_open_at · next_cycle_at 만 사용)
+ LOT n / 5 표시
+ 입찰 POST 에 cycle_id 전송
+ extTrack · wonLots 키에 cycle_id 포함
+ view_live 를 첫 state 수신 후 1회 (init 에서 미리 찍지 않음)
+ hot 임계를 서버 값으로
+ intermission·ended 폴링 hot(1.5초)
+ 최고가 판정 isMine(cur)
+ 푸터 "입찰 1회 이상이면 커피 추첨에 자동 참여됩니다"
- 9시·예측·결과 링크·auction_start_at 전부 제거
```

**index.html** — 카운트다운 제거, CTA 전부 `live.html`
**08-16 최종 구조로 재작성됨. 아래가 현행이다.**
```
HERO      "나의 낙찰가는?" + 큰 1,000원 START
          회원가입 없이 바로 참여 · 결제 없음
TODAY'S   상품 5개 컴팩트 표시 (화면 폭 균등 분할 · 가로 스크롤 없음)
          이미지 62px · 상품명 1줄 · 가격 1,000원~ · 현재 상품만 작은 LIVE badge
HOW TO    60초 경매 | 막판 +30초 | 자동 추첨   (한 줄 rule strip)
          천원 시작 → 원하는 가격을 입찰 → 모의 낙찰!
REWARD    입찰 1회 이상이면 커피 기프티콘 10명 추첨
          우측 "경품 안내 →" (orange) · 카드 전체가 result.html 링크
CLOSED    "종료된 경매"
하단      sticky 입찰 CTA (→ live.html)
```
⚠️ 상품을 크게 보여주는 쇼핑몰 진열로 되돌리지 말 것. FEATURED 확대 카드·상품 설명·
가로 스와이프·3열 박스 HOW TO PLAY 는 전부 제거된 상태다.
⚠️ 페이지 세로 길이 ≈ 1,100px (390px 기준). 늘리지 말 것.

**result.html** — 경품·캠페인 안내 전용
```
action=result 호출 제거 · 성적/등급/예측왕/다음회차 전부 제거
참여 방식 3단계 · 당첨자 발표 안내 · 수령 확인 코드
발표 전이라 [경품 신청 →] 버튼 제거 → 안내 텍스트 "당첨자 발표 후 신청이 열립니다"
  (배경·테두리 없음 · dim · 클릭 불가 · Google Form URL 은 live 코드에서 삭제)
[다시 경매 참여하기 →] 유지
당첨자 목록 자리를 hidden 으로 미리 넣어둠 (추첨 후 닉네임 10개 수동 입력)
```
⚠️ 발표 전에는 Google Form 링크를 **노출도 활성화도 하지 않는다.**
복구 방법은 `result.html` 스크립트 상단 주석에 적어뒀다.

**common.js** — 한 줄
```js
cycle_changed: "새 경매가 시작됐습니다. 다시 입찰해주세요"
```

**predict.html** — 미사용. 파일은 보존.

### Google Form

```
제목       동네옥션 모의경매 — 경품 신청
신청 구분   커피 쿠폰 당첨   ⚠️ 예측왕(3만원) 선택지는 제거됨 (08-16)
필수 문항   수령 확인 코드 · 닉네임 · 휴대폰 · 개인정보 동의
설정       이메일 수집 안 함 · 응답 수정 불가 · 로그인 불필요
검증       비로그인 상태 제출 가능 확인됨
상태       발표 전 — result.html 에서 비활성. 발표 후 당첨자에게만 연다
```
https://forms.gle/xvKd7o7G9vSewtCa9

---

## 확정 (뒤집지 말 것)

### 반복 LIVE 구조
```
접속 즉시 현재 LOT 합류 (전역 단일 경매 · 사용자별 개인 경매 아님)
LOT 60초 × 5 · 사이 10초 · LOT5 후 10초 결과 → 다음 사이클 자동
사이클 최소 5분 58초 · 상한 없음 (연장 무제한)
```

⚠️ **연장은 LOT당 1회 제한이 아니다.** 조건을 만족할 때마다 갱신되므로
경쟁이 계속되면 무한히 늘어난다. **의도된 동작이다** — 경쟁을 억지로 끊지 않는다.
따라서 "사이클 최대 N초" 계산은 성립하지 않는다.

### 엔진 원칙
- **lazy transition** — `state` 폴링이 서버 상태를 전진시킨다. **시간 기반 트리거 금지**
  (트리거는 연장된 LOT 을 강제 종료시킨다)
- **한 요청에 한 단계만** 전진. 단 `recover` 는 예외 (아무도 안 본 사이클을 버리는 것)
- `STALE = lot_duration + intermission`. 경계는 **초과(>)** — 70초는 close, 71초부터 recover
- 타이밍을 별도 필드로 저장하지 않고 `close_at` 에서 파생
- `handleAdmin_` 유지. `auto_run=FALSE` 로 즉시 정지 가능

### 사이클 경계 입찰 3중 방어
```
① 락 전   b.cycle_id ≠ cfg.cycle_id      옛 화면에서 누른 입찰 차단
② 락 후   freshCfg ≠ requestCycle         락 대기 중 전환 차단
③ 락 후   b.cycle_id ≠ freshCfg           둘 다 어긋난 경우
```
`b.cycle_id` 미전송(구버전 클라)은 통과시킨다 — ②가 잡는다.

### 경품
```
입찰 accepted 1회 이상 = 커피 추첨 자동 참여 (응모 행위 없음)
추첨 10명 · 1인 1추첨권 · 당첨자만 폼에 신청 → 운영자 대조 → 기프티콘
발표 전  Google Form 신청 비활성 · 안내문 "당첨자 발표 후 신청이 열립니다"
발표 후  당첨자만 수령 확인 코드 + 닉네임 + 휴대폰 번호로 신청
예측왕 3만원은 이번 3일 테스트에서 제외 (입장 시점이 제각각이라 사전 예측 불성립)
```
⚠️ 화면·광고에 **"응모하기" / "신청하기"** 라는 행동을 요구하지 말 것.
   입찰 1회 이상이면 자동 참여이므로 별도 행동이 필요한 것처럼 보이면 안 된다.
⚠️ 지급 완료 후 폼 응답 시트의 휴대폰 번호를 **실제로 삭제**할 것.

### 측정
```
cycle_id 는 서버 cfg 에서 찍는다 (클라이언트 값 의존 금지)
핵심 지표  (cycle_id, lot_no) 별 고유 입찰 세션 → 3명 이상 비율
사이클 잔존 = 한 세션이 몇 개 사이클에 걸쳐 입찰했는가 (재방문 대용)
```
⚠️ 대시보드는 아직 `round_id` 단일 차원이다. `cycle_id` 축 추가 필요.
⚠️ `COUNTA(#N/A)=1` 함정 — 고유 카운트는 `ROWS(UNIQUE(FILTER(...)))` 로.
⚠️ `session_id` 는 브라우저 단위. 실인원보다 많게, 재방문율은 낮게 나온다.

---

## 함정

| 증상 | 원인 |
|---|---|
| 고쳤는데 화면이 그대로 | 브라우저 캐시. `Ctrl+Shift+R` 또는 `?v=커밋해시` |
| 재배포 후 URL 변경 | `새 배포` 를 누른 것. 반드시 **배포 관리 → 연필 → 새 버전** |
| Claude 가 연 페이지가 빈 화면 | `document.hidden` 이면 폴링 정지. 확장 탭은 백그라운드 |
| Apps Script 편집기 자동화 실패 | SPA 가 `document_idle` 도달 안 함. **편집기는 사람이 직접** |
| 시트 자동 입력 시 한글 첫 글자 유실 | 편집 모드 전환 중 입력 유실. `F2` → `Ctrl+A` → 입력 |
| 시트에서 Tab 이 셀 이동 안 됨 | 한 셀에 전부 들어간다. 셀 단위로 입력 |
| `events` 값이 엉뚱한 열에 | 옛 `logEvent_` 가 위치 기반이었음. 지금은 헤더명 매핑 |
| PowerShell 로 한글 파일 편집 | 인코딩 깨짐. VS Code 등으로 |

---

## 참조

**저장소** `https://github.com/miname20002-cloud/dongne-auction` (Public)
**시트** `1oFnQ1Q0JuVQbLhOu-1cqosElMMOPfD2BRTqnSrK7I1Q` — events / lots / predictions / config / 대시보드

**Pages — 광고 연결 URL**
```
랜딩(광고 랜딩)  https://miname20002-cloud.github.io/dongne-auction/web/index.html
LIVE            https://miname20002-cloud.github.io/dongne-auction/web/live.html
경품 안내        https://miname20002-cloud.github.io/dongne-auction/web/result.html
```
⚠️ 광고는 **랜딩(index.html)** 으로 연결한다.

**Web App** (변경 없음)
```
https://script.google.com/macros/s/AKfycbyAk1IKlgPWLaL2dcsWcD9nUyt_tVZYdIpIRpKsyL3w9PajZmKKSYBHxlpOhkbYXSOG/exec
```

**상품 (KR-R2)**
```
LOT1  Nintendo Switch OLED          invalid_above 300,000
LOT2  AirPods 4 ANC                               210,000
LOT3  레고 K-POP 데몬 헌터스  demon.jpg            109,900  ⚠️ 임시값
      model: LEGO 72537 호랑이 더피와 까치 서씨
LOT4  Helinox Chair One                           115,000
LOT5  Stanley Quencher H2.0 1.18L                  35,000
```
⚠️ `109900` 은 공식가다. **실전 당일 실제 구매 가능 최저가로 재검증**할 것.

**편집기 함수**
`selfTest` · `checkCycle` · `checkIsMine` · `rankPredictions` · `testResult`
`testTime` · `openLot1` · `openLotN` · `nextLot` · `closeNow` · `resetAll` · `setupAdminToken`

**광고 (미착수)**
```
tt_switch_01  상품 후크    tt_1000_01  포맷 후크    tt_fast_01  속도·경쟁 후크
?src= 는 first-touch — 소재별 테스트는 다른 기기·브라우저로
```
⚠️ 광고 소재에서 **예측왕 3만원을 빼야 한다.** 이번 테스트에서 제외됐다.

---

## 테스트 종료 후에만 할 일 (지금 하지 않는다)

```
1  전체 광고 테스트 기간의 accepted 입찰 session_id 수집
2  session_id 중복 제거
3  무작위 10명 추첨
4  result.html 에 당첨자 발표 (#winners hidden 해제 + 닉네임 10개 입력)
5  Google Form 신청 활성화 (result.html 스크립트 상단 주석대로 복구)
6  당첨자 session_id / 닉네임 대조
7  기프티콘 발송
8  지급 완료 후 폼 응답 시트의 휴대폰 번호 삭제
```

⚠️ 추첨 기능은 **개발하지 않는다.** 위 1~3은 수동으로 처리한다.
⚠️ Apps Script 는 추가 수정하지 않는다. **실제 버그가 발견될 때만** 엔진 작업을 재개한다.

---

## 다음 세션 시작 방법

```
이 문서를 올린다 → "실제 광고 유입 테스트 및 지표 확인부터 시작하자"
```

엔진을 만질 일이 생겼을 때만 `docs\AppsScript_Code.gs` 를 추가로 올린다.
프론트를 만질 일이 생기면 `web\index.html` / `live.html` / `result.html` / `js\common.js`.

**권장 모델 티어**: 표준. 남은 것은 개발이 아니라 지표 확인이다.

[다음 작업 시작점]

> **실제 광고 유입 테스트 및 지표 확인**

- 광고는 랜딩(index.html)으로 연결
- 핵심 지표: (cycle_id, lot_no) 별 고유 입찰 세션 → 3명 이상 비율
- 사이클 잔존 = 한 세션이 몇 개 사이클에 걸쳐 입찰했는가
- 대시보드에 `cycle_id` 축 추가 필요 (아직 `round_id` 단일 차원)
- 개발 작업은 광고 시작 전 기준으로 완료 상태다
