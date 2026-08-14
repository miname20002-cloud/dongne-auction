# 동네옥션 Phase 0 — 인계 문서

작성: 2026-08-14 (2차)
이전 인계 문서를 이 문서로 **교체**합니다.

---

## ⚠️ 시작 전에 — 파일은 창을 넘지 않습니다

인계 문서는 넘어가지만 **작업 파일은 창이 바뀌면 사라집니다.**
지난 창에서 이걸 몰라 3턴을 왕복했습니다.

**새 창 첫 행동: 아래 3개를 함께 올릴 것.**

```
docs\AppsScript_Code.gs                    ← 없으면 아무 작업도 못 합니다
docs\AppsScript_5fix_instructions.md       ← 이번 작업 지시서 (확정본)
web\js\common.js
```

`.gs`는 `docs\` 백업본보다 **Apps Script 편집기의 현행본**이 정확합니다.

---

## 확인 (지금 상태)

Phase 0 엔진은 관통 테스트를 통과했습니다.
2세션 경쟁입찰 · 30초 자동연장 · 무효선 거절 · LOT 01→02 전환 모두 확인됨.

**이번 창의 결과물은 코드가 아니라 설계 확정입니다.**
백엔드 수정 5건이 지시서로 확정됐고, `result.html`의 전제가 전부 닫혔습니다.
**아직 코드는 한 줄도 안 고쳤습니다.**

---

## 확정 (뒤집으면 안 되는 것)

이전 인계 문서의 절대 원칙은 **전부 유효**합니다. 아래는 이번 창에서 추가된 것.

| 항목 | 확정 | 뒤집을 조건 |
|---|---|---|
| `open`이 onair를 만나면 | 거절 아님. `final_price` 기록 후 안전 종료하고 진행 | 오조작으로 LOT 유실 발생 시 |
| closed LOT 재오픈 | 차단 (`lot_already_closed`) | 재오픈을 운영 기능으로 쓸 경우 |
| 예측왕 | 회차 전체 **1명**. 집계 단위는 **예측 1건** (사용자 아님) | 1인 싹쓸이로 예측왕 고정이 2회차 이상 반복 |
| 예측왕 동률 | `diff` → `ts_server` → 시트 행 순서 | 없음 (1회차 전 고정) |
| 주간 랭킹 | `predictions.rank`와 **분리**. 별도 집계 | 없음 |
| `my_result` 공급 | `action=result` **별도 엔드포인트**. `state` 캐시와 분리 | 없음 |
| 등급 분모 | 해당 회차 `s.lots.length` (종료된 LOT 수 아님) | 없음 |
| `bid_count` | 서버 계산은 하되 **사용자 응답에 비노출** | 없음 |
| 상품 자동수집 파이프라인 | **보류.** 저작권·약관 위험 + 본사업 미연결 | 주 3회 이상 회차 / 미스터리박스 전환 시 |

### 등급 6단계 (확정)

| 등급 | 기준 | 5 LOT | 10 LOT |
|---|---|---|---|
| WATCHER | accepted 입찰 0회 | — | — |
| ROOKIE | accepted 입찰 ≥1, 최고가 0개 | 0/5 | 0/10 |
| BIDDER | 최고가 >0% ~ 40% | 1~2 | 1~4 |
| HUNTER | >40% ~ 60% | 3 | 5~6 |
| ACE | >60% ~ <100% | 4 | 7~9 |
| SWEEP | 100% | 5 | 10 |

거절된 입찰(`accepted=FALSE`)은 **참여로 계산하지 않음** — 어뷰징으로 ROOKIE 획득 방지.

### `action=result` 응답 형태

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

`prediction_winner`는 **항상 객체 1건**. 동률이어도 배열로 만들지 않는다 (서버가 tie-breaker로 1건 확정).

---

## 다음 첫 행동 — 10단계

```
1  시트 lots 탭에 holder_session 열 존재 확인   ← 없으면 열 추가 후 resetAll
2  Apps Script A~E 5건 수정 (지시서대로, 최소 diff)
3  배포 → 배포 관리 → 연필 → 새 버전 → 배포     ← "새 배포" 누르면 URL 바뀜
4  selfTest() 전체 통과
5  일반창 A / 시크릿창 B로 LOT 1 경쟁입찰
6  승자 is_mine:true / 패자 false  (F12 Network Response에서 확인)
7  open LOT2 강제전환 → LOT1의 final_price + holder_session 둘 다 확인
8  30초 연장 회귀 (남은 20초에 입찰)
9  events 확인: session_id 값 + accepted=FALSE + reject_reason 6종
   ※ bad_unit(1,500원) / rate_limit(연타)은 일부러 만들어야 뜸
