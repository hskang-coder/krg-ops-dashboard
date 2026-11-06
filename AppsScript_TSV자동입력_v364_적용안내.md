# 계약서 발행 → 마스터 시트 자동 입력 Apps Script v364 적용 안내 (운영팀용)

작성: 2026-11-06 · 대상: 개런티즈Dashboard_V7.0 에 배포된 "TSV 자동입력" Apps Script (현재 배포본 v363)

## 1. 무슨 일이 있었나

- 2026-11-02 무렵 마스터 시트 **「계약관리」 탭 A1 셀(헤더 "계약번호")이 공백으로 바뀌었습니다.**
- Apps Script 는 안전장치로 1행 헤더에 "계약번호"가 있어야 쓰기를 진행하기 때문에, 그 뒤 모든 발행에서
  `헤더 검증 실패 — 필수 키워드 "계약번호" 없음` 으로 거부됐고 **11/2~11/5 체결 16건의 임차인 상세(AW~AZ열)가 입력되지 않았습니다.**
- 같은 사고가 2026-05-21 에도 있었습니다(대시보드 v324 로 화면 쪽만 보강). 이번에 Apps Script 쪽도 보강합니다.

## 2. 지금 바로 할 일 (1분)

1. 개런티즈Dashboard_V7.0 › 「계약관리」 탭 **A1 셀에 `계약번호` 입력** → 재배포 없이 즉시 복구됩니다.
2. 11/2~11/5 체결 16건은 대시보드 수동 입력 모드로 다시 발행하거나, 발행 때 클립보드에 복사된 TSV 를 해당 행(AU열부터)에 붙여넣어 주세요.
   - 11/2: 65131, 64998, 64996 · 11/3: 65109, 65105, 65085, 65084, 65070, 65012, 64928 · 11/4: 65118, 65115 · 11/5: 65133, 65087, 65021, 64578

## 3. v364 가 바뀌는 점

| 항목 | v363(현재) | v364 |
|---|---|---|
| A1 헤더 공백 | 전체 거부 | **A열을 "계약번호"로 간주하고 진행** + 응답 `warnings` 에 "A1 헤더 공백 …" 표시 |
| 임차인명 헤더 | "임차인명" 필수 | "임차인명" **또는 "임차인"** (실제 AU열 헤더) 중 하나면 통과 |
| 요청별 DRY_RUN | 없음 (CFG_DRY_RUN 전역만) | 요청 본문 `dryRun:true` 면 **쓰지 않고 planned 만 응답** → 대시보드 「사전 확인 (시트에 안 씀)」 버튼 전용 |
| ping / GET 응답 | `{status, message, dryRun}` | + `version:"v364"`, `features:{dryRunFlag:true, a1Fallback:true}` → 대시보드(v728)가 기능 지원을 자동 감지 |

대시보드 v728 은 이미 배포돼 있어, v364 를 배포하는 순간 「사전 확인」 버튼이 활성화되고 A1 경고 배너는 자동으로 사라집니다.
(v364 배포 전에는 「사전 확인」 버튼이 서버에 아무것도 보내지 않고 안내만 띄웁니다 — 실제 입력 모드 서버에 테스트 요청이 기록되는 사고 방지)

## 4. 적용 방법

### 방법 A — 파일 전체 교체 (권장)

1. 시트 › 확장 프로그램 › Apps Script 편집기에서 기존 코드를 저장소의 `AppsScript_TSV자동입력.gs`(v364) 로 교체
2. **배포본의 두 값은 반드시 그대로 유지**
   - `CFG_API_TOKEN` : 현재 배포본 값 그대로 (저장소 파일의 값으로 덮어쓰지 말 것 — 대시보드에 설정된 토큰과 달라지면 `invalid token` 으로 전부 거부됨)
   - `CFG_DRY_RUN`   : 현재 배포본 값 `false` (저장소 파일은 `true` — 바꾸지 않으면 실제 입력이 멈춥니다)
   - 배포본에서 직접 고친 다른 설정(헤더 키워드·매핑 등)이 있으면 함께 옮겨 주세요
3. 배포 › 배포 관리 › 연필(수정) › 버전 "새 버전" › 배포 — **URL 은 그대로 유지**됩니다

