/**
 * ══════════════════════════════════════════════════════════
 *  동네옥션 Phase 0 — 웹 모의경매 백엔드
 *  Google Apps Script Web App
 * ══════════════════════════════════════════════════════════
 *
 *  배포 방법
 *  1. 시트 열기 → 확장 프로그램 → Apps Script
 *  2. 이 코드 전체 붙여넣기
 *  3. setupAdminToken() 을 최초 1회 실행
 *     → 실행 로그에 출력된 ADMIN_TOKEN 을 안전한 곳에 보관
 *  4. 배포 → 새 배포 → 유형: 웹 앱
 *     - 실행 사용자: 나
 *     - 액세스 권한: 모든 사용자
 *  5. 발급된 URL을 프론트 CONFIG.API_URL 에 입력
 *
 *  ⚠️ 코드를 수정할 때마다 "새 배포"를 해야 반영됩니다.
 *     (기존 배포 수정 시 URL 유지하려면 "배포 관리 → 편집 → 버전: 새 버전")
 *
 *  ── 2026-08-14 수정 5건 ──
 *  A. lots.holder_session 필수 열 승격 (닉네임 폴백 제거)
 *  B. admin next 의 조기 return 제거 → 모든 성공 경로가 flush + cache remove
 *  C. admin open 이 기존 onair 를 닫을 때 final_price 기록 + closed 재오픈 차단
 *  D. 캐시된 server_time 재사용 금지 → 응답 직전 fresh 값으로 덮어씀
 *  E. rankPredictions 를 회차 전체 통합 순위로 변경 (예측왕 1명)
 *  F. action=result 신설 — 회차 성적표 (읽기 전용 • 시트 쓰기 0건)
 * ══════════════════════════════════════════════════════════
 */

const SHEET_ID = '1oFnQ1Q0JuVQbLhOu-1cqosElMMOPfD2BRTqnSrK7I1Q';

/**
 * 관리자 토큰은 코드가 아니라 스크립트 속성에 저장합니다.
 * 최초 1회: setupAdminToken() 을 실행하면 임의 토큰이 생성되고 로그에 찍힙니다.
 * (코드를 공유하거나 복사해도 토큰이 새어나가지 않습니다)
 */
function adminToken_(){
  return PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || '';
}
function setupAdminToken(){
  const t = Utilities.getUuid().replace(/-/g,'');
  PropertiesService.getScriptProperties().setProperty('ADMIN_TOKEN', t);
  Logger.log('ADMIN_TOKEN 생성됨 — 안전한 곳에 보관하세요:\n' + t);
  return t;
}

const S_EVENTS = 'events';
const S_LOTS   = 'lots';
const S_PRED   = 'predictions';
const S_CONFIG = 'config';

const STATE_CACHE_SEC      = 2;   // state 응답 캐시 (폴링 부하 완화)
const STATE_CACHE_LIVE_SEC = 1;   // ⚠️ D) LIVE 중에는 짧게 — 30초 연장 정밀도
const RATE_LIMIT_MS        = 1000;   // 같은 세션 최소 입찰 간격
const LOCK_WAIT_MS         = 10000;

/* ══════════════════ 유틸 ══════════════════ */

function ss_(){ return SpreadsheetApp.openById(SHEET_ID); }
function sheet_(name){
  const sh = ss_().getSheetByName(name);
  if(!sh) throw new Error('시트 없음: ' + name + ' (탭 이름을 정확히 확인하세요)');
  return sh;
}

/** 시트를 [{헤더:값}] 배열로 */
function readTable_(name){
  const sh = sheet_(name);
  const vals = sh.getDataRange().getValues();
  if(vals.length < 2) return { head: vals[0] || [], rows: [] };
  const head = vals[0].map(h => String(h).trim());
  const rows = [];
  for(let i = 1; i < vals.length; i++){
    const o = { _row: i + 1 };
    head.forEach((h, j) => { o[h] = vals[i][j]; });
    rows.push(o);
  }
  return { head, rows };
}

function colIndex_(head, name){
  const i = head.indexOf(name);
  if(i < 0) throw new Error('열 없음: ' + name);
  return i + 1;
}

