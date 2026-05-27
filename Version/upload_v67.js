(function(){
  var b64 = window.__v67_full_b64;
  if (!b64) return 'NO_B64';
  var binary = atob(b64);
  var bytes = new Uint8Array(binary.length);
  for (var i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  var blob = new Blob([bytes], {type: 'text/html'});
  var file = new File([blob], '운영팀_대시보드.html', {type: 'text/html', lastModified: Date.now()});
  var dt = new DataTransfer();
  dt.items.add(file);
  var dropZone = document.querySelector('.dropzone') || document.querySelector('[class*="UploadFile"]') || document.body;
  var fileInput = document.querySelector('input[type=file]');
  if (fileInput) {
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', {bubbles:true}));
  }
  var dropEvent = new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer: dt});
  dropZone.dispatchEvent(dropEvent);
  return 'UPLOAD_TRIGGERED file_size=' + bytes.length;
})()
