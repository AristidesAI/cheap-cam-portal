#!/usr/bin/env python3
"""
Cam Portal backend.

Serves index.html + portal.js + portal.css at http://127.0.0.1:8888/
Endpoints:
  GET  /                     -> index.html
  GET  /portal.js, /portal.css
  GET  /status               -> JSON: { recording: {...}, mediamtx: bool }
  POST /record/start         -> spawns ffmpeg -> ~/Movies/cam-YYYYMMDD-HHMMSS.mp4
  POST /record/stop          -> stops the ffmpeg, returns filename + size
  POST /screenshot           -> grabs one frame from RTSP via ffmpeg, returns JPEG bytes
  GET  /recordings           -> JSON list of files in MOVIES_DIR with name+size+mtime
The WebRTC video itself is fetched directly from MediaMTX (127.0.0.1:8889/cam/whep)
by the browser. We don't proxy media.
"""
import os, sys, time, json, signal, subprocess, threading, datetime, socket
import http.server, socketserver, urllib.parse, mimetypes

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(ROOT)
ENV_FILE = os.path.join(PROJECT_ROOT, ".env")

def _load_env(path):
    env = {}
    if not os.path.exists(path): return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

_env = _load_env(ENV_FILE)
CAM_IP   = _env.get("CAM_IP",   "192.168.0.21")
CAM_USER = _env.get("CAM_USER", "super")
CAM_PASS = _env.get("CAM_PASS", "fullhansuper")
CAM_PORT = _env.get("CAM_PORT", "8554")
CAM_PATH = _env.get("CAM_PATH", "stream1")
RTSP_URL = f"rtsp://{CAM_USER}:{CAM_PASS}@{CAM_IP}:{CAM_PORT}/{CAM_PATH}"

HTTP_PORT = int(_env.get("HTTP_PORT", "8888"))
MEDIAMTX_HTTP = "http://127.0.0.1:" + _env.get("WEBRTC_PORT", "8889")
MOVIES_DIR = os.path.expanduser(_env.get("MOVIES_DIR", "~/Movies/cam-portal"))
SHOTS_DIR  = os.path.expanduser(_env.get("SHOTS_DIR",  "~/Pictures/cam-portal"))
os.makedirs(MOVIES_DIR, exist_ok=True)
os.makedirs(SHOTS_DIR, exist_ok=True)

_state_lock = threading.Lock()
_recording = {
    "proc": None,    # subprocess.Popen
    "path": None,    # str path
    "start": None,   # float ts
}

def _ts():
    return datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

def is_mediamtx_up():
    try:
        with socket.create_connection(("127.0.0.1", 8889), timeout=0.4):
            return True
    except Exception:
        return False

def start_recording():
    with _state_lock:
        if _recording["proc"] is not None and _recording["proc"].poll() is None:
            return {"ok": False, "error": "already recording", "path": _recording["path"]}
        fname = f"cam-{_ts()}.mp4"
        fpath = os.path.join(MOVIES_DIR, fname)
        cmd = [
            "/opt/homebrew/bin/ffmpeg",
            "-nostdin", "-hide_banner", "-loglevel", "warning",
            "-rtsp_transport", "tcp",
            "-fflags", "+nobuffer",
            "-flags", "low_delay",
            "-i", RTSP_URL,
            "-c:v", "copy",                  # H.264 passthrough — no transcode
            "-c:a", "aac", "-b:a", "96k",   # G.711 mu-law -> AAC for mp4 container
            "-movflags", "+faststart+frag_keyframe+empty_moov+default_base_moof",
            "-f", "mp4",
            fpath,
        ]
        log = open(fpath + ".log", "wb")
        proc = subprocess.Popen(cmd, stdout=log, stderr=log, start_new_session=True)
        _recording["proc"] = proc
        _recording["path"] = fpath
        _recording["start"] = time.time()
        return {"ok": True, "path": fpath, "pid": proc.pid}

def stop_recording():
    with _state_lock:
        proc = _recording["proc"]
        path = _recording["path"]
        if proc is None:
            return {"ok": False, "error": "not recording"}
        try:
            proc.send_signal(signal.SIGINT)  # graceful: flushes mp4 trailer
            try: proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.terminate()
                try: proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
        except Exception as e:
            return {"ok": False, "error": str(e)}
        size = os.path.getsize(path) if path and os.path.exists(path) else 0
        out = {"ok": True, "path": path, "size": size, "duration": time.time() - (_recording["start"] or time.time())}
        _recording["proc"] = None
        _recording["path"] = None
        _recording["start"] = None
        return out

