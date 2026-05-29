// Cam Portal frontend
// - Connects to MediaMTX via WHEP for sub-second WebRTC playback
// - Applies CSS filters and transforms to the <video>
// - Local screenshot via canvas, server screenshot/record via backend
// - Local recording via MediaRecorder on captureStream()

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const WHEP_URL = "http://127.0.0.1:8889/cam/whep";
const STATUS_URL = "/status";
const REC_LIST_URL = "/recordings";

const video = $("#video");
const badge = $("#badge");
const recDot = $("#recDot");
const recTime = $("#recTime");
const stats = $("#stats");
const overlay = $("#overlay");
const resPill = $("#resPill");
const bitratePill = $("#bitratePill");
const fpsPill = $("#fpsPill");

let pc = null;
let stream = null;
let lastStatsAt = 0;
let lastBytes = 0;
let serverRecOn = false;
let serverRecStartedAt = 0;
let serverRecTimer = null;
let browserRec = null;
let browserRecChunks = [];

function setState(s, text) {
  badge.dataset.state = s;
  badge.textContent = text || s;
}

// ---------- WHEP / WebRTC ----------
async function connect() {
  try { if (pc) pc.close(); } catch {}
  pc = new RTCPeerConnection({
    iceServers: [],
    bundlePolicy: "max-bundle",
  });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const remote = new MediaStream();
  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach(t => remote.addTrack(t));
    video.srcObject = remote;
    stream = remote;
    setState("live", "live");
    // unmute logic: keep muted until the user clicks Volume / Unmute (autoplay rules)
  };

  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    if (s === "failed" || s === "disconnected") {
      setState("error", "ice " + s);
      setTimeout(() => { if (pc.iceConnectionState !== "connected") connect(); }, 1500);
    }
  };

  // WHEP: offer-only signaling
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  setState("connecting", "connecting WHEP…");
  let r;
  try {
    r = await fetch(WHEP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
  } catch (e) {
    setState("error", "WHEP fetch failed: " + e.message);
    setTimeout(connect, 1500);
    return;
  }
  if (!r.ok) {
    setState("error", "WHEP " + r.status);
    setTimeout(connect, 1500);
    return;
  }
  const answer = await r.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
}

// ---------- Filters and transforms ----------
const filterState = {
  rotate: 0, flipX: false, flipY: false, zoom: 100,
  brightness: 100, contrast: 100, saturate: 100,
  "hue-rotate": 0, sharpness: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0,
};

function applyFilters() {
  const fs = filterState;
  const parts = [];
  if (fs.brightness !== 100) parts.push(`brightness(${fs.brightness}%)`);
  if (fs.contrast !== 100) parts.push(`contrast(${fs.contrast}%)`);
  if (fs.saturate !== 100) parts.push(`saturate(${fs.saturate}%)`);
  if (fs["hue-rotate"] !== 0) parts.push(`hue-rotate(${fs["hue-rotate"]}deg)`);
  if (fs.blur > 0) parts.push(`blur(${fs.blur}px)`);
  if (fs.sepia > 0) parts.push(`sepia(${fs.sepia}%)`);
  if (fs.grayscale > 0) parts.push(`grayscale(${fs.grayscale}%)`);
  if (fs.invert > 0) parts.push(`invert(${fs.invert}%)`);
  if (fs.sharpness > 0) parts.push(`url(#sharpen)`);
  // SVG sharpen filter is appended once below.
  video.style.filter = parts.join(" ");
  ensureSharpenSvg(fs.sharpness);

  // transform: rotate + flip + zoom
  const sx = fs.flipX ? -1 : 1;
  const sy = fs.flipY ? -1 : 1;
  const scale = fs.zoom / 100;
  video.style.transform = `rotate(${fs.rotate}deg) scale(${scale * sx}, ${scale * sy})`;
}

let svgSharpenEl = null;
function ensureSharpenSvg(amount) {
  if (!svgSharpenEl) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
    svg.style.position = "absolute"; svg.style.pointerEvents = "none";
    svg.innerHTML = `
      <filter id="sharpen">
        <feConvolveMatrix id="sharpen-kernel" order="3" preserveAlpha="true"
          kernelMatrix="0 -1 0  -1 5 -1  0 -1 0"/>
      </filter>`;
    document.body.appendChild(svg);
    svgSharpenEl = svg;
  }
  // Scale kernel based on amount (0–200 %): center weight grows, neighbors get more negative
  const a = amount / 100; // 0..2
  const c = 1 + 4*a;
  const n = -a;
  const k = svgSharpenEl.querySelector("#sharpen-kernel");
  if (k) k.setAttribute("kernelMatrix", `0 ${n} 0  ${n} ${c} ${n}  0 ${n} 0`);
}

