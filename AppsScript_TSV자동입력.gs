/**
 * 개런티즈 계약서 — 마스터 시트 자동 입력 Apps Script Web App
 * v350 (헤더 중복 대응 + 단독/공동계약 분기 + nth-occurrence 매칭)
 *
 * 역할:
 *   대시보드 [수동 입력 모드]에서 계약서 생성 시
 *   미리 작성된 시트 행을 임차인명+전화번호로 찾아 update,
 *   못 찾으면 마지막 행에 append.
 *
 * v350 핵심 변경 (DRY_RUN으로 매핑 오류 발견 후 안전 수정):
 *   ★ 헤더 중복 대응: "주민번호"(AW/BC), "긴급연락처"(AY/BE), "관계,이름"(AZ/BF), "이름"
 *     → findColumn에 nth 파라미터 추가, N번째 occurrence 반환
 *   ★ 단독계약(공동전차인 없음)이면 BA-BF 전체 SKIP — 사용자 정책
 *   ★ BE/BF 매핑 정정: BE=공동전차인 긴급연락처, BF=공동전차인 관계,이름
 *     (v349까지 BE=tenantPhone, BF=tenantName 로 잘못 매핑되어 있었음 — DRY_RUN으로 발견)
 *   ★ 매칭 키 변경: 임차인명 fallback AU, 임차인 전화 fallback AV
 *
 * 핵심 안전 설계:
 *   ★ 컬럼 추적은 "헤더 이름" 기준 + 중복 헤더는 nth occurrence
 *   ★ 시트 컬럼이 추가/삭제/이동되어도 헤더만 유지되면 자동 추적
 *   ★ 헤더 못 찾으면 fallback letter 사용 + 응답에 경고 표시
 *
 * 안전 장치 (5중):
 *   1. 토큰 검증
 *   2. 스프레드시트 + 시트 검증 (GID + NAME 이중)
 *   3. 헤더 키워드 검증 — "계약번호" + "임차인명" 둘 다 있어야 쓰기
 *   4. DRY_RUN 디폴트 ON — 첫 배포 시 실제 쓰지 않고 결과만 응답
 *   5. 명시 필드만 쓰기 — 매핑에 없는 컬럼은 절대 건드리지 않음
 *
 * 배포 단계 (운영팀):
 *   1. Apps Script 편집기에서 본 코드 붙여넣기
 *   2. CFG_API_TOKEN 변경 (임의 문자열)
 *   3. 배포 → 배포 관리 → 새 버전 → 배포 (URL 유지)
 *   4. **DRY_RUN 검증** — 시범 발행 1~2건 → 응답의 "planned" 확인
 *   5. 검증 완료 후 CFG_DRY_RUN = false 변경 + 재배포 → 실제 입력 시작
 */

// ========== CONFIG ==========
const CFG_SPREADSHEET_ID = '1Z3w9ZhKwiLfL4JJhs-gfcU27QLKgZAWycyGFCK4iiMc'; // 마스터
const CFG_SHEET_GID = 1931755549;
const CFG_SHEET_NAME = ''; // GID 폴백
const CFG_API_TOKEN = 'KRG-OPS-2026-CHANGE-ME-hskang'; // 운영팀이 변경한 값
const CFG_DRY_RUN = true; // 검증 완료 후 false 로 변경

// 헤더 검증 — 시트 잘못 지정 방지
const CFG_REQUIRED_HEADER_KEYWORDS = ['계약번호', '임차인명'];

// 매칭에 사용할 컬럼 — 헤더 이름 우선, 못 찾으면 fallback letter
// [v350] 매칭 키 정정: 임차인명=AU, 임차인 전화=AV
const CFG_MATCH_NAME = {
  headers: ['임차인명', '임차인 명', '임차인', '전차인명', '전차인 이름'],
  fallbackCol: 'AU'
};
const CFG_MATCH_PHONES = [
  { headers: ['임차인휴대폰', '임차인 휴대폰', '임차인 연락처', '임차인연락처', '전차인 연락처', '전차인연락처'], fallbackCol: 'AV' }
];

