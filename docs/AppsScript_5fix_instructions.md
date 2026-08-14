# Apps Script 백엔드 수정 지시서 — 5건

작성: 2026-08-14
대상 파일: `문서\GitHub\dongne-auction\docs\AppsScript_Code.gs` (실제 편집은 Apps Script 편집기)
전제: `common.js` apiGet의 `session` 파라미터는 이미 반영됨 (검수 1번 제외)

---

## 계약서

```
기능      : is_mine 승자 판정 정상화 + 운영자 명령 데이터 무결성 + 시간 정밀도 + 예측왕 집계 규칙
받는 것   : 기존과 동일 (state GET / admin POST). 새 파라미터 없음
주는 것   : 기존과 동일. state 응답에 필드 추가 없음
실패하면  : 재배포 전 버전으로 롤백. 시트 데이터는 lots 탭 복제본으로 복구
건드리는 것: selfTest / handleAdmin_(open,next) / doGet 응답 조립 / rankPredictions
            → LOT 전환, 결과 목록, 카운트다운, 예측왕 발표에 영향
비용      : 없음 (호출 수·저장량 변화 없음)
```

**위험도 🟡 중간** — 시트 스키마 1열 승격 + 서버 판정 로직.
**되돌리기 지점**: ① 현재 배포 버전 번호 기록 ② `lots` 탭 복제

---

## 원칙 (임의 변경 금지)

- 기존 API 필드·입찰 검증 순서·LockService·이벤트 로깅 구조는 그대로
- `invalid_above` / `model`은 계속 state 응답 비노출
- `_hs`는 서버 내부 전용, 응답 직전 제거 유지
- 전체 재작성 금지. **최소 diff만.**

---

## A. `holder_session` 필수 열 승격

**증상**: `✓ 내가 최고가`가 아무에게도 안 뜸.

**원인**: `applyMine_()`은 닉네임 폴백을 하지 않음.

```js
const hs = String(l._hs || '');
l.is_mine = Boolean(sid) && Boolean(hs) && hs === sid;
```

`holder_session` 열이 없으면 `hs`가 빈 문자열 → `Boolean(hs)`에서 항상 false.

**수정**
1. `selfTest()`의 `lots` 필수 열 배열에 `holder_session` 추가
2. `selfTest()` 안의 "holder_session 은 선택 열 — 없으면 닉네임 기준 폴백" 주석/분기 삭제
3. `applyMine_()`은 **변경하지 않음** (이미 올바름)

**닉네임 폴백을 되살리지 말 것.** 닉네임은 사용자가 바꿀 수 있어 승자 판정 근거가 될 수 없음.

**선행 확인**: 구글시트 `lots` 탭 헤더 행에 `holder_session` 열이 실제로 존재하는지.
없으면 열 추가 후 `resetAll` → 재테스트. (헤더가 1행이 아니라 2행인 함정 주의)

---

## B. `cmd=next` 조기 return

**현재**

```js
if(!nxt) return { ok:true, done:true };
...
return { ok:true, opened: num_(nxt.lot_no) };
```

이 두 return이 아래의 공통 마무리보다 먼저 실행됨.

```js
SpreadsheetApp.flush();
CacheService.getScriptCache().remove('state_' + cfg.market);
```

**결과**: `nextLot()` 직후 클라이언트가 캐시 TTL 동안 이전 LOT 상태를 계속 받음.

**수정**: 중간 return을 없애고 결과를 변수에 담아 공통 경로로 흘린다.

```
result = { ok:true, done:true }        // 또는 { ok:true, opened:... }
→ (공통) SpreadsheetApp.flush()
→ (공통) cache.remove('state_' + cfg.market)
→ return result
```

**`next`뿐 아니라 `open` / `close` / `reset`의 모든 성공 경로**가 flush + cache remove를 거치는지 함께 확인.

---

## C. `cmd=open` — 기존 onair를 닫을 때 `final_price` 누락

**결정: 거절하지 않는다.** 운영 중 `close → open` 2단계를 강제하는 것보다 `open LOT3` 한 번으로 끝나는 현재 동작성을 유지한다. 대신 무결성 처리를 추가한다.

**현재**