def grab_screenshot():
    """Fetch one frame from RTSP via ffmpeg -> JPEG bytes."""
    fname = f"cam-{_ts()}.jpg"
    fpath = os.path.join(SHOTS_DIR, fname)
    cmd = [
        "/opt/homebrew/bin/ffmpeg",
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-rtsp_transport", "tcp",
        "-fflags", "+nobuffer",
        "-i", RTSP_URL,
        "-frames:v", "1",
        "-q:v", "2",
        "-y", fpath,
    ]
    r = subprocess.run(cmd, capture_output=True, timeout=8)
    if r.returncode != 0 or not os.path.exists(fpath):
        return None, (r.stderr or b"").decode("utf-8","replace")
    return fpath, None

def list_recordings():
    out = []
    for fn in sorted(os.listdir(MOVIES_DIR)):
        if not fn.endswith(".mp4"): continue
        p = os.path.join(MOVIES_DIR, fn)
        try: st = os.stat(p)
        except: continue
        out.append({"name": fn, "size": st.st_size, "mtime": st.st_mtime})
    return out

def list_screenshots():
    out = []
    for fn in sorted(os.listdir(SHOTS_DIR)):
        if not fn.endswith(".jpg"): continue
        p = os.path.join(SHOTS_DIR, fn)
        try: st = os.stat(p)
        except: continue
        out.append({"name": fn, "size": st.st_size, "mtime": st.st_mtime})
    return out

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "CamPortal/1"
    def log_message(self, *a, **k): pass

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError): pass

    def _send_file(self, path, ctype=None):
        try:
            with open(path, "rb") as f: data = f.read()
        except FileNotFoundError:
            self.send_error(404); return
        if ctype is None:
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try: self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError): pass

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/" or path == "/index.html":
            self._send_file(os.path.join(ROOT, "index.html"), "text/html; charset=utf-8")
        elif path == "/portal.js":
            self._send_file(os.path.join(ROOT, "portal.js"), "application/javascript")
        elif path == "/portal.css":
            self._send_file(os.path.join(ROOT, "portal.css"), "text/css")
        elif path == "/status":
            rec = None
            with _state_lock:
                if _recording["proc"] is not None and _recording["proc"].poll() is None:
                    rec = {
                        "path": _recording["path"],
                        "name": os.path.basename(_recording["path"] or ""),
                        "start": _recording["start"],
                        "duration": time.time() - (_recording["start"] or time.time()),
                        "size": os.path.getsize(_recording["path"]) if _recording["path"] and os.path.exists(_recording["path"]) else 0,
                    }
            self._send_json(200, {
                "mediamtx": is_mediamtx_up(),
                "recording": rec,
                "movies_dir": MOVIES_DIR,
                "shots_dir": SHOTS_DIR,
            })
        elif path == "/recordings":
            self._send_json(200, {"recordings": list_recordings(), "screenshots": list_screenshots()})
        elif path.startswith("/movies/"):
            name = os.path.basename(path[len("/movies/"):])
            fp = os.path.join(MOVIES_DIR, name)
            if not fp.startswith(MOVIES_DIR): self.send_error(403); return
            self._send_file(fp)
        elif path.startswith("/shots/"):
            name = os.path.basename(path[len("/shots/"):])
            fp = os.path.join(SHOTS_DIR, name)
            if not fp.startswith(SHOTS_DIR): self.send_error(403); return
            self._send_file(fp)
        else:
            self.send_error(404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/record/start":
            self._send_json(200, start_recording())
        elif path == "/record/stop":
            self._send_json(200, stop_recording())
        elif path == "/screenshot":
            p, err = grab_screenshot()
            if p is None:
                self._send_json(500, {"ok": False, "error": err}); return
            self._send_json(200, {"ok": True, "name": os.path.basename(p), "url": "/shots/" + os.path.basename(p)})
        else:
            self.send_error(404)

class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    srv = Threaded(("127.0.0.1", HTTP_PORT), Handler)
    print(f"Cam Portal listening on http://127.0.0.1:{HTTP_PORT}/", flush=True)
    print(f"  movies -> {MOVIES_DIR}", flush=True)
    print(f"  shots  -> {SHOTS_DIR}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        # try to stop any active recording cleanly
        stop_recording()
        srv.server_close()
        print("portal stopped")

if __name__ == "__main__":
    main()