// 쓰기 컬럼 매핑 — 헤더 우선, 못 찾으면 fallbackCol 사용
// [v350] 헤더 중복 대응: nth=0 (첫번째), nth=1 (두번째) 명시
// [v350] onlyIfCoName: true → 공동전차인 미입력시 SKIP (단독계약 보호)
const CFG_FIELDS_MAP = [
  // ── 항상 쓰는 컬럼 (단독/공동 무관) ──
  { field: 'doorPwd',     headers: ['현관번호', '현관 비밀번호', '현관비번', '현관'],     fallbackCol: 'F',  nth: 0 },
  { field: 'tenantIdNo',  headers: ['주민번호'],                                            fallbackCol: 'AW', nth: 0 }, // AW (첫번째 주민번호)
  { field: 'tenantAddr',  headers: ['주소임차인', '임차인 주소', '전차인 주소'],            fallbackCol: 'AX', nth: 0 },
  { field: 'emgPhone',    headers: ['긴급연락처', '긴급 연락처'],                            fallbackCol: 'AY', nth: 0 }, // AY (첫번째 긴급연락처)
  { field: 'emgRelName',  headers: ['관계,이름', '관계, 이름', '관계/이름', '관계이름'],   fallbackCol: 'AZ', nth: 0 }, // AZ (첫번째 관계,이름)
  // ── 공동전차인 입력시만 쓰는 컬럼 (단독계약시 전체 SKIP) ──
  { field: 'coName',        headers: ['이름'],          fallbackCol: 'BA', nth: 0, onlyIfCoName: true },
  { field: 'coPhone',       headers: ['연락처'],        fallbackCol: 'BB', nth: 0, onlyIfCoName: true },
  { field: 'coIdNo',        headers: ['주민번호'],      fallbackCol: 'BC', nth: 1, onlyIfCoName: true }, // BC (두번째 주민번호)
  { field: 'coAddr',        headers: ['주소'],          fallbackCol: 'BD', nth: 0, onlyIfCoName: true }, // 주소 (첫번째, 주소임차인과 구분)
  { field: 'coEmgPhone',    headers: ['긴급연락처'],    fallbackCol: 'BE', nth: 1, onlyIfCoName: true }, // BE (두번째 긴급연락처)
  { field: 'coEmgRelName',  headers: ['관계,이름'],     fallbackCol: 'BF', nth: 1, onlyIfCoName: true }  // BF (두번째 관계,이름)
];

// fallback 사용 정책 — 헤더 매칭 실패 시 동작
//   'allow'  : fallback letter로 쓰기 진행 (응답에 경고 포함)
//   'skip'   : 해당 필드 쓰기 SKIP (다른 필드는 정상 진행)
//   'reject' : 전체 요청 거부 (가장 엄격)
const CFG_FALLBACK_POLICY = 'allow';
// ============================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResp({ status: 'error', message: 'empty post body' });
    }
    var data = JSON.parse(e.postData.contents);

    if (!data.token || data.token !== CFG_API_TOKEN) {
      return jsonResp({ status: 'error', message: 'invalid token' });
    }

    if (data.action === 'ping') {
      return jsonResp({ status: 'ok', message: 'pong', dryRun: CFG_DRY_RUN, time: new Date().toISOString() });
    }
    if (data.action === 'upsertContract') {
      return upsertContract(data);
    }
    return jsonResp({ status: 'error', message: 'unknown action: ' + (data.action || '(none)') });
  } catch (err) {
    return jsonResp({ status: 'error', message: 'exception: ' + String(err && err.message || err) });
  }
}

function doGet() {
  return jsonResp({ status: 'ok', message: 'API ready', dryRun: CFG_DRY_RUN, version: 'v350' });
}

function upsertContract(data) {
  // [v348-1] LockService — 동시 요청 직렬화 (race condition 방지)
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch(e) { return jsonResp({ status: 'error', message: 'lock timeout (20s) — 다른 요청 처리 중. 잠시 후 재시도' }); }
  try {
    return upsertContractInner(data);
  } finally {
    try { lock.releaseLock(); } catch(_){}
  }
}