```js
inRound.forEach(r => {
  if(String(r.state).toLowerCase() === 'onair') setState(r, 'closed');
});
```

`final_price`를 안 쓰므로 결과 목록에서 그 LOT이 누락됨.

**수정 — 이 순서를 지킬 것**

```
1. 기존 onair LOT 발견
2. final_price = current_price  (0/빈값이면 cfg.start_price)   ← 먼저
3. state = closed                                              ← 나중
4. lot_closed 이벤트 로깅  (autoCloseExpired_ 와 동일 형태)
5. 새 LOT state = onair
6. 새 LOT close_at 설정
7. SpreadsheetApp.flush()
8. cache.remove('state_' + cfg.market)
```

2를 3보다 먼저 하는 이유: 중간에 실패해도 "closed인데 final_price 비어 있음"이 생기지 않게.

`lot_closed` 로깅은 `autoCloseExpired_()`에 이미 있는 형태를 그대로 재사용 (`event_type`, `amount`, `nickname`, `round_id`, `market`, `currency`).

### C-2. 여는 대상 LOT의 상태 검사 (범위 추가)

현재 `open`은 `find(b.lot_no)`만 하고 대상 LOT이 `wait`인지 확인하지 않는다.
운영 실수로 **이미 끝난 LOT을 다시 열면 `final_price`가 덮어써진다.**

1~7 처리 **이전**에 가드를 넣는다.

```js
if(String(lot.state).toLowerCase() === 'closed')
  return { ok:false, error:'lot_already_closed' };
```

- Phase 0에서는 closed LOT 재오픈을 막는 쪽이 데이터 무결성에 유리
- 재오픈을 운영 기능으로 쓸 계획이면 이 항목만 빼면 됨
- `lot_already_closed`는 **운영자 응답 전용** — 입찰 거절 사유가 아니므로
  `common.js`의 `REJECT_MSG`에 추가하지 않는다 (사용자 화면에 뜰 일 없음)

---

## D. 캐시된 `server_time` 재사용

**현재**: `buildState_()`가 `server_time: nowIso_()`를 만들고 state 전체를 2초 캐시.
캐시 hit이면 최대 2초 오래된 시각이 내려감.

**영향**: 클라이언트가 `SERVER_OFFSET = serverTime - Date.now()`로 재계산하므로
브라우저 시계를 서버보다 최대 2초 느리다고 잘못 동기화. 30초 연장 경매에서 치명적.

**수정**: 캐시 원본은 건드리지 않고, `doGet()` 응답 조립 마지막 단계에서 덮어쓴다.

```
캐시 get/miss → (필요시 buildState_) → applyMine_() → _hs 제거
→ out.server_time = nowIso_();          ← 여기. 매 GET마다 fresh
→ return
```

`buildState_()` 안의 `server_time`은 그대로 둬도 무방 (어차피 덮어씀).

**캐시 TTL 조정**: onair LOT 존재 시 1초 / 그 외 2초.
`autoCloseExpired_()`가 이미 1초 가드를 쓰고 있으므로 충돌하지 않는지 확인.

---

## E. `rankPredictions()` — 회차 예측왕 1명

**결정: 예측왕은 round 전체 1명.** 주간 랭킹은 별도 집계이며 `predictions.rank`를 겸용시키지 않는다.

```
오늘의 예측왕 = 해당 round 전체 predictions 중 최종가 절대오차 최소 1건
주간 랭킹     = 월~일 여러 round 누적 (추후 별도 기능)
```

**현재**: `byLot[lot_no]`로 나눈 뒤 LOT마다 rank → 5 LOT이면 `rank=1`이 5명.

**수정**
1. `byLot` 분할 제거. 해당 `round_id`의 prediction을 하나의 배열로 통합
2. `diff = Math.abs(predicted_price - final_price)`
3. **`final_price`가 없는 LOT의 prediction은 집계에서 제외** (열리지 않은 LOT이 오차 0으로 잡히는 것 방지)
4. 정렬: `diff` 오름차순 → 동률이면 `ts_server` 오름차순 → 그래도 동률이면 시트 행 순서(제출 순)
5. `rank`는 1..N 통합 부여

