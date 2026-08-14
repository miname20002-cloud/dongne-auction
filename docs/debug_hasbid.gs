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
