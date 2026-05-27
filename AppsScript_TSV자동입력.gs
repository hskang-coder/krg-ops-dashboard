/**
 * 개런티즈 계약서 — 마스터 시트 자동 입력 Apps Script Web App
 * v347 (안전 강화: 헤더 기반 매칭 + 5중 검증 + DRY_RUN 디폴트)
 *
 * 역할:
 *   대시보드 [수동 입력 모드]에서 계약서 생성 시
 *   미리 작성된 시트 행을 임차인명+전화번호로 찾아 update,
 *   못 찾으면 마지막 행에 append.
 *
 * 핵심 안전 설계:
 *   ★ 컬럼 추적은 "헤더 이름" 기준 (예: "현관번호" 라벨이 있는 컬럼)
 *   ★ 시트 컬럼이 추가/삭제/이동되어도 헤더만 유지되면 자동 추적
 *   ★ 헤더 못 찾으면 fallback letter 사용 + 응답에 경고 표시
 *   ★ 헤더도 없고 fallback도 의심스러우면 해당 필드 쓰기 SKIP (안전 우선)
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
 *   3. 배포 → 새 배포 → 웹 앱 (액세스: "모든 사용자")
 *   4. URL 운영책임자에게 전달 → 대시보드 CG_TSV_API_URL 설정
 *   5. **DRY_RUN 검증** — 시범 발행 1~2건 → 응답의 "planned" 확인
 *   6. 검증 완료 후 CFG_DRY_RUN = false 변경 + 재배포 → 실제 입력 시작
 */

// ========== CONFIG ==========
const CFG_SPREADSHEET_ID = '1Z3w9ZhKwiLfL4JJhs-gfcU27QLKgZAWycyGFCK4iiMc'; // 마스터
const CFG_SHEET_GID = 1931755549;
const CFG_SHEET_NAME = ''; // GID 폴백
const CFG_API_TOKEN = 'KRG-OPS-2026-CHANGE-ME-PLEASE'; // 반드시 변경
const CFG_DRY_RUN = true; // 검증 완료 후 false 로 변경

// 헤더 검증 — 시트 잘못 지정 방지
const CFG_REQUIRED_HEADER_KEYWORDS = ['계약번호', '임차인명'];

// 매칭에 사용할 컬럼 — 헤더 이름 우선, 못 찾으면 fallback letter
const CFG_MATCH_NAME = {
  headers: ['임차인명', '임차인 명', '전차인명', '전차인 이름'],
  fallbackCol: 'C'
};
const CFG_MATCH_PHONES = [
  { headers: ['전차인 연락처', '전차인연락처', '임차인 연락처', '임차인연락처'], fallbackCol: 'BE' },
  { headers: ['긴급연락처', '긴급 연락처'], fallbackCol: 'AY' }
];

// 쓰기 컬럼 매핑 — 헤더 우선, 못 찾으면 fallbackCol 사용
// 컬럼 추가/삭제/이동에 자동 대응 (헤더가 유지되는 한)
const CFG_FIELDS_MAP = [
  { field: 'doorPwd',     headers: ['현관번호', '현관 비밀번호', '현관비번', '현관'],                    fallbackCol: 'F'  },
  { field: 'tenantIdNo',  headers: ['전차인 주민번호', '전차인주민번호', '임차인 주민번호', '주민번호'],  fallbackCol: 'AW' },
  { field: 'tenantAddr',  headers: ['전차인 주소', '전차인주소', '임차인 주소'],                          fallbackCol: 'AX' },
  { field: 'emgPhone',    headers: ['긴급연락처', '긴급 연락처'],                                          fallbackCol: 'AY' },
  { field: 'emgRelName',  headers: ['관계,이름', '관계, 이름', '관계/이름', '관계이름'],                  fallbackCol: 'AZ' },
  { field: 'coName',      headers: ['공동계약자', '공동전차인 이름', '공동전차인이름', '공동 계약자'],     fallbackCol: 'BA' },
  { field: 'coPhone',     headers: ['공동계약자 연락처', '공동전차인 연락처', '공동전차인연락처'],         fallbackCol: 'BB' },
  { field: 'coIdNo',      headers: ['공동계약자 주민번호', '공동전차인 주민번호', '공동전차인주민번호'],   fallbackCol: 'BC' },
  { field: 'coAddr',      headers: ['공동계약자 주소', '공동전차인 주소', '공동전차인주소'],               fallbackCol: 'BD' },
  { field: 'tenantPhone', headers: ['전차인 연락처', '전차인연락처'],                                       fallbackCol: 'BE' },
  { field: 'tenantName',  headers: ['전차인 이름', '전차인이름'],                                            fallbackCol: 'BF' }
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
  return jsonResp({ status: 'ok', message: 'API ready', dryRun: CFG_DRY_RUN });
}