세 번째 tie-breaker까지 넣는 이유: `ts_server`가 초 단위로 잘려 저장되면 동시 제출이 실제로 발생함.
경품 규정은 1회차 시작 전 고정 — 실험 중 바꾸면 데이터가 오염된다.

### E-2. 확정 원칙 — 집계 단위는 "사용자"가 아니라 "예측 1건"

5개 LOT을 모두 예측한 A는 예측권 5장, 1개만 낸 B는 1장이다.
**이건 버그가 아니라 의도된 설계다.** "하나만 입력해도 되고, 여러 상품도 가능하며,
가장 가까운 사전 예측값이 예측왕"이라는 확정 규칙과 일치한다.

**나중에 "사용자별 평균오차"로 바꾸지 않는다.**
평균오차는 많이 참여할수록 불리해져, 핵심 KPI인 **1인당 참여 LOT 수**를 억제한다.
Phase 0의 목적은 공정한 대회 운영이 아니라 참여 행동 측정이다.

> 뒤집을 조건: 1인이 전 LOT을 싹쓸이 예측해 예측왕이 고정되는 패턴이 2회차 이상 반복될 때.

---

## 재배포

```
배포 → 배포 관리 → 연필(편집) → 버전: 새 버전 → 배포
```

⚠️ **`새 배포`를 누르면 URL이 바뀌어 `common.js`도 고쳐야 함.**

---

## 검수 대본

### 🟢 직접 확인

- [ ] `selfTest()` 실행 → 전체 통과. `holder_session` 누락 시 **실패로 표시되는지** (일부러 열 이름을 바꿔 한 번 실패시켜 볼 것)
- [ ] `resetAll` → `openLot1` → 일반창/시크릿창 A·B 입찰
- [ ] **승자 브라우저에만 `✓ 내가 최고가`** — 이게 이번 수정의 핵심 통과 기준
- [ ] `openLot1` 상태에서 곧바로 `open LOT2` 실행 → 시트 `lots`에서 **LOT1의 `final_price`가 채워져 있는지**
- [ ] `nextLot()` 직후 **다음 LIVE 폴링 1회 안에** 새 LOT으로 전환 — 체감 3~5초.
      LIVE 폴링이 3초(`CONFIG.POLL.live`)라 "3초 이내"는 정상도 실패로 잡힘.
      **핵심은 여기에 캐시로 2초가 더 붙지 않는 것**

### 🟡 방법 알려주면 확인

- [ ] **is_mine 원본 확인**: F12 → Network → `exec?action=state...` 클릭 → Response에서 해당 LOT의 `is_mine`.
      승자 창 `true` / 패자 창 `false`. 화면 배지보다 이게 정확함
- [ ] **server_time 신선도**: **1초 이상 간격을 두고** 2~3회 요청 → `server_time`이 진행되는지 확인.
      **2초 이상 과거 값이 반복되면 실패.**
      ⚠️ `nowIso_()`는 초 단위(`...:ssXXX`)라 연속 요청 시 같은 값이 나오는 건 정상.
      "매번 달라야 한다"로 판정하면 정상 코드를 실패로 오판함
- [ ] **응답에 운영자 데이터 없음**: 같은 Response를 Ctrl+F로 `invalid_above`, `model`, `_hs` 검색 → 0건

### 🔴 확인 불가 (구현자가 근거를 낼 것)

- [ ] `open`/`close`/`next`/`reset` **모든 성공 경로**가 flush + cache remove를 거치는지 → 코드 경로 목록으로 근거 제출
- [ ] `rankPredictions()` 결과가 `rank=1` **정확히 1건**인지 → 실행 후 `predictions` 탭 rank 열 분포로 근거 제출

### 회귀 (이번 변경이 깨뜨릴 수 있는 것)

- [ ] 30초 연장 — 남은 시간 20초에 입찰 → 30초 복구 (D의 캐시 TTL 변경이 닿는 표면)
- [ ] 무효선 초과 거절 — 900,000 입찰 → "입찰 상한선을 넘었습니다"
- [ ] 거절 로그 — `events`에 `accepted=FALSE` + `reject_reason` 기록
- [ ] LOT 만료 자동 마감 (`autoCloseExpired_`) — C·D와 같은 표면을 건드림
- [ ] LOT 5 완주 → `phase=ended` 도달