function nowIso_(){
  return Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function toDate_(v){
  if(!v) return null;
  if(v instanceof Date) return v;
  const d = new Date(String(v).trim());
  return isNaN(d) ? null : d;
}

function num_(v){
  if(v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
}

function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ══════════════════ 이벤트 로깅 ══════════════════ */

function logEvent_(p){
  try{
    const sh = sheet_(S_EVENTS);
    const lastCol = sh.getLastColumn();
    if(lastCol < 1){
      console.error('logEvent 실패: events 헤더 없음');
      return;
    }
    /* ⚠️ 헤더 1행만 읽는다. 위치 기반 appendRow 로 되돌리지 말 것 */
    const head = sh.getRange(1, 1, 1, lastCol)
                   .getValues()[0]
                   .map(h => String(h).trim());
    /*
     * ⚠️ 헤더 순서에 의존하지 않는다.
     * 과거 appendRow([A,B,C...]) 방식은 시트 열을 재배치해도 selfTest(열 존재)에는
     * 통과하지만 값이 다른 컬럼에 들어가 has_bid 같은 집계가 조용히 깨질 수 있었다.
     * 이제 현재 헤더 이름에 맞춰 행을 만든다.
     */
    const id = 'evt_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12);
    const data = {
      event_id     : id,
      ts_server    : nowIso_(),
      session_id   : p.session_id || '',
      nickname     : p.nickname || '',
      event_type   : p.event_type || '',
      lot_no       : p.lot_no === undefined || p.lot_no === null ? '' : p.lot_no,
      amount       : p.amount === undefined || p.amount === null ? '' : p.amount,
      accepted     : p.accepted ? 'TRUE' : 'FALSE',
      reject_reason: p.reject_reason || '',
      src          : p.src || '',
      campaign     : p.campaign || '',
      ua_type      : p.ua_type || '',
      round_id     : p.round_id || '',
      market       : p.market || '',
      locale       : p.locale || '',
      currency     : p.currency || ''
    };
    sh.appendRow(head.map(h => Object.prototype.hasOwnProperty.call(data, h) ? data[h] : ''));
  }catch(err){
    console.error('logEvent 실패:', err);   // 로깅 실패가 요청을 막지 않게
  }
}

/* ══════════════════ config / lots ══════════════════ */

function getRound_(market){
  const { rows } = readTable_(S_CONFIG);
  const m = String(market || 'KR').toUpperCase();
  /* ⚠️ fallback 금지 — 다른 시장의 라운드로 넘어가면
     $1 START 인 US 클라이언트가 KRW 라운드에 붙는 사고가 난다 */
  const r = rows.filter(x => String(x.market).toUpperCase() === m &&
                             String(x.active).toUpperCase() === 'TRUE')[0];
  if(!r) throw new Error('활성 라운드 없음: ' + m +
    ' (config 에서 market=' + m + ' 이고 active=TRUE 인 행이 필요합니다)');
  return {
    round_id     : String(r.round_id),
    market       : String(r.market).toUpperCase(),
    currency     : String(r.currency || 'KRW'),
    timezone     : String(r.timezone || 'Asia/Seoul'),
    locale_default: String(r.locale_default || 'ko'),
    start_price  : num_(r.start_price) || 1000,
    min_unit     : num_(r.min_unit) || 1000,
    predict_close: toDate_(r.predict_close_at),
    auction_start: toDate_(r.auction_start_at),
    lot_duration : num_(r.lot_duration_sec) || 120,
    extend_sec   : num_(r.extend_sec) || 30
  };
}

function getLots_(round_id){
  const { rows } = readTable_(S_LOTS);
  return rows
    .filter(x => String(x.round_id) === String(round_id))
    .sort((a, b) => (num_(a.order_no) || 0) - (num_(b.order_no) || 0));
}

/**
 * phase 정의 — LOT state 와 시각의 책임을 분리한다.
 *
 *  predict  예측 접수 중          (now < predict_close_at)
 *  closing  예측 마감 • 시작 대기  (predict_close ≤ now < auction_start)
 *  standby  시작 시각은 지났으나 운영자가 아직 LOT 을 열지 않음
 *  live     onair LOT 이 있음
 *  ended    남은 wait 도 onair 도 없음
 *
 *  ⚠️ 'live' 는 오직 onair LOT 이 있을 때만. 시각만으로 live 로 만들지 않는다.
 */
function phaseOf_(cfg, lots){
  const now = new Date();
  const st = l => String(l.state).toLowerCase();
  const anyOnair = lots.some(l => st(l) === 'onair');
  const anyWait  = lots.some(l => st(l) === 'wait');

  if(anyOnair) return 'live';
  if(lots.length > 0 && !anyWait) return 'ended';
  if(cfg.auction_start && now >= cfg.auction_start) return 'standby';
  if(cfg.predict_close && now >= cfg.predict_close) return 'closing';
  return 'predict';
}

/* ══════════════════ GET — state ══════════════════ */

function doGet(e){
  try{
    const p = e && e.parameter ? e.parameter : {};
    const action = p.action || 'state';
    /* ⚠️ F) 회차 성적표. state 와 분리된 별도 경로 —
       state 는 공통 캐시, result 는 세션별 집계라 캐시를 공유하지 않는다. */
    if(action === 'result'){
      return json_(buildResult_((p.market || 'KR').toUpperCase(), String(p.session || '')));
    }
    if(action !== 'state') return json_({ ok:false, error:'unknown_action' });

    const market = (p.market || 'KR').toUpperCase();
    const sid    = String(p.session || '');
    const cache  = CacheService.getScriptCache();

    /* 공통 상태는 캐시하고, is_mine 판정만 요청 세션별로 덧입힌다.
       (세션별 전체 캐시는 메모리 낭비 + 무효화가 어려움) */
    const key = 'state_' + market;
    let base;
    const hit = cache.get(key);
    if(hit){
      base = JSON.parse(hit);
    }else{
      base = buildState_(market);
      /* ⚠️ D) LIVE 중에는 캐시를 1초로 — 마감 임박 구간에서 2초는 너무 길다 */
      cache.put(key, JSON.stringify(base),
        base.phase === 'live' ? STATE_CACHE_LIVE_SEC : STATE_CACHE_SEC);
    }

    const out = applyMine_(base, sid);

    /* ⚠️ D) 캐시 hit 이면 base.server_time 은 최대 2초 전 값이다.
       클라이언트가 이 값으로 SERVER_OFFSET 을 계산하므로
       응답 직전에 반드시 fresh 값으로 덮어쓴다. */
    out.server_time = nowIso_();

    return ContentService.createTextOutput(JSON.stringify(out))
                         .setMimeType(ContentService.MimeType.JSON);
  }catch(err){
    return json_({ ok:false, error:String(err) });
  }
}

/**
 * close_at 이 지난 onair LOT 을 서버가 자동으로 마감한다.
 * doGet 폴링 중 호출되므로 (a) 짧은 tryLock 으로 대기하지 않고
 * (b) 캐시 가드로 중복 시도를 막는다.
 * @return {boolean} 마감이 실제로 일어났으면 true
 */
function autoCloseExpired_(cfg){
  const cache = CacheService.getScriptCache();
  const gkey = 'ac_' + cfg.round_id;
  if(cache.get(gkey)) return false;          // 1초 내 이미 시도함
  cache.put(gkey, '1', 1);

  const lots = getLots_(cfg.round_id);
  const now = new Date();
  const expired = lots.filter(l => {
    if(String(l.state).toLowerCase() !== 'onair') return false;
    const c = toDate_(l.close_at);
    return c && now >= c;
  });
  if(!expired.length) return false;

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(2000)) return false;       // 입찰 처리 중이면 다음 폴링에서
  try{
    const sh = sheet_(S_LOTS);
    const { head, rows } = readTable_(S_LOTS);
    let changed = false;

    expired.forEach(x => {
      const l = rows.filter(r => r._row === x._row)[0];
      if(!l || String(l.state).toLowerCase() !== 'onair') return;   // 재확인
      const c = toDate_(l.close_at);
      if(!c || new Date() < c) return;                              // 연장됐으면 취소

      /* final_price 를 먼저 기록하고 state 를 나중에 닫는다.
         중간 실패 시 closed 인데 final_price 가 빈 행이 남는 것을 방지한다. */
      sh.getRange(l._row, colIndex_(head,'final_price'))
        .setValue(num_(l.current_price) || cfg.start_price);
      sh.getRange(l._row, colIndex_(head,'state')).setValue('closed');
      changed = true;

      logEvent_({
        event_type:'lot_closed', lot_no:num_(l.lot_no),
        amount:num_(l.current_price) || cfg.start_price,
        nickname:String(l.current_holder || ''), accepted:true,
        round_id:cfg.round_id, market:cfg.market, currency:cfg.currency
      });
    });

    if(changed){
      SpreadsheetApp.flush();
      cache.remove('state_' + cfg.market);
    }
    return changed;
  }finally{
    lock.releaseLock();
  }
}

/**
 * 요청 세션과 각 LOT 의 최고가 세션을 서버에서 비교해 is_mine 을 붙이고,
 * 내부 식별자(_hs)는 응답에서 제거한다.
 * → 다른 사용자의 session_id 는 절대 클라이언트로 나가지 않는다.
 *
 * ⚠️ A) 닉네임 폴백은 없다. holder_session 이 비면 is_mine 은 항상 false.
 *    closed LOT 에서도 holder_session 이 보존되어야 result 의 등급 계산이 성립한다.
 */
function applyMine_(base, sid){
  const out = JSON.parse(JSON.stringify(base));   // 캐시 원본 훼손 방지
  const mark = l => {
    if(!l) return l;
    const hs = String(l._hs || '');
    l.is_mine = Boolean(sid) && Boolean(hs) && hs === sid;
    delete l._hs;
    return l;
  };
  if(out.lots) out.lots = out.lots.map(mark);
  if(out.current_lot) out.current_lot = mark(out.current_lot);
  return out;
}

function buildState_(market){
  const cfg = getRound_(market);
  autoCloseExpired_(cfg);                     // ← 상태 조회 시마다 만료 LOT 정리
  const lots = getLots_(cfg.round_id);
  const phase = phaseOf_(cfg, lots);
  const now = new Date();

  const cur = lots.filter(l => String(l.state).toLowerCase() === 'onair')[0] || null;

  /* ⚠️ invalid_above / model 은 절대 응답에 넣지 않는다 */
  const pub = l => ({
    lot_no      : num_(l.lot_no),
    display_name: String(l.display_name || ''),
    image       : String(l.image || ''),
    state       : String(l.state || 'wait').toLowerCase(),
    current_price: num_(l.current_price) || cfg.start_price,
    bid_count   : num_(l.bid_count) || 0,
    final_price : num_(l.final_price) || 0,
    /* 최고가 사용자 닉네임 — 익명 식별자라 노출 무방 */
    winner : String(l.current_holder || ''),
    /* ⚠️ _hs 는 서버 내부 판정용. applyMine_() 에서 반드시 제거된다. */
    _hs    : String(l.holder_session || '')
  });

  let current = null;
  if(cur){
    const closeAt = toDate_(cur.close_at);
    current = Object.assign(pub(cur), {
      current_holder: String(cur.current_holder || ''),
      close_at      : closeAt ? closeAt.toISOString() : null,
      seconds_left  : closeAt ? Math.max(0, Math.floor((closeAt - now)/1000)) : null
    });
  }

  return {
    ok: true,
    round_id : cfg.round_id,
    market   : cfg.market,
    currency : cfg.currency,
    timezone : cfg.timezone,
    start_price: cfg.start_price,
    min_unit : cfg.min_unit,
    /* LIVE 원형 게이지의 기준시간. config.lot_duration_sec 원본값을 공개한다. */
    lot_duration: cfg.lot_duration,
    server_time: nowIso_(),   /* ⚠️ D) 캐시될 수 있으므로 doGet 에서 덮어쓴다 */
    phase: phase,
    predict_close_at: cfg.predict_close ? cfg.predict_close.toISOString() : null,
    auction_start_at: cfg.auction_start ? cfg.auction_start.toISOString() : null,
    current_lot: current,
    lots: lots.map(pub)
  };
}

/* ══════════════════ POST ══════════════════ */

function doPost(e){
  let body = {};
  try{
    body = JSON.parse(e.postData.contents);
  }catch(err){
    return json_({ ok:false, error:'bad_json' });
  }

  try{
    switch(body.action){
      case 'session': return json_(handleSession_(body));
      case 'view':    return json_(handleView_(body));
      case 'predict': return json_(handlePredict_(body));
      case 'bid':     return json_(handleBid_(body));
      case 'admin':   return json_(handleAdmin_(body));
      default:        return json_({ ok:false, error:'unknown_action' });
    }
  }catch(err){
    console.error(err);
    return json_({ ok:false, error:String(err) });
  }
}

/* ── session ── */
function handleSession_(b){
  const cfg = getRound_(b.market);
  logEvent_({
    session_id:b.session_id, event_type:'landing',
    accepted:true, src:b.src, campaign:b.campaign, ua_type:b.ua_type,
    round_id:cfg.round_id, market:cfg.market,
    locale:b.locale || cfg.locale_default, currency:cfg.currency
  });
  return { ok:true, round_id:cfg.round_id, market:cfg.market };
}

/* ── view — 페이지 진입 (predict_view / view_live / result_view) ── */
function handleView_(b){
  const cfg = getRound_(b.market);
  const allow = ['predict_view','view_live','result_view'];
  const t = String(b.view_type || '');
  if(allow.indexOf(t) < 0) return { ok:false, error:'bad_view_type' };

  logEvent_({
    session_id:b.session_id, nickname:b.nickname, event_type:t,
    accepted:true, src:b.src, campaign:b.campaign, ua_type:b.ua_type,
    round_id:cfg.round_id, market:cfg.market,
    locale:b.locale || cfg.locale_default, currency:cfg.currency
  });
  return { ok:true };
}

/* ── predict ── */
function handlePredict_(b){
  const cfg = getRound_(b.market);
  const now = new Date();
  const amount = num_(b.amount);

  const base = {
    session_id:b.session_id, nickname:b.nickname, event_type:'predict',
    lot_no:b.lot_no, amount:amount, src:b.src, campaign:b.campaign,
    ua_type:b.ua_type, round_id:cfg.round_id, market:cfg.market,
    locale:b.locale || cfg.locale_default, currency:cfg.currency
  };

  if(cfg.predict_close && now >= cfg.predict_close){
    logEvent_(Object.assign({}, base, { accepted:false, reject_reason:'not_open' }));
    return { ok:false, reason:'not_open' };
  }
  if(!amount || amount <= 0){
    logEvent_(Object.assign({}, base, { accepted:false, reject_reason:'bad_amount' }));
    return { ok:false, reason:'bad_amount' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try{
    const sh = sheet_(S_PRED);
    const { head, rows } = readTable_(S_PRED);
    const exist = rows.filter(r =>
      String(r.round_id) === cfg.round_id &&
      String(r.session_id) === String(b.session_id) &&
      String(r.lot_no) === String(b.lot_no))[0];

    if(exist){
      sh.getRange(exist._row, colIndex_(head,'predicted_price')).setValue(amount);
      sh.getRange(exist._row, colIndex_(head,'ts_server')).setValue(nowIso_());
      sh.getRange(exist._row, colIndex_(head,'nickname')).setValue(b.nickname || '');
    }else{
      const row = head.map(h => {
        switch(h){
          case 'round_id': return cfg.round_id;
          case 'market': return cfg.market;
          case 'currency': return cfg.currency;
          case 'session_id': return b.session_id || '';
          case 'nickname': return b.nickname || '';
          case 'lot_no': return b.lot_no;
          case 'predicted_price': return amount;
          case 'ts_server': return nowIso_();
          default: return '';
        }
      });
      sh.appendRow(row);
    }
  }finally{
    lock.releaseLock();
  }

  logEvent_(Object.assign({}, base, { accepted:true }));
  return { ok:true };
}

/* ── bid ── */
function handleBid_(b){
  const cfg = getRound_(b.market);
  const amount = num_(b.amount);

  const base = {
    session_id:b.session_id, nickname:b.nickname, event_type:'bid',
    lot_no:b.lot_no, amount:amount, src:b.src, campaign:b.campaign,
    ua_type:b.ua_type, round_id:cfg.round_id, market:cfg.market,
    locale:b.locale || cfg.locale_default, currency:cfg.currency
  };
  const reject = reason => {
    logEvent_(Object.assign({}, base, { accepted:false, reject_reason:reason }));
    return { ok:false, reason:reason };
  };

  /* 레이트 리밋 — 락 밖에서 먼저 */
  const cache = CacheService.getScriptCache();
  const rkey = 'rl_' + (b.session_id || 'anon');
  const prev = cache.get(rkey);
  if(prev && (Date.now() - Number(prev)) < RATE_LIMIT_MS) return reject('rate_limit');
  cache.put(rkey, String(Date.now()), 30);

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(LOCK_WAIT_MS)) return reject('busy');

  try{
    const sh = sheet_(S_LOTS);
    const { head, rows } = readTable_(S_LOTS);
    const lot = rows.filter(r =>
      String(r.round_id) === cfg.round_id &&
      String(r.lot_no) === String(b.lot_no))[0];

    if(!lot) return reject('no_lot');
    if(String(lot.state).toLowerCase() !== 'onair') return reject('not_open');

    const now     = new Date();
    const closeAt = toDate_(lot.close_at);
    if(!closeAt || now >= closeAt) return reject('not_open');

    if(!amount || amount % cfg.min_unit !== 0) return reject('bad_unit');

    const curPrice = num_(lot.current_price) || cfg.start_price;
    if(amount <= curPrice) return reject('below_current');

    /* invalid_above 가 비어 있으면 상한선 검증을 건너뛴다 */
    const limit = num_(lot.invalid_above);
    if(limit !== null && amount > limit) return reject('over_limit');

    /* ── 통과 ── */
    let newClose = closeAt;
    const leftSec = Math.floor((closeAt - now) / 1000);
    if(leftSec <= cfg.extend_sec){
      newClose = new Date(now.getTime() + cfg.extend_sec * 1000);
    }

    /* ⚠️ A) holder_session 은 필수 열. 열 인덱스를 쓰기 전에 먼저 확인해
       열이 없을 때 "가격만 갱신되고 승자는 기록 안 됨" 이라는
       부분 기록 상태가 남지 않게 한다. */
    const hsCol = colIndex_(head,'holder_session');

    sh.getRange(lot._row, colIndex_(head,'current_price')).setValue(amount);
    sh.getRange(lot._row, colIndex_(head,'current_holder')).setValue(b.nickname || '');
    /* 승자 판정은 닉네임이 아니라 session_id 기준 (닉네임 중복 • 변경 대비) */
    sh.getRange(lot._row, hsCol).setValue(b.session_id || '');
    sh.getRange(lot._row, colIndex_(head,'bid_count'))
      .setValue((num_(lot.bid_count) || 0) + 1);
    sh.getRange(lot._row, colIndex_(head,'close_at'))
      .setValue(Utilities.formatDate(newClose, cfg.timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"));

    SpreadsheetApp.flush();
    cache.remove('state_' + cfg.market);   // 즉시 반영

    logEvent_(Object.assign({}, base, { accepted:true }));
    return {
      ok: true,
      current_price: amount,
      close_at: newClose.toISOString(),
      extended: newClose.getTime() !== closeAt.getTime()
    };
  }finally{
    lock.releaseLock();
  }
}

/* ── admin ── */
function handleAdmin_(b){
  const tok = adminToken_();
  if(!tok) return { ok:false, error:'token_not_set — setupAdminToken() 을 먼저 실행하세요' };
  if(b.token !== tok) return { ok:false, error:'unauthorized' };

  const cfg = getRound_(b.market);
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try{
    const sh = sheet_(S_LOTS);
    const { head, rows } = readTable_(S_LOTS);
    const inRound = rows.filter(r => String(r.round_id) === cfg.round_id);
    const find = no => inRound.filter(r => String(r.lot_no) === String(no))[0];

    const setState = (lot, st) =>
      sh.getRange(lot._row, colIndex_(head,'state')).setValue(st);

    /* ⚠️ C) onair LOT 을 닫을 때는 반드시 final_price 를 먼저 기록한다.
       state 를 먼저 바꾸면 중간 실패 시 "closed 인데 final_price 비어 있음" 이
       남아 결과 목록에서 해당 LOT 이 통째로 사라진다. */
    const closeLot = lot => {
      sh.getRange(lot._row, colIndex_(head,'final_price'))
        .setValue(num_(lot.current_price) || cfg.start_price);
      setState(lot, 'closed');
      logEvent_({
        event_type:'lot_closed', lot_no:num_(lot.lot_no),
        amount:num_(lot.current_price) || cfg.start_price,
        nickname:String(lot.current_holder || ''), accepted:true,
        round_id:cfg.round_id, market:cfg.market, currency:cfg.currency
      });
    };

    const openLot = lot => {
      const close = new Date(Date.now() + cfg.lot_duration * 1000);
      setState(lot, 'onair');
      sh.getRange(lot._row, colIndex_(head,'close_at'))
        .setValue(Utilities.formatDate(close, cfg.timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"));
    };

    /* ⚠️ B) 여기서 바로 return 하지 않는다. 결과만 담아 두고
       아래 공통 경로(flush → state cache remove)를 반드시 거쳐서 반환한다. */
    let result = { ok:true };

    if(b.cmd === 'open'){
      const lot = find(b.lot_no);
      if(!lot) return { ok:false, error:'no_lot' };
      /* ⚠️ C) 이미 끝난 LOT 재오픈 차단 — final_price 가 덮어써진다 */
      if(String(lot.state).toLowerCase() === 'closed')
        return { ok:false, error:'lot_already_closed' };

      /* ⚠️ C) 진행 중인 LOT 에 open 을 다시 걸어도 타이머를 재시작하지 않는다.
         버튼 중복 실행 한 번으로 20초 남은 경매가 120초로 되살아나면
         30초 연장 규칙과 무관한 "관리자 임의 연장" 이 된다.
         아무것도 쓰지 않았으므로 flush/cache 경로를 거치지 않고 즉시 반환. */
      if(String(lot.state).toLowerCase() === 'onair')
        return { ok:true, already_open:true, lot_no: num_(lot.lot_no) };

      inRound.forEach(r => {
        if(String(r.state).toLowerCase() !== 'onair') return;
        closeLot(r);
      });
      openLot(lot);
      sh.getRange(lot._row, colIndex_(head,'current_price'))
        .setValue(num_(lot.current_price) || cfg.start_price);
      result = { ok:true, opened: num_(lot.lot_no) };

    }else if(b.cmd === 'close'){
      const lot = find(b.lot_no);
      if(!lot) return { ok:false, error:'no_lot' };
      closeLot(lot);
      result = { ok:true, closed: num_(lot.lot_no) };

    }else if(b.cmd === 'next'){
      const cur = inRound.filter(r => String(r.state).toLowerCase() === 'onair')[0];
      if(cur) closeLot(cur);

      const nxt = inRound.filter(r => String(r.state).toLowerCase() === 'wait')[0];
      if(!nxt){
        /* 마지막 LOT 을 닫은 직후다. 여기서 바로 return 하면
           flush 와 캐시 삭제가 건너뛰어져 클라이언트가 ended 로 못 넘어간다. */
        result = { ok:true, done:true };
      }else{
        openLot(nxt);
        result = { ok:true, opened: num_(nxt.lot_no) };
      }

    }else if(b.cmd === 'reset'){
      const hsCol = colIndex_(head,'holder_session');   // ⚠️ A) 필수 열
      inRound.forEach(r => {
        setState(r, 'wait');
        sh.getRange(r._row, colIndex_(head,'current_price')).setValue(cfg.start_price);
        sh.getRange(r._row, colIndex_(head,'current_holder')).setValue('');
        sh.getRange(r._row, hsCol).setValue('');
        sh.getRange(r._row, colIndex_(head,'bid_count')).setValue(0);
        sh.getRange(r._row, colIndex_(head,'close_at')).setValue('');
        sh.getRange(r._row, colIndex_(head,'final_price')).setValue('');
      });

    }else{
      return { ok:false, error:'unknown_cmd' };
    }

    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('state_' + cfg.market);
    return result;
  }finally{
    lock.releaseLock();
  }
}

/* ══════════════════ 예측왕 집계 ══════════════════ */

/**
 * 경매 종료 후 수동 실행 — predictions 에 final_price / diff / rank 채움
 *
 * ⚠️ E) 예측왕은 회차(round) 전체에서 1명이다.
 *    LOT 별로 순위를 매기면 rank=1 이 LOT 수만큼 생긴다.
 *    집계 단위는 "사용자" 가 아니라 "예측 1건" — 여러 LOT 을 예측하면
 *    예측권이 여러 장인 것이 맞다 (참여 LOT 수를 억제하지 않기 위해).
 *    주간 랭킹은 이 rank 를 재사용하지 말고 별도로 집계할 것.
 *
 *    동점 처리: diff → ts_server 빠른 순 → 시트 행 순서(제출 순)
 *
 *    재실행 안전(idempotent): 집계 시작 시 해당 round 의
 *    final_price / diff / rank 를 먼저 비우고 다시 채운다.
 */
function rankPredictions(market){
  const cfg  = getRound_(market || 'KR');
  const lots = getLots_(cfg.round_id);
  const finals = {};
  lots.forEach(l => { finals[String(l.lot_no)] = num_(l.final_price) || 0; });

  const sh = sheet_(S_PRED);
  const { head, rows } = readTable_(S_PRED);

  const cF = colIndex_(head,'final_price');
  const cD = colIndex_(head,'diff');
  const cR = colIndex_(head,'rank');

  /* ── 1) 해당 round 의 prediction 행만 조회 ── */
  const mine = rows.filter(r => String(r.round_id) === cfg.round_id);

  /* ── 2) 재실행 안전성: final_price / diff / rank 를 먼저 비운다 ──
     일부 LOT 만 종료된 상태에서 실수로 집계한 뒤 전체 종료 후 재실행하면,
     나중에 종료된 LOT 의 예측 행은 첫 실행 때 정렬 대상이 아니었으므로
     과거 값이 덮어써지지 않고 그대로 남는다. 먼저 비워서 idempotent 하게 만든다.
     ⚠️ mine 은 이 round 의 행만 담고 있으므로 다른 round 는 절대 건드리지 않는다. */
  const lo = Math.min(cF, cD, cR);
  const contiguous = (Math.max(cF, cD, cR) - lo + 1) === 3;
  mine.forEach(r => {
    if(contiguous){
      sh.getRange(r._row, lo, 1, 3).clearContent();
    }else{
      sh.getRange(r._row, cF).clearContent();
      sh.getRange(r._row, cD).clearContent();
      sh.getRange(r._row, cR).clearContent();
    }
  });
  SpreadsheetApp.flush();

  /* ── 3) 종료된 LOT(final_price 존재)만 다시 계산 ── */
  const all = [];
  mine.forEach(r => {
    /* final_price 가 없는 LOT(안 열린 LOT)의 예측은 집계에서 제외.
       0 으로 두면 낮게 예측한 사람이 오차 최소로 잡혀 1위가 된다. */
    const f = finals[String(r.lot_no)];
    if(!f) return;
    const diff = Math.abs((num_(r.predicted_price) || 0) - f);
    sh.getRange(r._row, cF).setValue(f);
    sh.getRange(r._row, cD).setValue(diff);

    /* ts_server 가 문자열로 저장되든 Date 로 파싱되든 동일하게 비교되도록 숫자화 */
    const t = toDate_(r.ts_server);
    all.push({ row:r._row, diff:diff, ts: t ? t.getTime() : Number.MAX_SAFE_INTEGER });
  });

  /* ── 4) round 전체 통합 정렬 → 5) rank 1..N 재부여 ── */
  all.sort((a, b) => (a.diff - b.diff) || (a.ts - b.ts) || (a.row - b.row))
     .forEach((x, i) => sh.getRange(x.row, cR).setValue(i + 1));

  SpreadsheetApp.flush();
  Logger.log('예측 집계 완료 [' + cfg.round_id + ']: 초기화 후 재집계 • ' +
             all.length + '건 순위 부여 / 전체 ' + mine.length + '건');
}

/* ══════════════════ 자가 점검 ══════════════════ */

/** 배포 전 실행해서 시트 구조가 맞는지 확인 */
function selfTest(){
  const need = {
    events: ['event_id','ts_server','session_id','nickname','event_type','lot_no',
             'amount','accepted','reject_reason','src','campaign','ua_type',
             'round_id','market','locale','currency'],
    /* ⚠️ A) holder_session 은 선택 열이 아니라 필수 열이다.
       applyMine_() 이 닉네임으로 폴백하지 않으므로
       이 열이 없으면 is_mine 은 누구에게도 뜨지 않는다. */
    lots: ['round_id','market','currency','lot_no','display_name','image','order_no',
           'model','invalid_above','start_price','min_unit','state','current_price',
           'current_holder','holder_session','bid_count','close_at','final_price'],
    predictions: ['round_id','market','currency','session_id','nickname','lot_no',
                  'predicted_price','ts_server','final_price','diff','rank'],
    config: ['round_id','market','currency','timezone','locale_default','start_price',
             'min_unit','predict_close_at','auction_start_at','lot_duration_sec',
             'extend_sec','active']
  };

  let ok = true;
  Object.keys(need).forEach(name => {
    try{
      const head = readTable_(name).head;
      const miss = need[name].filter(h => head.indexOf(h) < 0);
      if(miss.length){ ok = false; Logger.log('❌ ' + name + ' 누락 열: ' + miss.join(', ')); }
      else Logger.log('✅ ' + name);
    }catch(err){ ok = false; Logger.log('❌ ' + name + ' — ' + err); }
  });

  try{
    const cfg = getRound_('KR');
    Logger.log('✅ 활성 라운드: ' + cfg.round_id +
               ' / 시작 ' + cfg.auction_start +
               ' / 예측마감 ' + cfg.predict_close);
    if(!cfg.auction_start || !cfg.predict_close){
      ok = false;
      Logger.log('❌ config 시각이 비었거나 파싱 실패 — 셀 서식을 "일반 텍스트"로 두세요');
    }
    Logger.log('✅ LOT 수: ' + getLots_(cfg.round_id).length);
  }catch(err){ ok = false; Logger.log('❌ config — ' + err); }

  if(!adminToken_()){
    ok = false; Logger.log('❌ ADMIN_TOKEN 미설정 — setupAdminToken() 을 실행하세요');
  }else{
    Logger.log('✅ ADMIN_TOKEN 설정됨');
  }

  Logger.log(ok ? '───── 전체 통과 ─────' : '───── 문제 있음 ─────');
  return ok;
}

/** A/B 승자 판정 점검 — 각 LOT 의 holder_session 보존 여부를 눈으로 확인 */
function checkIsMine(){
  const cfg = getRound_('KR');
  getLots_(cfg.round_id).forEach(l => {
    Logger.log('LOT ' + l.lot_no +
      ' | state=' + String(l.state).toLowerCase() +
      ' | current=' + (num_(l.current_price) || 0) +
      ' | final=' + (num_(l.final_price) || '(비어있음)') +
      ' | holder=' + String(l.current_holder || '(없음)') +
      ' | session=' + (String(l.holder_session || '') ? String(l.holder_session) : '❌ 비어있음'));
  });
}
/* ══════════════ Phase 0 운영/테스트 명령 ══════════════ */

/** 경매 시각을 지금부터 N분 뒤로 당김 (테스트용) */
function testTime(){
  const MIN = 15;                        // ← 몇 분 뒤 시작할지
  const sh = sheet_(S_CONFIG);
  const { head, rows } = readTable_(S_CONFIG);
  const r = rows.filter(x => String(x.market).toUpperCase() === 'KR')[0];
  if(!r) return Logger.log('config 에 KR 행이 없습니다');
  const start = new Date(Date.now() + MIN * 60000);
  const pred  = new Date(start.getTime() - 5 * 60000);
  const f = d => Utilities.formatDate(d, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
  sh.getRange(r._row, colIndex_(head,'predict_close_at')).setValue(f(pred));
  sh.getRange(r._row, colIndex_(head,'auction_start_at')).setValue(f(start));
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('state_KR');
  Logger.log('예측마감 ' + f(pred) + '\n경매시작 ' + f(start));
}

/** LOT 1 열기 */
function openLot1(){ Logger.log(JSON.stringify(
  handleAdmin_({ token: adminToken_(), market:'KR', cmd:'open', lot_no:1 }))); }

/** 임의 LOT 열기 — 번호만 바꿔서 실행 */
function openLotN(){ Logger.log(JSON.stringify(
  handleAdmin_({ token: adminToken_(), market:'KR', cmd:'open', lot_no:2 }))); }

/** 현재 LOT 마감 + 다음 LOT 열기 */
function nextLot(){ Logger.log(JSON.stringify(
  handleAdmin_({ token: adminToken_(), market:'KR', cmd:'next' }))); }

/** 현재 LOT 즉시 마감 */
function closeNow(){
  const cfg = getRound_('KR');
  const cur = getLots_(cfg.round_id).filter(l => String(l.state).toLowerCase() === 'onair')[0];
  if(!cur) return Logger.log('진행 중인 LOT 없음');
  Logger.log(JSON.stringify(
    handleAdmin_({ token: adminToken_(), market:'KR', cmd:'close', lot_no:num_(cur.lot_no) })));
}

/** 전체 초기화 (모든 LOT wait, 가격•세션•입찰수 리셋) */
function resetAll(){ Logger.log(JSON.stringify(
  handleAdmin_({ token: adminToken_(), market:'KR', cmd:'reset' }))); }


/* ══════════════════ action=result — 회차 성적표 ══════════════════ */

/**
 * ⚠️ 읽기 전용 구역이다. 아래 함수들에는 setValue / appendRow / clearContent 가
 *    한 줄도 없다. result GET 이 예측왕을 재계산하거나 LOT 을 마감시키는 일은
 *    구조적으로 불가능하며, 앞으로도 여기에 쓰기를 추가하지 않는다.
 *
 *  응답 형태
 *    pending : { ok, status:"pending", round_id, server_time }
 *    final   : { ok, status:"final", round_id, server_time,
 *                my_result, prediction_winner, next_round }
 */

/**
 * 회차 성적표 — 세션 1명분.
 *
 * ⚠️ 아직 회차가 안 끝났으면 오류가 아니라 status:"pending" 이다.
 *    마지막 LOT 종료와 result.html 진입 사이의 몇 초 차이로
 *    화면이 깨지면 안 된다. 프론트는 status 만 보고 분기하면 된다.
 *
 * ⚠️ 여기서 autoCloseExpired_ 를 호출하지 않는다 (읽기 전용 유지).
 *    만료 LOT 정리는 state 의 책임이므로 result.html 은
 *    state → result 순서로 호출해야 한다.
 */
function buildResult_(market, sid){
  const cfg  = getRound_(market);
  const lots = getLots_(cfg.round_id);

  if(phaseOf_(cfg, lots) !== 'ended'){
    return {
      ok         : true,
      status     : 'pending',
      round_id   : cfg.round_id,
      server_time: nowIso_()
    };
  }

  /* 내가 최고가로 끝낸 LOT 수.
     ⚠️ closed 만 센다. 비교는 holder_session — 닉네임은 변경 가능하므로 쓰지 않는다. */
  let won = 0;
  lots.forEach(l => {
    if(String(l.state).toLowerCase() !== 'closed') return;
    const hs = String(l.holder_session || '');
    if(sid && hs && hs === sid) won++;
  });

  /* WATCHER / ROOKIE 판정은 events 의 실제 accepted bid 만 사용한다.
     ⚠️ won > 0 으로 대체하지 말 것. won=0 구간이 WATCHER 와 ROOKIE 가
        갈리는 유일한 구간이다. */
  const hasBid = hasAcceptedBid_(cfg.round_id, sid);

  return {
    ok         : true,
    status     : 'final',
    round_id   : cfg.round_id,
    server_time: nowIso_(),
    my_result  : {
      has_bid   : hasBid,
      won_lots  : won,
      /* 분모는 종료된 LOT 수가 아니라 회차 전체 LOT 수 */
      total_lots: lots.length
    },
    prediction_winner: predictionWinner_(cfg.round_id),
    next_round       : nextRound_(cfg.market, cfg.round_id)
  };
}

/**
 * accepted=TRUE 인 입찰이 한 번이라도 있었는가.
 * WATCHER(구경만) 와 ROOKIE(입찰했지만 최고가 0개) 를 가르는 유일한 기준.
 *
 * ⚠️ 거절된 입찰(accepted=FALSE)은 참여로 세지 않는다 — 어뷰징 방지.
 * ⚠️ 뒤에서부터 훑는다. 최근 이벤트가 시트 끝에 있으므로 대부분 즉시 끝난다.
 */
function hasAcceptedBid_(round_id, sid){
  if(!sid) return false;

  const sh = sheet_(S_EVENTS);
  if(sh.getLastRow() < 2) return false;

  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(h => String(h).trim());
  const iS = head.indexOf('session_id');
  const iT = head.indexOf('event_type');
  const iA = head.indexOf('accepted');
  const iR = head.indexOf('round_id');
  if(iS < 0 || iT < 0 || iA < 0) throw new Error('events 필수 열 없음 (selfTest 실행)');

  for(let i = vals.length - 1; i >= 1; i--){
    const r = vals[i];
    if(String(r[iS]) !== String(sid)) continue;
    if(String(r[iT]) !== 'bid') continue;
    /* 시트가 TRUE 를 문자열로 두든 boolean 으로 바꾸든 동일하게 판정 */
    if(String(r[iA]).toUpperCase() !== 'TRUE') continue;
    if(iR >= 0 && String(r[iR]) !== String(round_id)) continue;
    return true;
  }
  return false;
}

/**
 * 예측왕 — 회차 전체 1명.
 * rankPredictions() 가 이미 부여한 rank=1 행을 읽기만 한다.
 *
 * ⚠️ 동점이어도 배열로 만들지 않는다. rank 는 서버에서 1..N 으로
 *    유일하게 부여됐다 (diff → ts_server → 행 순서).
 * ⚠️ 아직 rankPredictions() 를 안 돌렸으면 null. 오류가 아니라 정상이며,
 *    화면은 "예측 결과 집계 중" 을 띄운다. 여기서 대신 계산하지 않는다.
 */
function predictionWinner_(round_id){
  const { rows } = readTable_(S_PRED);
  const w = rows.filter(r =>
    String(r.round_id) === String(round_id) && num_(r.rank) === 1)[0];
  if(!w) return null;

  return {
    nickname       : String(w.nickname || '익명'),
    lot_no         : num_(w.lot_no),
    predicted_price: num_(w.predicted_price) || 0,
    final_price    : num_(w.final_price) || 0,
    diff           : num_(w.diff) || 0
  };
}

/**
 * 다음 회차 — config 에서 같은 market 의 "미래 시작 시각" 중 가장 이른 것.
 *
 * ⚠️ active 플래그가 아니라 round_id 로 현재 회차를 제외한다.
 *    다음 회차를 미리 active=TRUE 로 켜 두는 운영도, 꺼 두는 운영도
 *    모두 가능해야 하기 때문.
 * ⚠️ 없으면 억지로 "내일 밤 9시" 를 만들지 않는다. available:false 로 내리고
 *    화면은 "다음 회차 준비 중". 틀린 시각을 보여주고 아무 일도 안 일어나는 것이
 *    회차 하나를 통째로 날리는 것보다 나쁘다.
 * ⚠️ 시각 형식은 state 의 auction_start_at 과 동일하게 toISOString().
 */
function nextRound_(market, current_round_id){
  const { rows } = readTable_(S_CONFIG);
  const m = String(market).toUpperCase();
  const now = new Date();

  let best = null;
  rows.forEach(r => {
    if(String(r.market).toUpperCase() !== m) return;
    if(String(r.round_id) === String(current_round_id)) return;
    const t = toDate_(r.auction_start_at);
    if(!t || t <= now) return;
    if(!best || t < best) best = t;
  });

  return best
    ? { available: true,  auction_start_at: best.toISOString() }
    : { available: false, auction_start_at: null };
}

/**
 * 편집기 전용 — result 응답을 눈으로 확인한다.
 * 최고가를 가진 세션이 있으면 그 세션으로, 없으면 빈 세션으로 찍는다.
 */
function testResult(){
  const cfg = getRound_('KR');
  const hit = getLots_(cfg.round_id)
    .filter(l => String(l.holder_session || ''))[0];
  const sid = hit ? String(hit.holder_session) : '';

  Logger.log('테스트 세션: ' + (sid || '(없음 — 입찰 기록이 있어야 has_bid 확인 가능)'));
  const out = buildResult_('KR', sid);
  Logger.log(JSON.stringify(out, null, 2));

  if(out.status === 'pending'){
    Logger.log('▶ 아직 진행 중입니다. LOT 을 전부 종료한 뒤 다시 실행하세요.');
    return out;
  }

  /* 응답에 새면 안 되는 것 자가 점검 */
  const s = JSON.stringify(out);
  ['session_id', '_hs', 'invalid_above', 'model', 'bid_count'].forEach(k => {
    Logger.log((s.indexOf(k) < 0 ? '✅ 미노출 ' : '❌ 노출됨! ') + k);
  });
  return out;
}
/* ══════════════════════════════════════════════════════════
 *  debugResultSession() — has_bid 진단 (임시)
 *
 *  Code.gs 맨 아래에 붙여넣고 실행만 하세요.
 *  읽기 전용입니다. 시트에 아무것도 쓰지 않습니다.
 *  진단이 끝나면 이 함수는 지워도 됩니다.
 * ══════════════════════════════════════════════════════════ */

function debugResultSession(){

  /* 세션을 직접 넣고 싶으면 여기에. 비워두면 lots 에서 자동으로 찾습니다. */
  const SID_OVERRIDE = '';

  const cfg = getRound_('KR');
  const L = s => Logger.log(s);

  /* ── 0) 대상 세션 ── */
  const lots = readTable_(S_LOTS).rows
    .filter(r => String(r.round_id) === String(cfg.round_id));
  const auto = lots.filter(r => String(r.holder_session || ''))[0];
  const sid  = SID_OVERRIDE || (auto ? String(auto.holder_session) : '');

  L('══════ 진단 대상 ══════');
  L('round_id : ' + cfg.round_id);
  L('session  : ' + (sid || '❌ 없음 — 입찰 기록이 있어야 합니다'));
  if(!sid) return;

  const won = lots.filter(r =>
    String(r.state).toLowerCase() === 'closed' &&
    String(r.holder_session) === sid).length;
  L('won_lots : ' + won + ' / ' + lots.length);

  /* ── 1) events 실제 헤더 순서 vs logEvent_ 배열 순서 ── */
  const sh   = sheet_(S_EVENTS);
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(h => String(h).trim());

  /* logEvent_ 의 appendRow 배열이 가정하는 순서 */
  const LOG_ORDER = ['event_id','ts_server','session_id','nickname','event_type',
                     'lot_no','amount','accepted','reject_reason','src','campaign',
                     'ua_type','round_id','market','locale','currency'];

  L('');
  L('══════ 1) events 열 순서 ══════');
  L('시트 실제  : ' + head.join(' | '));
  L('logEvent_ : ' + LOG_ORDER.join(' | '));

  let shifted = [];
  LOG_ORDER.forEach((name, i) => {
    if(head[i] !== name) shifted.push(i + '번째: 시트=' + head[i] + ' / 코드=' + name);
  });
  L(shifted.length
    ? '❌ 순서 불일치 ' + shifted.length + '건 — logEvent_ 가 값을 엉뚱한 열에 씁니다\n   ' +
      shifted.join('\n   ')
    : '✅ 순서 일치 — 열 밀림은 원인이 아닙니다');

  /* ── 2) 조건을 하나씩 좁히며 어디서 0이 되는지 ── */
  const iS = head.indexOf('session_id');
  const iT = head.indexOf('event_type');
  const iA = head.indexOf('accepted');
  const iR = head.indexOf('round_id');
  L('');
  L('열 위치 : session_id=' + iS + ' event_type=' + iT +
    ' accepted=' + iA + ' round_id=' + iR);

  /* ⚠️ 여기서 멈추지 않으면 iS=-1 일 때 r[-1] 이 전부 undefined 라
     아래 필터가 "① = 0" 을 내고, 열 누락을 세션 문제로 오해하게 된다.
     (round_id 는 없어도 되는 열이라 검사에서 제외) */
  if(iS < 0 || iT < 0 || iA < 0){
    L('❌ 필수 열 누락 — selfTest() 부터 실행하세요');
    return;
  }

  const rows = vals.slice(1);
  const c1 = rows.filter(r => String(r[iS]) === sid);
  const c2 = c1.filter(r => String(r[iT]) === 'bid');
  const c3 = c2.filter(r => String(r[iA]).toUpperCase() === 'TRUE');
  const c4 = c3.filter(r => iR < 0 || String(r[iR]) === String(cfg.round_id));

  L('');
  L('══════ 2) hasAcceptedBid_ 조건별 통과 수 ══════');
  L('  전체 행                        : ' + rows.length);
  L('  ① session_id 일치              : ' + c1.length);
  L('  ② + event_type === "bid"       : ' + c2.length);
  L('  ③ + accepted 가 TRUE           : ' + c3.length);
  L('  ④ + round_id 일치  → has_bid   : ' + (c4.length > 0));
  const fail = c1.length === 0 ? '① session_id'
             : c2.length === 0 ? '② event_type'
             : c3.length === 0 ? '③ accepted'
             : c4.length === 0 ? '④ round_id'
             : '없음 (has_bid=true 여야 정상)';
  L('  ▶ 처음 0 이 되는 지점          : ' + fail);

  /* ── 3) 이 세션 행 샘플 (최근 3건) ── */
  L('');
  L('══════ 3) 이 세션의 최근 이벤트 3건 ══════');
  if(!c1.length){
    L('  ❌ session_id 로 잡히는 행이 0건입니다.');
    L('  참고 — 시트에 실제로 들어있는 session_id 표본:');
    rows.slice(-5).forEach(r =>
      L('    [' + String(r[iS]) + ']  event_type=[' + String(r[iT]) + ']'));
  }else{
    c1.slice(-3).forEach(r => {
      L('  event_type =[' + r[iT] + ']  (type ' + typeof r[iT] + ')');
      L('  accepted   =[' + r[iA] + ']  (type ' + typeof r[iA] + ')');
      L('  round_id   =[' + (iR < 0 ? '열없음' : r[iR]) + ']');
      L('  session_id =[' + r[iS] + ']');
      L('  ---');
    });
  }

  /* ── 4) round 계열 열 이름 확인 ── */
  L('');
  L('══════ 4) round 관련 열 이름 ══════');
  L('  ' + (head.filter(h => h.toLowerCase().indexOf('round') >= 0).join(', ') || '없음'));

  /* ── 5) 현재 실제 응답 ── */
  L('');
  L('══════ 5) buildResult_ 실제 반환 ══════');
  L(JSON.stringify(buildResult_('KR', sid).my_result));
}