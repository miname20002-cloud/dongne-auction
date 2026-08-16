/**
 * 동네옥션 Phase 0 — 공통 모듈
 * index / predict / live / result 가 함께 사용
 */

/* ═════════ 설정 ═════════ */
const CONFIG = {
  API_URL : "https://script.google.com/macros/s/AKfycbyAk1IKlgPWLaL2dcsWcD9nUyt_tVZYdIpIRpKsyL3w9PajZmKKSYBHxlpOhkbYXSOG/exec",
  MARKET  : "KR",
  IMG_DIR : "images/",
  POLL    : { idle: 15000, live: 3000, hot: 1500 }
};

/* 랜딩은 API 응답 전에 상품 이미지를 미리 받고,
   LIVE는 이미지 경쟁을 피하고 Apps Script 연결만 미리 연다. */
(function preloadAuctionAssets(){
  const page = location.pathname.split("/").pop() || "index.html";

  if(page === "index.html" || page === "live.html"){
    ["https://script.google.com", "https://script.googleusercontent.com"].forEach(href => {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = href;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    });
  }

  if(page !== "index.html") return;
  ["nintendo-switch-oled.png", "airpods.jpg", "demon.jpg", "Helinox.jpg", "Stanley.jpg"]
    .forEach(name => {
      const img = new Image();
      img.fetchPriority = "high";
      img.decoding = "async";
      img.src = CONFIG.IMG_DIR + name;
    });
})();

/* ═════════ 유틸 ═════════ */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad = n => String(n).padStart(2, "0");
const esc = v => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));

/* ═════════ 서버 시간 ═════════ */
let SERVER_OFFSET = 0;
let TIME_SYNCED = false;

