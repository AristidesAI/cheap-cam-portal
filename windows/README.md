# cheap-cam-portal — Windows

Same portal as the Mac version, packaged for Windows 10 / 11.

## What you need before you start

1. **Python 3.10 or newer.** Get it from <https://www.python.org/downloads/>
   and **tick "Add python.exe to PATH"** during the installer.
   *(If you already have Python — Microsoft Store version, or via winget —
   that works too.)*
2. **The camera is on your Wi-Fi**, has an IP your PC can reach
   (`ping 192.168.0.21` from `cmd` should respond).
3. **You know the camera's RTSP password.** Default for the HYW_T729 board
   is `super` / `fullhansuper`. If yours is different, see the main
   [README](../README.md) for the hardware-hack steps.

You do **not** need to install MediaMTX or FFmpeg yourself — `setup.bat`
will download those into `windows\bin\` automatically.

---

## One-time setup

1. **Download or clone the repo.** From GitHub click the green
   *Code → Download ZIP* button and unzip somewhere sensible
   (e.g. `C:\cheap-cam-portal\`).
2. Open the `windows` folder.
3. **Double-click `setup.bat`.**

A console window will pop up and walk through:

* Downloading `mediamtx.exe` (~10 MB) into `windows\bin\`
* Downloading `ffmpeg.exe` + `ffprobe.exe` (~80 MB) into `windows\bin\`
* Asking for your cam IP / username / password (press **Enter** to keep
  each default)
* Pinging the cam to confirm it's reachable
* Generating `mediamtx.yml`
* Starting MediaMTX + the portal backend in the background
* Opening your default browser to <http://127.0.0.1:8888/>

That's it. Pin the tab if you like.

---

## Daily use

| What you want | Double-click… |
|---|---|
| Start the portal (after a reboot, if you didn't set auto-start) | `windows\start.bat` |
| Stop it | `windows\stop.bat` |
| Change cam IP / password | delete `.env` in the project root, then `setup.bat` again |
| See logs | open `logs\mediamtx.log` or `logs\portal.log` in Notepad |

---

## Auto-start on every login (optional)

Double-click `windows\install-autostart.bat`. This drops a shortcut into
your **Startup folder**
(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`) that points
at `start.bat` with the *minimized* window flag, so it runs silently
every time you log in.

To turn it off: `windows\uninstall-autostart.bat`.

You can also verify or remove the shortcut manually:

1. Press `Win + R`, type `shell:startup`, Enter
2. Look for `cheap-cam-portal.lnk`
3. Delete the file to disable

---

## What survives a reboot?

| Event | Stream still works? |
|---|---|
| Cam loses power, comes back | ✅ yes — RTSP auto-starts on the cam, MediaMTX auto-reconnects |
| You hibernate / sleep your PC | ✅ yes — services resume |
| You **restart Windows** without auto-start | ❌ run `start.bat` again |
| You restart Windows **with auto-start** | ✅ portal is back at <http://127.0.0.1:8888/> within seconds |

---

## Troubleshooting

### Browser sits at "connecting WHEP…" forever

Open `logs\mediamtx.log` in Notepad:

* `404 Not Found` — wrong `CAM_PATH`. Try `stream0` instead of `stream1`
  (edit `.env`, then `windows\regen-config.bat`, then `windows\start.bat`).
* `401 Unauthorized` — wrong credentials. Try `admin` and a blank
  password as a second-guess; otherwise UART in (see main README).
* `connection refused` — wrong `CAM_IP` or the cam isn't on the network.

### `mediamtx.exe` blocked by Windows SmartScreen

First-run unsigned exes from GitHub releases get the
*"Windows protected your PC"* dialog. Click *More info → Run anyway*.
The binary is the official BlueNviron release; verify the hash from
[their release page](https://github.com/bluenviron/mediamtx/releases) if
you want to be sure.

### Antivirus quarantined `ffmpeg.exe`

FFmpeg's gpl builds occasionally trip heuristic scanners. Add an
exclusion for the `windows\bin\` folder or download a fresh copy from
[BtbN/FFmpeg-Builds releases](https://github.com/BtbN/FFmpeg-Builds/releases)
and drop it in.

### Recording produces a 0-byte MP4

You stopped recording before the cam emitted a keyframe (it does so
every ~5 seconds). Wait at least 6 s before stopping.

### Port 8888 or 8889 already in use

Something else is using those ports (Plex / OBS / a leftover MediaMTX
from a crash). Edit `.env` and change `HTTP_PORT` / `WEBRTC_PORT`, then
`windows\regen-config.bat && windows\start.bat`.

### `start.bat` runs but nothing happens / blank cmd window

Open `logs\portal.log` and `logs\mediamtx.log` in Notepad. Whatever's
wrong will be at the bottom.

### "Python was not found" message

Python isn't on your PATH. Re-install from
[python.org](https://www.python.org/downloads/) and make sure to
**tick "Add python.exe to PATH"** on the first screen of the installer.

---

## File layout (Windows-only bits)

```
cheap-cam-portal\
├── windows\
│   ├── README.md                 # this file
│   ├── cli.py                    # the brain (Python)
│   ├── setup.bat                 # one-time install
│   ├── start.bat                 # launch services
│   ├── stop.bat                  # kill them
│   ├── regen-config.bat          # rebuild mediamtx.yml from .env
│   ├── install-autostart.bat     # add startup shortcut
│   ├── uninstall-autostart.bat
│   └── bin\                      # downloaded mediamtx.exe + ffmpeg.exe
└── (shared with macOS — see ../README.md)
```

For everything else — what the portal actually does, the hardware-hack
writeup, photos of the UART pads, etc. — see the main
[../README.md](../README.md).