### 방법 B — 배포본에 최소 수정 (5곳)

(1) CONFIG 에 추가
```js
const CFG_REQUIRED_HEADER_GROUPS = [ ['계약번호'], ['임차인명', '임차인'] ];
const CFG_A1_FALLBACK_LABEL = '계약번호';
const CFG_VERSION = 'v364';
const CFG_FEATURES = { dryRunFlag: true, a1Fallback: true };
```

(2) `doPost` 의 ping 응답 / `doGet` 응답
```js
if (data.action === 'ping') {
  return jsonResp({ status: 'ok', message: 'pong', dryRun: CFG_DRY_RUN, version: CFG_VERSION,
                    dryRunFlag: true, a1Fallback: true, features: CFG_FEATURES, time: new Date().toISOString() });
}
function doGet() {
  return jsonResp({ status: 'ok', message: 'API ready', dryRun: CFG_DRY_RUN, version: CFG_VERSION, features: CFG_FEATURES });
}
```

(3) `upsertContractInner` 첫 줄 바로 아래
```js
var dry = !!CFG_DRY_RUN || data.dryRun === true;
```

(4) 헤더 읽기 + 검증 블록 교체
```js
var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
var hdrWarnings = [];
if (!String(headers[0] == null ? '' : headers[0]).trim()) {
  headers = headers.slice();
  headers[0] = CFG_A1_FALLBACK_LABEL;
  hdrWarnings.push('A1 헤더 공백 — A열을 ' + CFG_A1_FALLBACK_LABEL + ' 로 간주하고 진행 (마스터 시트 A1 에 "' + CFG_A1_FALLBACK_LABEL + '" 를 다시 입력해 주세요)');
}
var headerJoin = headers.map(function(x){ return String(x||''); }).join('|');
for (var k = 0; k < CFG_REQUIRED_HEADER_GROUPS.length; k++) {
  var grp = CFG_REQUIRED_HEADER_GROUPS[k];
  var hit = grp.some(function(kw){ return headerJoin.indexOf(kw) >= 0; });
  if (!hit) {
    return jsonResp({ status: 'error', message: '헤더 검증 실패 — 필수 키워드 "' + grp.join('/') + '" 없음. 시트 ID/GID 확인 필요.', sheetName: sheet.getName(), warnings: hdrWarnings });
  }
}
```
그리고 뒤쪽의 `var warnings = [];` → `var warnings = hdrWarnings.slice();`

(5) 응답의 `dryRun: CFG_DRY_RUN` (noop 응답·공통 응답 2곳) → `dryRun: dry`, 그리고
```js
if (dry) {   // 기존: if (CFG_DRY_RUN)
  resp.message = CFG_DRY_RUN
    ? 'DRY_RUN — 실제 쓰지 않음. 검증 완료 후 CFG_DRY_RUN=false 변경.'
    : '사전 확인(요청별 DRY_RUN) — 실제 쓰지 않음. 「계약서 생성」으로 발행하면 위 내용이 입력됩니다.';
  return jsonResp(resp);
}
```

## 5. 배포 확인

- 브라우저에서 배포 URL(GET) 열기 → `{"status":"ok","message":"API ready","dryRun":false,"version":"v364","features":{...}}`
- 대시보드 › 입주관리 › 계약서 발행 › 수동 입력 › 계약번호·임차인명·긴급연락처 입력 후 「🔍 사전 확인 (시트에 안 씀)」 → 쓰기 예정 열/값이 표시되면 완료
  (v363 상태에서는 "사전 확인 불가 — 시트에 아무것도 쓰지 않았습니다" 안내만 뜹니다)

## 6. 참고 — 왜 A1 이 비었는지

A1 셀은 행 정렬·필터·행 추가 작업 중 쉽게 지워지는 위치입니다(2026-05-21, 2026-11-02 두 번째). v364 적용 후에는 비어 있어도 입력이 막히지 않지만,
대시보드 검색·연체 화면도 A열 헤더에 의존하므로 **A1 은 "계약번호"로 유지**해 주세요. 셀 보호(데이터 › 시트 및 범위 보호 › A1)로 실수 삭제를 막을 수 있습니다.