function upsertContractInner(data) {
  var fields = data.fields || {};
  var tenantName = String(fields.tenantName || '').trim();
  var tenantPhone = digitsOnly(fields.tenantPhone || '');
  // [v350] 공동전차인 입력 여부 — coName이 비어있으면 단독계약
  var coName = String(fields.coName || '').trim();
  var hasCoTenant = !!coName;

  if (!tenantName) return jsonResp({ status: 'error', message: '임차인명(tenantName) 누락 — 매칭 불가' });

  // 스프레드시트 + 시트
  var ss = SpreadsheetApp.openById(CFG_SPREADSHEET_ID);
  if (!ss) return jsonResp({ status: 'error', message: 'spreadsheet not found' });

  var sheet = null;
  if (CFG_SHEET_GID) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === CFG_SHEET_GID) { sheet = sheets[i]; break; }
    }
  }
  if (!sheet && CFG_SHEET_NAME) sheet = ss.getSheetByName(CFG_SHEET_NAME);
  if (!sheet) return jsonResp({ status: 'error', message: 'sheet not found (gid=' + CFG_SHEET_GID + ', name=' + CFG_SHEET_NAME + ')' });

  // 헤더 읽기 + 검증
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerJoin = headers.map(function(x){ return String(x||''); }).join('|');
  for (var k = 0; k < CFG_REQUIRED_HEADER_KEYWORDS.length; k++) {
    if (headerJoin.indexOf(CFG_REQUIRED_HEADER_KEYWORDS[k]) < 0) {
      return jsonResp({
        status: 'error',
        message: '헤더 검증 실패 — 필수 키워드 "' + CFG_REQUIRED_HEADER_KEYWORDS[k] + '" 없음. 시트 ID/GID 확인 필요.',
        sheetName: sheet.getName()
      });
    }
  }

  // 매칭 컬럼 찾기 (헤더 이름 우선)
  var nameColResult = findColumn(headers, CFG_MATCH_NAME.headers, CFG_MATCH_NAME.fallbackCol, 0);
  var nameColIdx = nameColResult.col;

  var phoneColIdxList = [];
  var phoneColWarns = [];
  CFG_MATCH_PHONES.forEach(function(spec){
    var r = findColumn(headers, spec.headers, spec.fallbackCol, 0);
    if (r.col > 0) {
      phoneColIdxList.push(r.col);
      if (r.usedFallback) phoneColWarns.push('phone-' + spec.fallbackCol + ' 헤더 미발견 (fallback)');
    }
  });

  // 기존 행 매칭 — [v348-2] 전화 미입력 시 update 거부 → 동명이인 잘못 덮어쓰기 방지
  var lastRow = sheet.getLastRow();
  var matchedRow = 0;
  var matchedReason = '';
  if (!tenantPhone) {
    // 전화 미입력 → 강제 append (동명이인 위험 회피)
    matchedReason = '전화번호 미입력 → append 강제 (동명이인 보호)';
  } else if (lastRow >= 2) {
    var maxColForMatch = Math.max(nameColIdx, phoneColIdxList.length ? Math.max.apply(null, phoneColIdxList) : nameColIdx);
    var rows = sheet.getRange(2, 1, lastRow - 1, maxColForMatch).getValues();
    for (var r = 0; r < rows.length; r++) {
      var rowName = String(rows[r][nameColIdx - 1] || '').trim();
      if (rowName !== tenantName) continue;
      var phoneMatch = false;
      for (var p = 0; p < phoneColIdxList.length; p++) {
        var rowPhone = digitsOnly(rows[r][phoneColIdxList[p] - 1] || '');
        if (rowPhone && rowPhone === tenantPhone) { phoneMatch = true; break; }
      }
      if (phoneMatch) {
        matchedRow = r + 2;
        matchedReason = '이름 + 전화 일치';
        break;
      }
    }
  }

  var targetRow = matchedRow > 0 ? matchedRow : (sheet.getLastRow() + 1);
  var mode = matchedRow > 0 ? 'update' : 'append';

  // 쓰기 컬럼 결정 — 헤더 매칭 + fallback 정책 + [v350] 공동전차인 분기
  var writes = [];
  var warnings = [];
  var skippedCoFields = []; // [v350] 단독계약 SKIP 추적
  CFG_FIELDS_MAP.forEach(function(spec){
    // [v350] 단독계약 보호 — onlyIfCoName 필드는 공동전차인 없으면 SKIP
    if (spec.onlyIfCoName && !hasCoTenant) {
      skippedCoFields.push(spec.field);
      return;
    }
    var val = fields[spec.field];
    if (val == null) return; // 빈값은 건너뜀
    val = String(val);
    // [v350] nth 파라미터 전달 (헤더 중복 대응)
    var found = findColumn(headers, spec.headers, spec.fallbackCol, spec.nth || 0);
    if (!found.col) {
      warnings.push(spec.field + ': 컬럼 못 찾음 (헤더 + fallback 모두 실패) — SKIP');
      return;
    }
    if (found.usedFallback) {
      if (CFG_FALLBACK_POLICY === 'skip') {
        warnings.push(spec.field + ': 헤더 미발견 (fallback ' + spec.fallbackCol + ') — SKIP (policy=skip)');
        return;
      }
      if (CFG_FALLBACK_POLICY === 'reject') {
        warnings.push(spec.field + ': 헤더 미발견 (fallback ' + spec.fallbackCol + ') — REJECT');
      }
      warnings.push(spec.field + ': 헤더 미발견 → fallback ' + spec.fallbackCol + ' 사용');
    }
    writes.push({
      col: found.col,
      letter: numToColLetter(found.col),
      field: spec.field,
      value: val,
      usedFallback: !!found.usedFallback,
      matchedHeader: found.matchedHeader || null,
      nth: spec.nth || 0
    });
  });

  if (CFG_FALLBACK_POLICY === 'reject' && warnings.some(function(w){ return w.indexOf('REJECT') >= 0; })) {
    return jsonResp({ status: 'error', message: 'fallback policy=reject — 헤더 누락으로 거부', warnings: warnings });
  }

  if (writes.length === 0) {
    return jsonResp({ status: 'error', message: '쓸 데이터 없음', warnings: warnings, skippedCoFields: skippedCoFields, hasCoTenant: hasCoTenant });
  }

  // [v348-4] No-op 감지 — update 모드에서 기존 값과 동일한 셀은 skip
  var unchanged = [];
  if (mode === 'update' && targetRow > 0 && lastRow >= targetRow) {
    var maxColForRead = Math.max.apply(null, writes.map(function(w){ return w.col; }));
    var existingRow = sheet.getRange(targetRow, 1, 1, maxColForRead).getValues()[0];
    writes = writes.filter(function(w){
      var existing = String(existingRow[w.col - 1] == null ? '' : existingRow[w.col - 1]).trim();
      var incoming = String(w.value == null ? '' : w.value).trim();
      if (existing === incoming) {
        unchanged.push({ col: w.letter, field: w.field, value: existing });
        return false;
      }
      w.previousValue = existing;
      return true;
    });
    if (writes.length === 0) {
      return jsonResp({
        status: 'ok',
        dryRun: CFG_DRY_RUN,
        mode: 'noop',
        row: targetRow,
        sheet: sheet.getName(),
        matchedReason: matchedReason,
        message: '이미 시트의 데이터와 100% 동일 — 변경 없음 (no-op)',
        unchanged: unchanged,
        warnings: warnings,
        skippedCoFields: skippedCoFields,
        hasCoTenant: hasCoTenant
      });
    }
  }

  // 응답 빌더 (공통)
  var resp = {
    status: 'ok',
    dryRun: CFG_DRY_RUN,
    mode: mode,
    row: targetRow,
    sheet: sheet.getName(),
    matchedReason: matchedReason,
    hasCoTenant: hasCoTenant,
    skippedCoFields: skippedCoFields,
    planned: writes.map(function(w){
      return {
        col: w.letter,
        field: w.field,
        value: w.value,
        previousValue: w.previousValue || null,
        usedFallback: w.usedFallback,
        matchedHeader: w.matchedHeader,
        nth: w.nth
      };
    }),
    unchanged: unchanged,
    warnings: warnings
  };

  // DRY_RUN
  if (CFG_DRY_RUN) {
    resp.message = 'DRY_RUN — 실제 쓰지 않음. 검증 완료 후 CFG_DRY_RUN=false 변경.';
    return jsonResp(resp);
  }

  // 실제 쓰기
  writes.forEach(function(w){
    sheet.getRange(targetRow, w.col).setValue(w.value);
  });

  // 로그
  try {
    var logSheet = ss.getSheetByName('자동입력_로그');
    if (logSheet) {
      var who = (Session.getActiveUser && Session.getActiveUser().getEmail && Session.getActiveUser().getEmail()) || '(anonymous)';
      logSheet.appendRow([new Date(), mode, targetRow, tenantName, tenantPhone, who, JSON.stringify(writes).slice(0, 500)]);
    }
  } catch (_) {}

  resp.written = writes.map(function(w){ return { col: w.letter, field: w.field }; });
  delete resp.planned;
  return jsonResp(resp);
}

