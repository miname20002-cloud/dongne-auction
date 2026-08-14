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
    /* 동시 요청에서 충돌하지 않도록 UUID 사용 (getLastRow 방식은 중복 발생) */
    const id = 'evt_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12);
    sh.appendRow([
      id,
      nowIso_(),
      p.session_id || '',
      p.nickname || '',
      p.event_type || '',
      p.lot_no === undefined || p.lot_no === null ? '' : p.lot_no,
      p.amount === undefined || p.amount === null ? '' : p.amount,
      p.accepted ? 'TRUE' : 'FALSE',
      p.reject_reason || '',
      p.src || '',
      p.campaign || '',
      p.ua_type || '',
      p.round_id || '',
      p.market || '',
      p.locale || '',
      p.currency || ''
    ]);
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
 *  closing  예측 마감 · 시작 대기  (predict_close ≤ now < auction_start)
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

      sh.getRange(l._row, colIndex_(head,'state')).setValue('closed');
      sh.getRange(l._row, colIndex_(head,'final_price'))
        .setValue(num_(l.current_price) || cfg.start_price);
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
    /* 승자 판정은 닉네임이 아니라 session_id 기준 (닉네임 중복 · 변경 대비) */
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
  Logger.log('예측 집계 완료 [' + cfg.round_id + ']: 초기화 후 재집계 · ' +
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
  const MIN = 5;                        // ← 몇 분 뒤 시작할지
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

/** 전체 초기화 (모든 LOT wait, 가격·세션·입찰수 리셋) */
function resetAll(){ Logger.log(JSON.stringify(
  handleAdmin_({ token: adminToken_(), market:'KR', cmd:'reset' }))); }