function syncServerTime(serverTime){
  if(!serverTime) return;
  const t = new Date(serverTime).getTime();
  if(isNaN(t)) return;
  SERVER_OFFSET = t - Date.now();
  TIME_SYNCED = true;
}
function serverNow(){ return Date.now() + SERVER_OFFSET; }
function secondsUntil(iso){
  if(!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : (t - serverNow()) / 1000;
}

/* ═════════ 세션 / 트래킹 ═════════ */
const Store = {
  get(k, d){ try { return localStorage.getItem(k) ?? d; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
};

function initSession(){
  const q = new URLSearchParams(location.search);

  let sid = Store.get("da_sid");
  if(!sid){
    sid = "s_" + (self.crypto && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4));
    Store.set("da_sid", sid);
  }

  ["src", "cmp"].forEach(k => {
    const v = q.get(k);
    if(v && !Store.get("da_" + k, "")) Store.set("da_" + k, v);
  });

  ["lang", "market"].forEach(k => {
    const v = q.get(k);
    if(v) Store.set("da_" + k, v);
  });

  return {
    session_id: sid,
    src      : Store.get("da_src", "direct"),
    campaign : Store.get("da_cmp", ""),
    locale   : Store.get("da_lang", "ko"),
    market   : (Store.get("da_market", CONFIG.MARKET) || CONFIG.MARKET).toUpperCase(),
    nickname : Store.get("da_nick", ""),
    ua_type  : matchMedia("(max-width: 820px)").matches ? "mobile" : "desktop"
  };
}

const SESSION = initSession();

function setNickname(n){
  SESSION.nickname = n;
  Store.set("da_nick", n);
}

function makeNickname(){
  return "익명" + String(Math.floor(1000 + Math.random() * 9000));
}

/* LIVE 본인 최고가 표시용 보조 상태.
   accepted 된 마지막 내 입찰만 기억하고, state 응답에 안전하게 is_mine 을 보정한다. */
let LIVE_LAST_ACCEPTED_BID = null;

/* ═════════ API ═════════ */
async function apiGet(params){
  if(!CONFIG.API_URL) throw new Error("API_URL 미설정");
  const q = new URLSearchParams(Object.assign({ action: "state", market: SESSION.market }, params));
  const res = await fetch(CONFIG.API_URL + "?" + q.toString(), { cache: "no-store" });
  if(!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();

  if(data && data.ok && data.current_lot && LIVE_LAST_ACCEPTED_BID){
    const cur = data.current_lot;
    const mine =
      String(LIVE_LAST_ACCEPTED_BID.cycle_id || "") === String(data.cycle_id || "") &&
      Number(LIVE_LAST_ACCEPTED_BID.lot_no) === Number(cur.lot_no) &&
      Number(LIVE_LAST_ACCEPTED_BID.amount) === Number(cur.current_price);

    if(mine){
      cur.is_mine = true;
    }else if(
      String(LIVE_LAST_ACCEPTED_BID.cycle_id || "") !== String(data.cycle_id || "") ||
      Number(LIVE_LAST_ACCEPTED_BID.lot_no) !== Number(cur.lot_no) ||
      Number(cur.current_price) > Number(LIVE_LAST_ACCEPTED_BID.amount)
    ){
      LIVE_LAST_ACCEPTED_BID = null;
    }
  }

  return data;
}

async function apiPost(action, payload){
  if(!CONFIG.API_URL) throw new Error("API_URL 미설정");
  const body = Object.assign({
    action,
    session_id: SESSION.session_id,
    nickname  : SESSION.nickname,
    src       : SESSION.src,
    campaign  : SESSION.campaign,
    ua_type   : SESSION.ua_type,
    market    : SESSION.market,
    locale    : SESSION.locale
  }, payload || {});

  const res = await fetch(CONFIG.API_URL, {
    method : "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body   : JSON.stringify(body)
  });
  if(!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if(action === "bid" && data && data.ok){
    LIVE_LAST_ACCEPTED_BID = {
      cycle_id: body.cycle_id || null,
      lot_no: Number(body.lot_no),
      amount: Number(body.amount)
    };
  }
  return data;
}

/* ═════════ 페이지 진입 이벤트 ═════════ */
async function trackLanding(){
  if(Store.get("da_landed", "") === "1") return;
  try{
    await apiPost("session", {});
    Store.set("da_landed", "1");
  }catch(e){ console.warn("[landing]", e); }
}

async function trackView(eventType){
  try{ await apiPost("view", { view_type: eventType }); }
  catch(e){ console.warn("[view]", e); }
}

/* ═════════ 통화 / 시간 ═════════ */
let MONEY = { currency: "KRW", locale: "ko-KR" };

function setMoney(currency, locale){
  MONEY.currency = currency || "KRW";
  MONEY.locale   = (locale === "en") ? "en-US" : "ko-KR";
}

function money(n){
  const v = Number(n) || 0;
  if(MONEY.currency === "KRW") return v.toLocaleString("ko-KR") + "원";
  return new Intl.NumberFormat(MONEY.locale, {
    style: "currency", currency: MONEY.currency, maximumFractionDigits: 0
  }).format(v);
}

function moneyPlain(n){
  return (Number(n) || 0).toLocaleString(MONEY.locale);
}

function hms(sec){
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h > 0 ? pad(h) + ":" : "") + pad(m) + ":" + pad(s % 60);
}

/* ═════════ 이미지 실패 처리 ═════════ */
function imgFail(el){
  el.style.display = "none";
  const box = el.parentElement;
  if(box && !box.querySelector(".noimg")){
    const d = document.createElement("div");
    d.className = "noimg";
    d.textContent = "이미지 준비중";
    box.appendChild(d);
  }
}

/* ═════════ 폴링 ═════════ */
function createPoller(fn){
  let timer = null, interval = CONFIG.POLL.idle, stopped = false;

  async function run(){
    if(stopped || document.hidden) return schedule();
    try { await fn(); } catch(e){ console.warn("[poll]", e); }
    schedule();
  }
  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(run, interval);
  }

  document.addEventListener("visibilitychange", () => {
    if(!document.hidden && !stopped){ clearTimeout(timer); run(); }
  });

  return {
    start(){ stopped = false; run(); },
    stop(){ stopped = true; clearTimeout(timer); },
    setInterval(ms){ interval = ms; }
  };
}

/* ═════════ 토스트 ═════════ */
function toast(msg, type){
  let el = $(".toast");
  if(!el){
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = "toast"; }, 2600);
}

/* ═════════ 거절 사유 → 사람 말 ═════════ */
let MIN_UNIT = 1000;
function setMinUnit(n){ MIN_UNIT = Number(n) || 1000; }

const REJECT_MSG = {
  not_open     : "지금은 입찰할 수 없습니다",
  below_current: "이미 더 높은 금액이 있습니다",
  over_limit   : "입찰 상한선을 넘었습니다",
  bad_amount   : "금액을 확인해주세요",
  rate_limit   : "너무 빠릅니다. 잠시 후 다시",
  busy         : "처리 중입니다. 잠시 후 다시",
  no_lot       : "상품을 찾을 수 없습니다",
  cycle_changed: "새 경매가 시작됐습니다. 다시 입찰해주세요"
};

function rejectMsg(r){
  if(r === "bad_unit") return money(MIN_UNIT) + " 단위로 입력해주세요";
  return REJECT_MSG[r] || "요청이 거절되었습니다";
}