10 LOT 5까지 완주 → phase=ended
```

**7번이 이번 수정의 핵심 통과 기준입니다.** closed LOT에서 `is_mine`이 유지돼야 `result.html`의 등급 계산이 성립합니다.

통과하면 → `action=result` 엔드포인트 → `result.html`.

---

## 미완료

### result.html (백엔드 통과 직후)
- [ ] `action=result` 엔드포인트 신설
- [ ] 화면: 전체 LOT 최종가 / 내가 최고가였던 LOT / `n / 전체` / 등급 / 예측왕 / 다음 회차 안내
- [ ] `index.html`의 `ended` CTA를 `result.html`로 연결 (현재 `live.html`)

### 그 다음
- [ ] GitHub Pages 배포 — 지금 `file://`로만 테스트. **모바일 미검증**
- [ ] LEGO SKU 확정 + 가격 검증
- [ ] 상품 이미지 정규화 (1:1 · 흰 배경 · 여백 10%) — 자동수집 없이 수동 5장만
- [ ] 리허설 9항목
- [ ] 광고 소재 3~4종 (`?src=` 분리, **"모의경매" 고지 필수**)
- [ ] 주간 랭킹 + 일요일 추첨 — 경품 규정은 1회차 시작 **전** 고정. 시크릿창 어뷰징 대책 필요

---

## 회귀 목록 (매번 확인)

- 30초 연장 — 남은 20초 입찰 → 30초 복구
- 무효선 초과 거절 — 900,000 → "입찰 상한선을 넘었습니다"
- `nextLot()` 후 다음 폴링 1회 안에 전환 (캐시 2초가 더 붙지 않는지)
- `open` 강제전환 시 이전 LOT의 `final_price` + `holder_session` 보존
- closed LOT에서 `is_mine` 유지
- `server_time` 신선도 — **1초 이상 간격** 요청 시 진행되는지
- LOT 5 완주 → `phase=ended`

---

## 함정

기존 목록에 이번 창에서 추가된 2개.

| 증상 | 원인 |
|---|---|
| **파일이 있다고 착각** | 창이 바뀌면 컨테이너 초기화. 인계 문서만 넘어감 |
| **검수 기준이 정상을 실패로 오판** | `nowIso_()`는 초 단위 · 폴링은 3초. **상수를 먼저 확인하고 기준을 쓸 것** |
| 시트를 못 찾음 | Apps Script가 독립 프로젝트 / 헤더가 1행이 아니라 2행 |
| 한글 깨짐 | PowerShell `Set-Content`가 인코딩 변경. **PS로 한글 파일 고치지 말 것** |
| 타이머 멈춤 | JS 문법 오류 1개로 스크립트 전체 정지. **`node --check` 필수** |
| 이미지 안 뜸 | 파일이 Downloads에 있음 / 0바이트 가짜 jpg |
| 55시간 카운트다운 | 타임존(`+09:00`) 누락 |

---

## 백엔드 참조

**시트**: `1oFnQ1Q0JuVQbLhOu-1cqosElMMOPfD2BRTqnSrK7I1Q` — `events` / `lots` / `predictions` / `config`

**Web App**
```
https://script.google.com/macros/s/AKfycbyAk1IKlgPWLaL2dcsWcD9nUyt_tVZYdIpIRpKsyL3w9PajZmKKSYBHxlpOhkbYXSOG/exec
```

**테스트 함수**: `setupAdminToken` / `selfTest` / `testTime` / `openLot1` / `nextLot` / `closeNow` / `resetAll`

**상품 (KR-R1)**: Switch OLED 299,000(무효선 300,000) · AirPods 4 ANC 205,000(210,000) · LEGO 미확정 · Helinox Chair One 115,000(115,000) · Stanley Quencher 35,000(35,000)
전부 1,000원 START · 1,000원 단위 자유입찰 · 마감 30초 내 입찰 시 30초 연장

---

**권장 모델 티어**: 표준. 5건 전부 위치와 방향이 확정돼 판단이 아니라 구현만 남았습니다.