// ========== Helpers ==========
function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function digitsOnly(s) {
  return String(s == null ? '' : s).replace(/[^0-9]/g, '');
}

function normalize(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').trim().toLowerCase();
}

/**
 * [v350] 헤더 배열에서 컬럼 찾기 (1-based 컬럼 번호 반환) — nth occurrence 지원
 *   1. 정확 매칭 (정규화: 공백 제거 + 소문자) — N번째 occurrence
 *   2. 부분 일치 — N번째 occurrence
 *   3. fallback letter → letter to number
 *
 * @param headers       시트 1행 헤더 배열
 * @param keywords      검색할 헤더 이름 후보 (정확/부분 매칭에 모두 사용)
 * @param fallbackLetter 헤더 못 찾을 때 사용할 컬럼 letter
 * @param nth           몇 번째 occurrence? 0=첫번째, 1=두번째, ...
 *
 * 반환: { col, usedFallback, matchedHeader }
 */
function findColumn(headers, keywords, fallbackLetter, nth) {
  nth = nth || 0;
  var normHeaders = headers.map(normalize);
  // 1) 정확 매칭 — 각 키워드별로 모든 occurrence 수집 후 nth 선택
  for (var i = 0; i < keywords.length; i++) {
    var k = normalize(keywords[i]);
    if (!k) continue;
    var hits = [];
    for (var j = 0; j < normHeaders.length; j++) {
      if (normHeaders[j] === k) hits.push(j);
    }
    if (hits.length > nth) {
      var idx = hits[nth];
      return { col: idx + 1, usedFallback: false, matchedHeader: String(headers[idx]) };
    }
  }
  // 2) 부분 일치 — 각 키워드별로 모든 occurrence 수집 후 nth 선택
  for (var i = 0; i < keywords.length; i++) {
    var k = normalize(keywords[i]);
    if (!k) continue;
    var hits = [];
    for (var j = 0; j < normHeaders.length; j++) {
      if (normHeaders[j] && normHeaders[j].indexOf(k) >= 0) hits.push(j);
    }
    if (hits.length > nth) {
      var idx = hits[nth];
      return { col: idx + 1, usedFallback: false, matchedHeader: String(headers[idx]) };
    }
  }
  // 3) fallback
  var n = colLetterToNum(fallbackLetter);
  if (n > 0) return { col: n, usedFallback: true, matchedHeader: null };
  return { col: 0, usedFallback: true, matchedHeader: null };
}

// 'A' → 1, 'BF' → 58
function colLetterToNum(letters) {
  var n = 0;
  var s = String(letters || '').toUpperCase();
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i) - 64;
    if (c < 1 || c > 26) return 0;
    n = n * 26 + c;
  }
  return n;
}

// 1 → 'A', 58 → 'BF'
function numToColLetter(n) {
  if (!n || n < 1) return '';
  var s = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