function bindFilterSliders() {
  $$('input[type=range][data-f]').forEach(inp => {
    const key = inp.dataset.f;
    const outEl = $(`[data-out="${key}"]`);
    function update() {
      const v = parseInt(inp.value, 10);
      filterState[key] = v;
      if (outEl) {
        const unit = (key === "blur") ? " px" : (key === "hue-rotate" ? "°" : "%");
        outEl.textContent = v + unit;
      }
      applyFilters();
    }
    inp.addEventListener("input", update);
    update();
  });
  // zoom is independent
  const zoomEl = $('input[data-f="zoom"]');
  if (zoomEl) {
    zoomEl.addEventListener("input", () => {
      filterState.zoom = parseInt(zoomEl.value, 10);
      $('[data-out="zoom"]').textContent = zoomEl.value + "%";
      applyFilters();
    });
  }
  // rotate buttons
  $$('.btn.xform[data-rotate]').forEach(b => {
    b.addEventListener("click", () => {
      filterState.rotate = parseInt(b.dataset.rotate, 10);
      $$('.btn.xform[data-rotate]').forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      applyFilters();
    });
  });
  // flip buttons
  $('.btn.xform[data-flipx]').addEventListener("click", e => {
    filterState.flipX = !filterState.flipX;
    e.currentTarget.setAttribute("aria-pressed", String(filterState.flipX));
    applyFilters();
  });
  $('.btn.xform[data-flipy]').addEventListener("click", e => {
    filterState.flipY = !filterState.flipY;
    e.currentTarget.setAttribute("aria-pressed", String(filterState.flipY));
    applyFilters();
  });
  $('#objectFit').addEventListener("change", e => {
    video.style.objectFit = e.target.checked ? "contain" : "fill";
  });
  $('#btnFiltersReset').addEventListener("click", () => {
    Object.assign(filterState, {
      rotate: 0, flipX: false, flipY: false, zoom: 100,
      brightness: 100, contrast: 100, saturate: 100,
      "hue-rotate": 0, sharpness: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0,
    });
    $$('input[type=range][data-f]').forEach(inp => {
      const def = { brightness:100, contrast:100, saturate:100, "hue-rotate":0,
                    sharpness:0, blur:0, sepia:0, grayscale:0, invert:0, zoom:100 }[inp.dataset.f] ?? 0;
      inp.value = def;
      inp.dispatchEvent(new Event("input"));
    });
    $$('.btn.xform').forEach(b => b.setAttribute("aria-pressed", b.dataset.rotate === "0" ? "true" : "false"));
    applyFilters();
  });
  $('#btnSavePreset').addEventListener("click", () => {
    localStorage.setItem("camPortal.preset", JSON.stringify(filterState));
    flash("preset saved");
  });
  $('#btnLoadPreset').addEventListener("click", () => {
    const s = localStorage.getItem("camPortal.preset");
    if (!s) return flash("no preset");
    Object.assign(filterState, JSON.parse(s));
    $$('input[type=range][data-f]').forEach(inp => {
      const v = filterState[inp.dataset.f];
      if (v != null) inp.value = v;
      inp.dispatchEvent(new Event("input"));
    });
    applyFilters();
    flash("preset loaded");
  });
}

