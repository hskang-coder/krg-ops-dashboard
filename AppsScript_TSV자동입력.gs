/**
 * 개런티즈 계약서 TSV 자동 입력 — Apps Script Web App
 *
 * 역할: 대시보드(수동 입력 모드)에서 계약서 발행 시
 *       클립보드 복사 대신 시트에 자동 append/insert
 *
 * 배포 방법 (운영팀 1회 작업):
 *   1. Apps Script 편집기 (script.google.com) 에서 새 프로젝트 또는 기존 프로젝트에 본 코드 추가
 *   2. 아래 CONFIG 섹션의 값 확인/수정 (시트명, 토큰)
 *   3. 배포 → 새 배포 → 유형: 웹 앱
 *      - 액세스 권한: "모든 사용자" (anonymous + token으로 인증)
 *      - 실행 사용자: "본인 (운영팀 계정)"
 *   4. 발급된 URL을 운영책임자에게 전달 → 대시보드 CG_TSV_API_URL 상수에 설정
 *
 * 보안:
 *   - API_TOKEN 으로 호출 인증 (대시보드 코드와 일치해야 함)
 *   - 토큰 노출 시 본 파일에서 새 값으로 교체 → 재배포 → 대시보드 동시 갱신
 */

// ========== CONFIG (운영팀이 확인/수정) ==========
const CFG_SPREADSHEET_ID = ''; // 비워두면 ScriptProperties.SPREADSHEET_ID 사용 또는 활성 시트
// 시트 지정 방식: GID 우선, 없으면 SHEET_NAME 사용
const CFG_SHEET_GID = 1931755549; // 사용자 지정 등록 시트 GID (0이면 SHEET_NAME 사용)
const CFG_SHEET_NAME = '계약관리(Raw DATA)'; // GID로 찾기 실패 시 이름 폴백
const CFG_API_TOKEN = 'KRG-OPS-2026-CHANGE-ME'; // 보안 토큰 (반드시 임의 문자열로 변경)
const CFG_START_COL = 1; // TSV가 시작하는 컬럼 (1=A열). 운영 시트 구조에 맞게 조정
const CFG_INSERT_MODE = 'append'; // 'append' = 마지막 행에 추가 / 'firstEmpty' = 첫 빈 행에 입력
// ===============================================
// 주의: gid=1931755549가 운영루틴 시트인 경우 위 CFG_SHEET_GID를 0으로 두고
//       CFG_SHEET_NAME 에 실제 계약 입력 시트 이름을 지정하세요.

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResp({ status: 'error', message: 'empty post body' });
    }
    var data = JSON.parse(e.postData.contents);

    // 토큰 검증
    if (!data.token || data.token !== CFG_API_TOKEN) {
      return jsonResp({ status: 'error', message: 'invalid token' });
    }

    // action 분기
    if (data.action === 'appendTsv') {
      return appendTsv(data);
    }
    if (data.action === 'ping') {
      return jsonResp({ status: 'ok', message: 'pong', time: new Date().toISOString() });
    }

    return jsonResp({ status: 'error', message: 'unknown action: ' + (data.action || '(none)') });
  } catch (err) {
    return jsonResp({ status: 'error', message: String(err && err.message || err) });
  }
}

// GET (브라우저에서 직접 열어 ping 테스트용)
function doGet(e) {
  return jsonResp({ status: 'ok', message: 'TSV API ready', time: new Date().toISOString() });
}

/**
 * TSV(또는 cols 배열)를 시트에 추가
 * 요청 형식:
 *   { action: "appendTsv", token: "...", contractNo: "M-12345", cols: [c1, c2, ...] }
 *   또는
 *   { action: "appendTsv", token: "...", contractNo: "M-12345", tsv: "c1\tc2\t..." }
 */
function appendTsv(data) {
  var ss = openSpreadsheet();
  if (!ss) return jsonResp({ status: 'error', message: 'spreadsheet not found' });
  // [v346] GID 우선, 없으면 NAME 폴백
  var sheet = null;
  if (CFG_SHEET_GID) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === CFG_SHEET_GID) { sheet = sheets[i]; break; }
    }
  }
  if (!sheet) sheet = ss.getSheetByName(CFG_SHEET_NAME);
  if (!sheet) return jsonResp({ status: 'error', message: 'sheet not found (gid=' + CFG_SHEET_GID + ', name=' + CFG_SHEET_NAME + ')' });

  var cols = Array.isArray(data.cols) ? data.cols : (data.tsv ? String(data.tsv).split('\t') : []);
  if (!cols.length) return jsonResp({ status: 'error', message: 'empty cols/tsv' });

  // 시트 가용 너비 체크
  var maxCol = sheet.getMaxColumns();
  if (CFG_START_COL + cols.length - 1 > maxCol) {
    return jsonResp({ status: 'error', message: 'cols exceed sheet width' });
  }

  // 행 결정
  var targetRow;
  if (CFG_INSERT_MODE === 'firstEmpty') {
    targetRow = findFirstEmptyRow(sheet);
  } else {
    targetRow = sheet.getLastRow() + 1;
  }

  // 데이터 쓰기
  sheet.getRange(targetRow, CFG_START_COL, 1, cols.length).setValues([cols]);

  // 로그 시트 (옵션) — 누가, 언제, 어느 행에 추가했는지
  try {
    var logSheet = ss.getSheetByName('자동입력_로그');
    if (logSheet) {
      var who = (Session.getActiveUser && Session.getActiveUser().getEmail && Session.getActiveUser().getEmail()) || '(anonymous)';
      logSheet.appendRow([new Date(), data.contractNo || '', targetRow, who, JSON.stringify(cols).slice(0, 200)]);
    }
  } catch (_) {}

  return jsonResp({
    status: 'ok',
    row: targetRow,
    sheet: CFG_SHEET_NAME,
    contractNo: data.contractNo || '',
    startCol: CFG_START_COL
  });
}

function findFirstEmptyRow(sheet) {
  // A열 기준으로 첫 빈 행 찾기 (헤더 = 1행 가정)
  var lastRow = sheet.getLastRow();
  var col1 = sheet.getRange(2, 1, lastRow || 1, 1).getValues();
  for (var i = 0; i < col1.length; i++) {
    if (!col1[i][0] || String(col1[i][0]).trim() === '') return i + 2;
  }
  return lastRow + 1;
}

function openSpreadsheet() {
  if (CFG_SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CFG_SPREADSHEET_ID);
  }
  var stored = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (stored) return SpreadsheetApp.openById(stored);
  // 마지막 폴백: 활성 시트 (스크립트가 시트에 바인딩된 경우)
  return SpreadsheetApp.getActiveSpreadsheet();
}

function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
