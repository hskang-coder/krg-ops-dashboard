(function(){
  // commit message 설정
  var inp = document.querySelector('input[name="commit-summary"]') || document.querySelector('input#commit-summary');
  if (!inp) {
    var inputs = document.querySelectorAll('input[type="text"]');
    for (var i=0; i<inputs.length; i++) {
      if (inputs[i].placeholder && inputs[i].placeholder.indexOf('Add files') >= 0) { inp = inputs[i]; break; }
    }
  }
  if (!inp) return 'COMMIT_INPUT_NOT_FOUND';
  var nv = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nv.call(inp, 'feat(v74): 계약관리 탭 Phase 1 신설 (진척 체크리스트 5항목)');
  inp.dispatchEvent(new Event('input', {bubbles:true}));
  inp.dispatchEvent(new Event('change', {bubbles:true}));
  // commit 버튼 클릭
  var btns = document.querySelectorAll('button[type="submit"]');
  for (var i=0; i<btns.length; i++) {
    if (btns[i].textContent.indexOf('Commit changes') >= 0) { btns[i].click(); return 'COMMIT_MSG_SET_AND_CLICKED'; }
  }
  return 'COMMIT_MSG_SET_BUT_BTN_NOT_FOUND';
})()