// ---------- Audio / mute / volume / fullscreen / PiP ----------
function bindStreamButtons() {
  $('#btnReconnect').addEventListener("click", connect);
  $('#btnMute').addEventListener("click", e => {
    video.muted = !video.muted;
    e.currentTarget.setAttribute("aria-pressed", String(video.muted));
    e.currentTarget.textContent = video.muted ? "🔇 Muted" : "🔊 Audio";
    if (!video.muted && video.volume === 0) { video.volume = 0.6; $('#vol').value = 60; $('#volLbl').textContent = "60%"; }
  });
  $('#btnFs').addEventListener("click", () => {
    const el = $('#stage');
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  $('#btnPip').addEventListener("click", async () => {
    if (document.pictureInPictureElement) {
      try { await document.exitPictureInPicture(); } catch {}
    } else {
      try { await video.requestPictureInPicture(); } catch (e) { flash("PiP: " + e.message); }
    }
  });
  $('#vol').addEventListener("input", e => {
    const v = e.target.value;
    video.volume = v / 100;
    $('#volLbl').textContent = v + "%";
    if (v > 0 && video.muted) {
      video.muted = false;
      $('#btnMute').setAttribute("aria-pressed", "false");
      $('#btnMute').textContent = "🔊 Audio";
    }
  });
}

// ---------- Local screenshot ----------
function makeCanvasFromVideo() {
  // Compose the same visual: filter + transform must be re-applied via canvas.
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  // For rotation 90/270 we swap dimensions
  const r = filterState.rotate % 360;
  const swap = (r === 90 || r === 270);
  const W = swap ? vh : vw;
  const H = swap ? vw : vh;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.filter = video.style.filter || "none";
  ctx.translate(W/2, H/2);
  ctx.rotate(r * Math.PI / 180);
  const sx = filterState.flipX ? -1 : 1;
  const sy = filterState.flipY ? -1 : 1;
  ctx.scale(sx, sy);
  ctx.drawImage(video, -vw/2, -vh/2, vw, vh);
  return c;
}
function localScreenshot() {
  const c = makeCanvasFromVideo();
  if (!c) return flash("no frame yet");
  c.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    showSnapDialog(url, "cam-local-" + nowStamp() + ".png");
  }, "image/png");
}
function nowStamp() {
  const d = new Date();
  const z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
function showSnapDialog(url, filename) {
  const dlg = $("#snapDialog");
  const img = $("#snapImg");
  const dl  = $("#snapDl");
  img.src = url;
  dl.href = url;
  dl.download = filename;
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open","");
  $("#snapClose").onclick = () => { dlg.close?.(); dlg.removeAttribute("open"); };
}

async function serverScreenshot() {
  flash("capturing…");
  try {
    const r = await fetch("/screenshot", { method: "POST" });
    const j = await r.json();
    if (!j.ok) return flash("err: " + j.error);
    showSnapDialog(j.url, j.name);
    refreshRecordings();
  } catch (e) { flash("err: " + e.message); }
}

// ---------- Local recording (browser, MediaRecorder) ----------
function startBrowserRecord() {
  if (!stream) return flash("no stream");
  const target = document.createElement("canvas");
  // record the same composite the user sees, at native resolution
  function fitDims() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const r = filterState.rotate % 360;
    const swap = (r === 90 || r === 270);
    target.width = swap ? vh : vw;
    target.height = swap ? vw : vh;
  }
  fitDims();
  const ctx = target.getContext("2d");
  let drawing = true;
  function draw() {
    if (!drawing) return;
    if (video.videoWidth) {
      fitDims();
      const W = target.width, H = target.height;
      const vw = video.videoWidth, vh = video.videoHeight;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.filter = video.style.filter || "none";
      ctx.translate(W/2, H/2);
      ctx.rotate((filterState.rotate % 360) * Math.PI / 180);
      const sx = filterState.flipX ? -1 : 1;
      const sy = filterState.flipY ? -1 : 1;
      ctx.scale(sx, sy);
      ctx.drawImage(video, -vw/2, -vh/2, vw, vh);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  draw();
  const fps = 25;
  const cstream = target.captureStream(fps);
  // attach audio from the live stream if present
  stream.getAudioTracks().forEach(t => cstream.addTrack(t));
  const mime = pickMime();
  let rec;
  try {
    rec = new MediaRecorder(cstream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  } catch (e) {
    drawing = false;
    return flash("MediaRecorder: " + e.message);
  }
  browserRec = { rec, cstream, target, stopDraw: () => { drawing = false; }, chunks: [], mime };
  rec.ondataavailable = e => { if (e.data && e.data.size) browserRec.chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(browserRec.chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    a.download = "cam-local-" + nowStamp() + "." + ext;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    browserRec.stopDraw();
    browserRec = null;
    $("#btnRecBrowser").textContent = "⏺ Record (browser)";
    $("#btnRecBrowser").classList.remove("primary");
  };
  rec.start(1000);
  $("#btnRecBrowser").textContent = "⏹ Stop (browser)";
  $("#btnRecBrowser").classList.add("primary");
}
function pickMime() {
  const cand = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a",
  ];
  for (const c of cand) if (MediaRecorder.isTypeSupported(c)) return c;
  return "video/webm";
}
function stopBrowserRecord() {
  if (browserRec && browserRec.rec.state !== "inactive") browserRec.rec.stop();
}
function bindCaptureButtons() {
  $('#btnSnapLocal').addEventListener("click", localScreenshot);
  $('#btnSnapServer').addEventListener("click", serverScreenshot);
  $('#btnRecBrowser').addEventListener("click", () => {
    if (browserRec) stopBrowserRecord(); else startBrowserRecord();
  });
  $('#btnRecServer').addEventListener("click", async () => {
    if (serverRecOn) await stopServerRecord(); else await startServerRecord();
  });
}

// ---------- Server recording ----------
async function startServerRecord() {
  const r = await fetch("/record/start", { method: "POST" });
  const j = await r.json();
  if (!j.ok) return flash("server: " + j.error);
  serverRecOn = true;
  serverRecStartedAt = performance.now();
  $("#btnRecServer").textContent = "⏹ Stop (server MP4)";
  $("#btnRecServer").classList.remove("primary");
  $("#btnRecServer").classList.add("toggle");
  recDot.hidden = false;
  serverRecTimer = setInterval(updateRecTime, 250);
}
async function stopServerRecord() {
  if (serverRecTimer) clearInterval(serverRecTimer);
  recDot.hidden = true;
  const r = await fetch("/record/stop", { method: "POST" });
  const j = await r.json();
  serverRecOn = false;
  $("#btnRecServer").textContent = "⏺ Record (server MP4)";
  $("#btnRecServer").classList.add("primary");
  $("#btnRecServer").classList.remove("toggle");
  if (j.ok) flash(`saved: ${j.path.split("/").pop()} (${fmtBytes(j.size)})`);
  refreshRecordings();
}
function updateRecTime() {
  const sec = (performance.now() - serverRecStartedAt) / 1000;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  recTime.textContent = `${m}:${String(s).padStart(2,"0")}`;
}

// ---------- Recordings list ----------
async function refreshRecordings() {
  try {
    const j = await (await fetch(REC_LIST_URL)).json();
    const root = $("#recordings");
    root.innerHTML = "";
    j.recordings.slice(-6).reverse().forEach(rec => {
      const div = document.createElement("div");
      div.className = "rec";
      div.innerHTML = `<a href="/movies/${encodeURIComponent(rec.name)}" target="_blank">${rec.name}</a><span class="meta">${fmtBytes(rec.size)}</span>`;
      root.appendChild(div);
    });
    j.screenshots.slice(-4).reverse().forEach(s => {
      const div = document.createElement("div");
      div.className = "rec";
      div.innerHTML = `<a href="/shots/${encodeURIComponent(s.name)}" target="_blank">${s.name}</a><span class="meta">${fmtBytes(s.size)}</span>`;
      root.appendChild(div);
    });
  } catch {}
}
function fmtBytes(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024*1024) return (n/1024).toFixed(1) + " KB";
  if (n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + " MB";
  return (n/1024/1024/1024).toFixed(2) + " GB";
}

// ---------- Stats overlay ----------
async function tickStats() {
  if (!pc) return;
  let bytes = 0, fps = 0, w = 0, h = 0, codec = "";
  try {
    const r = await pc.getStats();
    let inboundV = null, inboundA = null;
    r.forEach(report => {
      if (report.type === "inbound-rtp" && report.kind === "video") inboundV = report;
      if (report.type === "inbound-rtp" && report.kind === "audio") inboundA = report;
    });
    if (inboundV) {
      bytes = inboundV.bytesReceived || 0;
      fps = inboundV.framesPerSecond || 0;
      w = inboundV.frameWidth || video.videoWidth || 0;
      h = inboundV.frameHeight || video.videoHeight || 0;
    }
    const now = performance.now();
    const dt = now - (lastStatsAt || now);
    let kbps = 0;
    if (lastStatsAt) kbps = ((bytes - lastBytes) * 8 / (dt/1000)) / 1000;
    lastStatsAt = now; lastBytes = bytes;
    resPill.textContent = w && h ? `${w}×${h}` : "— × —";
    bitratePill.textContent = kbps ? `${kbps.toFixed(0)} kbps` : "— kbps";
    fpsPill.textContent = fps ? `${fps.toFixed(0)} fps` : "— fps";

    const lines = [];
    lines.push(`state:        ${pc.iceConnectionState} / ${pc.connectionState}`);
    lines.push(`video:        ${w}x${h} @ ${fps?.toFixed?.(1) ?? fps} fps`);
    lines.push(`video kbps:   ${kbps.toFixed(0)}`);
    if (inboundV) {
      lines.push(`frames recv:  ${inboundV.framesReceived ?? "-"}`);
      lines.push(`frames drop:  ${inboundV.framesDropped ?? 0}`);
      lines.push(`packetsLost:  ${inboundV.packetsLost ?? 0}`);
      lines.push(`jitter:       ${(inboundV.jitter ?? 0).toFixed?.(3) ?? "-"}`);
    }
    if (inboundA) {
      lines.push(`audio kbps:   ~ ${(inboundA.bytesReceived || 0)/1024 | 0}`);
    }
    stats.textContent = lines.join("\n");
  } catch (e) {
    stats.textContent = "stats err: " + e.message;
  }
}
setInterval(tickStats, 1000);

// ---------- toast ----------
let toastTimer = null;
function flash(msg) {
  badge.dataset.state = "info";
  const prev = badge.textContent;
  badge.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { setState(pc && pc.iceConnectionState === "connected" ? "live" : "connecting", "live"); }, 1600);
}

// ---------- boot ----------
bindFilterSliders();
bindStreamButtons();
bindCaptureButtons();
refreshRecordings();
setInterval(refreshRecordings, 5000);

connect();
