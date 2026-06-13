// Thin ZXing wrapper (reuses the approach proven in yamit-scanner). Browser-only.
// ZXing is loaded globally from CDN in index.html (window.ZXing).
export function createScanner() {
  let reader = null;
  let stream = null;
  let running = false;

  async function start(videoEl, onDecode) {
    if (running) return;
    if (!window.ZXing) throw new Error("ZXing not loaded");
    reader = new window.ZXing.BrowserMultiFormatReader();
    running = true;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }, audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    reader.decodeFromStream(stream, videoEl, (result, err) => {
      if (result && running) onDecode(result.getText());
    });
  }

  function stop(videoEl) {
    running = false;
    try { reader && reader.reset(); } catch {}
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (videoEl) videoEl.srcObject = null;
  }

  return { start, stop, get running() { return running; } };
}
