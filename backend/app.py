#!/usr/bin/env python3
"""
Alpha Finder — Backend API Server
Run: python3 app.py  →  http://localhost:5000

Routes:
  GET  /                → serves React build (static/dist/index.html)
  POST /api/run         → start a scan with given parameters
  POST /api/stop        → kill the running scan
  GET  /api/stream      → SSE stream of live log output
  GET  /api/results     → return scan_results.json
"""

import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR     = Path(__file__).parent
STATIC_DIR   = BASE_DIR / "static" / "dist"
RESULTS_JSON = BASE_DIR / "scan_results.json"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")

scan_state = {
    "running":   False,
    "log_queue": queue.Queue(),
    "proc":      None,
}


# ── SPA catch-all ─────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    if path.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    target = STATIC_DIR / path
    if path and target.exists():
        return send_from_directory(str(STATIC_DIR), path)
    return send_from_directory(str(STATIC_DIR), "index.html")


# ── API: Start scan ───────────────────────────────────────────────────────────

@app.route("/api/run", methods=["POST"])
def run_scan():
    if scan_state["running"]:
        return jsonify({"error": "Scan already running"}), 409

    params = request.get_json() or {}

    cmd = [sys.executable, str(BASE_DIR / "scanner.py"),
           "--lookback",  str(params.get("lookback",  30)),
           "--min-price", str(params.get("min_price", 5)),
           "--min-beta",  str(params.get("min_beta",  0)),
           "--workers",   str(params.get("workers",   10))]

    if int(params.get("sample", 0)):
        cmd += ["--sample", str(params["sample"])]

    env = os.environ.copy()
    env["ALPHA_MIN_CAP"] = str(params.get("min_cap", 500_000_000))

    def _run():
        scan_state["running"] = True
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, cwd=str(BASE_DIR), env=env,
            )
            scan_state["proc"] = proc
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    scan_state["log_queue"].put(("log", line))
            proc.wait()
            event = "done" if proc.returncode == 0 else "error_end"
            scan_state["log_queue"].put((event, ""))
        finally:
            scan_state["running"] = False
            scan_state["proc"]    = None

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"status": "started"})


# ── API: Stop scan ────────────────────────────────────────────────────────────

@app.route("/api/stop", methods=["POST"])
def stop_scan():
    proc = scan_state.get("proc")
    if proc:
        proc.terminate()
    return jsonify({"status": "stopped"})


# ── API: SSE log stream ───────────────────────────────────────────────────────

@app.route("/api/stream")
def stream():
    def _generate():
        while True:
            try:
                kind, data = scan_state["log_queue"].get(timeout=30)
                yield f"event: {kind}\ndata: {data}\n\n"
                if kind in ("done", "error_end"):
                    break
            except queue.Empty:
                yield "event: ping\ndata: \n\n"

    return Response(
        _generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── API: Results ──────────────────────────────────────────────────────────────

@app.route("/api/results")
def results():
    if RESULTS_JSON.exists():
        with open(RESULTS_JSON) as f:
            return jsonify(json.load(f))
    return jsonify({"tickers": [], "spy_return": 0, "total_winners": 0})


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"⚡ Alpha Finder API → http://localhost:{port}")
    app.run(debug=False, port=port, threaded=True)