function upsertContract(data) {
  var fields = data.fields || {};
  var tenantName = String(fields.tenantName || '').trim();
  var tenantPhone = digitsOnly(fields.tenantPhone || '');

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
  var nameColResult = findColumn(headers, CFG_MATCH_NAME.headers, CFG_MATCH_NAME.fallbackCol);
  var nameColIdx = nameColResult.col;

  var phoneColIdxList = [];
  var phoneColWarns = [];
  CFG_MATCH_PHONES.forEach(function(spec){
    var r = findColumn(headers, spec.headers, spec.fallbackCol);
    if (r.col > 0) {
      phoneColIdxList.push(r.col);
      if (r.usedFallback) phoneColWarns.push('phone-' + spec.fallbackCol + ' 헤더 미발견 (fallback)');
    }
  });

  // 기존 행 매칭
  var lastRow = sheet.getLastRow();
  var matchedRow = 0;
  var matchedReason = '';
  if (lastRow >= 2) {
    var maxColForMatch = Math.max(nameColIdx, phoneColIdxList.length ? Math.max.apply(null, phoneColIdxList) : nameColIdx);
    var rows = sheet.getRange(2, 1, lastRow - 1, maxColForMatch).getValues();
    for (var r = 0; r < rows.length; r++) {
      var rowName = String(rows[r][nameColIdx - 1] || '').trim();
      if (rowName !== tenantName) continue;
      if (!tenantPhone) {
        matchedRow = r + 2;
        matchedReason = '이름만 일치 (전화 미입력)';
        break;
      }
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

  // 쓰기 컬럼 결정 — 헤더 매칭 + fallback 정책
  var writes = [];
  var warnings = [];
  CFG_FIELDS_MAP.forEach(function(spec){
    var val = fields[spec.field];
    if (val == null) return; // 빈값은 건너뜀
    val = String(val);
    var found = findColumn(headers, spec.headers, spec.fallbackCol);
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
        // 한 필드라도 fallback이면 전체 거부
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
      matchedHeader: found.matchedHeader || null
    });
  });

  if (CFG_FALLBACK_POLICY === 'reject' && warnings.some(function(w){ return w.indexOf('REJECT') >= 0; })) {
    return jsonResp({ status: 'error', message: 'fallback policy=reject — 헤더 누락으로 거부', warnings: warnings });
  }

  if (writes.length === 0) {
    return jsonResp({ status: 'error', message: '쓸 데이터 없음', warnings: warnings });
  }

  // 응답 빌더 (공통)
  var resp = {
    status: 'ok',
    dryRun: CFG_DRY_RUN,
    mode: mode,
    row: targetRow,
    sheet: sheet.getName(),
    matchedReason: matchedReason,
    planned: writes.map(function(w){
      return {
        col: w.letter,
        field: w.field,
        value: w.value,
        usedFallback: w.usedFallback,
        matchedHeader: w.matchedHeader
      };
    }),
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
 * 헤더 배열에서 컬럼 찾기 (1-based 컬럼 번호 반환)
 *   1. 정확 매칭 (정규화: 공백 제거 + 소문자)
 *   2. 부분 일치 (헤더 라벨이 keyword를 포함)
 *   3. fallback letter → letter to number
 * 반환: { col, usedFallback, matchedHeader }
 */
function findColumn(headers, keywords, fallbackLetter) {
  var normHeaders = headers.map(normalize);
  // 1) 정확 매칭
  for (var i = 0; i < keywords.length; i++) {
    var k = normalize(keywords[i]);
    if (!k) continue;
    for (var j = 0; j < normHeaders.length; j++) {
      if (normHeaders[j] === k) {
        return { col: j + 1, usedFallback: false, matchedHeader: String(headers[j]) };
      }
    }
  }
  // 2) 부분 일치
  for (var i = 0; i < keywords.length; i++) {
    var k = normalize(keywords[i]);
    if (!k) continue;
    for (var j = 0; j < normHeaders.length; j++) {
      if (normHeaders[j] && normHeaders[j].indexOf(k) >= 0) {
        return { col: j + 1, usedFallback: false, matchedHeader: String(headers[j]) };
      }
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
