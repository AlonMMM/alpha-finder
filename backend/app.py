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

import itertools
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib3
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, request, send_from_directory

# CP Gateway uses a self-signed cert — suppress SSL warnings for localhost calls
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CP_BASE = os.environ.get("CP_BASE", "https://localhost:5055/v1/api")

BASE_DIR     = Path(__file__).parent
STATIC_DIR   = BASE_DIR / "static" / "dist"
RESULTS_JSON = BASE_DIR / "scan_results.json"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")

scan_state = {
    "running":   False,
    "log_queue": queue.Queue(),
    "proc":      None,
}

ib_state = {"user_logged_out": False}


# ── CP Gateway session keepalive ──────────────────────────────────────────────

def _ib_keepalive():
    """Ping CP Gateway tickle endpoint every 60s to keep the session alive."""
    while True:
        time.sleep(60)
        if ib_state.get("user_logged_out"):
            continue
        try:
            requests.post(f"{CP_BASE}/tickle", verify=False, timeout=5)
        except Exception:
            pass

threading.Thread(target=_ib_keepalive, daemon=True).start()


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


# ── IB Login proxy ───────────────────────────────────────────────────────────
# Proxies https://localhost:5055 through Flask so the browser never has to
# deal with the self-signed cert or cross-origin redirects.

@app.route("/ib-login", defaults={"path": ""})
@app.route("/ib-login/<path:path>", methods=["GET", "POST"])
def ib_login_proxy(path):
    target = f"https://localhost:5055/{path}"
    qs     = request.query_string.decode()
    if qs:
        target += f"?{qs}"
    try:
        resp = requests.request(
            method  = request.method,
            url     = target,
            headers = {k: v for k, v in request.headers if k.lower() not in
                       ("host", "content-length", "transfer-encoding")},
            data    = request.get_data(),
            cookies = request.cookies,
            allow_redirects = False,
            verify  = False,
            timeout = 15,
        )
        # Rewrite redirect Location headers to go through our proxy
        headers = {}
        for k, v in resp.headers.items():
            if k.lower() == "location":
                if v.startswith("https://localhost:5055"):
                    v = v.replace("https://localhost:5055", "/ib-login")
                elif v.startswith("/") and not v.startswith("/ib-login"):
                    v = "/ib-login" + v
            if k.lower() not in ("transfer-encoding", "content-encoding", "content-length"):
                headers[k] = v

        content = resp.content
        ct      = resp.headers.get("Content-Type", "")

        # Rewrite absolute URLs in HTML/JS responses
        if "text/html" in ct or "javascript" in ct:
            content = content.replace(
                b"https://localhost:5055", b""
            ).replace(
                b"http://localhost:5055", b""
            )
            # Rewrite relative root-paths: href="/" action="/" src="/" → prefix /ib-login
            import re as _re
            def _prefix(m):
                attr, path = m.group(1), m.group(2)
                if path.startswith("/ib-login") or path.startswith("http"):
                    return m.group(0)
                return (attr + b'="/ib-login' + path + b'"').encode() if isinstance(path, str) else attr + b'="/ib-login' + path + b'"'
            content = _re.sub(
                rb'((?:href|action|src)=")(/[^"]*)',
                lambda m: m.group(1) + (b"/ib-login" if not m.group(2).startswith(b"/ib-login") else b"") + m.group(2),
                content
            )

        return app.response_class(
            response  = content,
            status    = resp.status_code,
            headers   = headers,
            mimetype  = ct or "text/html",
        )
    except requests.exceptions.ConnectionError:
        return "<h2>CP Gateway is not running.</h2><p>Start it with: <code>cd clientportal && bin/run.sh root/conf.yaml</code></p>", 503


# ── CP Gateway helpers ────────────────────────────────────────────────────────

def cp(path, method="GET", **kwargs):
    """Call CP Gateway, returns parsed JSON or raises."""
    r = requests.request(method, f"{CP_BASE}{path}", verify=False, timeout=10, **kwargs)
    r.raise_for_status()
    return r.json()


def _f(val):
    """Parse CP Gateway market data value — strips leading letter codes like 'C2.24'."""
    if val is None:
        return None
    m = re.search(r"[-+]?\d+\.?\d*", str(val).strip())
    return float(m.group()) if m else None


def _und_price(conid):
    """Fetch underlying mid price with two-pass snapshot."""
    cp(f"/iserver/marketdata/snapshot?conids={conid}&fields=31,84,86")
    time.sleep(1)
    snap = cp(f"/iserver/marketdata/snapshot?conids={conid}&fields=31,84,86")
    s = snap[0] if snap else {}
    b, a, last = _f(s.get("84")), _f(s.get("86")), _f(s.get("31"))
    return round((b + a) / 2, 2) if b and a else last


def _front_future(symbol):
    """Return the front-month tradeable futures contract."""
    futures = cp(f"/trsrv/futures?symbols={symbol}")
    return sorted(futures.get(symbol, []), key=lambda x: x["expirationDate"])[0]


def _fetch_options(search_conid, sectype, exchange, month, exp_date, und_price,
                   right="C", otm_only=True):
    """Fetch option contracts + market data for the given right (C or P)."""
    chain = cp(f"/iserver/secdef/info?conid={search_conid}&sectype={sectype}"
               f"&month={month}&exchange={exchange}")
    def _is_otm(strike):
        if not otm_only:
            return True
        if right == "C":
            return float(strike) > und_price   # OTM call: strike above spot
        else:
            return float(strike) < und_price   # OTM put:  strike below spot

    contracts = [
        c for c in chain
        if c.get("right") == right
        and (exp_date is None or c.get("maturityDate") == exp_date)
        and _is_otm(c.get("strike", 0))
    ]
    contracts.sort(key=lambda c: float(c["strike"]))
    if not contracts:
        return []

    conids = [str(c["conid"]) for c in contracts]
    fields = "31,84,86,87,7308,7309"
    cp(f"/iserver/marketdata/snapshot?conids={','.join(conids)}&fields={fields}")
    time.sleep(1)
    snaps = cp(f"/iserver/marketdata/snapshot?conids={','.join(conids)}&fields={fields}")
    md = {str(s["conid"]): s for s in (snaps or [])}

    rows = []
    for c in contracts:
        s   = md.get(str(c["conid"]), {})
        bid = _f(s.get("84"))
        ask = _f(s.get("86"))
        rows.append({
            "strike": float(c["strike"]),
            "bid":    bid,
            "ask":    ask,
            "mid":    round((bid + ask) / 2, 3) if bid and ask else None,
            "last":   _f(s.get("31")),
            "volume": _f(s.get("87")),
            "iv":     _f(s.get("7308")),
            "delta":  _f(s.get("7309")),
        })
    return rows


# Keep old name for any callers
def _fetch_calls(search_conid, sectype, exchange, month, exp_date, und_price, otm_only=True):
    return _fetch_options(search_conid, sectype, exchange, month, exp_date,
                          und_price, right="C", otm_only=otm_only)


def _best_price(row, mode):
    if mode == "bid":
        return row.get("bid") or row.get("mid") or row.get("last")
    if mode == "mid":
        return row.get("mid") or row.get("last") or row.get("ask")
    if mode == "last":
        return row.get("last") or row.get("mid") or row.get("ask")
    return row.get("ask") or row.get("mid") or row.get("last")


# ── API: IB auth status ───────────────────────────────────────────────────────

@app.route("/api/ib/status")
def ib_status():
    try:
        data = cp("/iserver/auth/status")
        authed = data.get("authenticated", False)
        # Only reauth if user hasn't explicitly logged out
        if not authed and not ib_state["user_logged_out"] and data.get("connected") is False:
            try:
                cp("/iserver/reauthenticate", method="POST")
            except Exception:
                pass
        return jsonify({"authenticated": authed,
                        "connected":     data.get("connected", False),
                        "competing":     data.get("competing", False)})
    except requests.exceptions.HTTPError as e:
        if e.response is not None and e.response.status_code == 401:
            # CP Gateway returns 401 until a browser session is opened at localhost:5055
            return jsonify({"authenticated": False, "needs_browser": True}), 200
        return jsonify({"authenticated": False, "error": str(e)}), 200
    except Exception as e:
        return jsonify({"authenticated": False, "error": str(e)}), 200


@app.route("/api/ib/logout", methods=["POST"])
def ib_logout():
    ib_state["user_logged_out"] = True
    try:
        cp("/logout", method="POST")
    except Exception:
        pass
    # Restart CP Gateway container to fully clear the session
    try:
        import subprocess
        subprocess.Popen(
            ["docker", "restart", "alpha-finder-cpgw-1"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except Exception:
        pass
    return jsonify({"ok": True})


@app.route("/api/ib/login", methods=["POST"])
def ib_login():
    """Reset the logged-out flag so reauthenticate resumes on next status poll."""
    ib_state["user_logged_out"] = False
    return jsonify({"ok": True})


# ── API: Options chain (CP Gateway REST) ─────────────────────────────────────

@app.route("/api/options")
def options_chain():
    symbol   = request.args.get("symbol", "MCL")
    expiry   = request.args.get("expiry", "")  # e.g. "APR26" or empty = front month
    exchange = request.args.get("exchange", "NYMEX")

    try:
        # 1. Search for the futures — get conid + available FOP months
        search = cp(f"/iserver/secdef/search?symbol={symbol}&secType=FUT")
        if not search:
            return jsonify({"error": f"No contract found for {symbol}"}), 404

        fut_info = next((s for s in search if s.get("secType") == "FUT"), search[0])
        conid    = fut_info["conid"]

        # Parse available FOP months from search result sections
        sections        = fut_info.get("sections", [])
        fop_section     = next((s for s in sections if s.get("secType") == "FOP"), None)
        all_expirations = fop_section["months"].split(";") if fop_section else []

        if not all_expirations:
            return jsonify({"error": "No FOP months found for this contract"}), 404

        # Pick target month (default = front month)
        if expiry:
            target_month = next((m for m in all_expirations if m.startswith(expiry.upper())), None)
            if not target_month:
                return jsonify({"error": f"Expiry '{expiry}' not found", "available": all_expirations}), 400
        else:
            target_month = all_expirations[0]

        # 2. Get underlying price snapshot
        snapshot  = cp(f"/iserver/marketdata/snapshot?conids={conid}&fields=31,84,86")
        und_price = None
        if snapshot:
            snap = snapshot[0]
            b, a, last = _f(snap.get("84")), _f(snap.get("86")), _f(snap.get("31"))
            if b and a:
                und_price = round((b + a) / 2, 2)
            elif last:
                und_price = round(last, 2)

        # 3. Get all option contracts for this month (no strike filter = returns all)
        chain_def = cp(
            f"/iserver/secdef/info?conid={conid}&sectype=FOP"
            f"&month={target_month}&exchange={exchange}"
        )
        if not chain_def:
            return jsonify({"error": f"No option chain data for {target_month}"}), 404

        # 4. Fetch market data snapshots in chunks of 100
        all_conids = [str(c["conid"]) for c in chain_def]
        md     = {}
        fields = "31,84,86,87,7283,7308,7309,7310,7311"  # last,bid,ask,vol,OI,IV,delta,gamma,theta
        # First pass — subscribe
        for i in range(0, len(all_conids), 100):
            chunk = ",".join(all_conids[i:i+100])
            snaps = cp(f"/iserver/marketdata/snapshot?conids={chunk}&fields={fields}")
            for s in (snaps or []):
                md[str(s["conid"])] = s
        # Second pass — data often arrives on second call
        import time; time.sleep(1)
        for i in range(0, len(all_conids), 100):
            chunk = ",".join(all_conids[i:i+100])
            snaps = cp(f"/iserver/marketdata/snapshot?conids={chunk}&fields={fields}")
            for s in (snaps or []):
                md[str(s["conid"])] = s

        # Build rows
        rows = []
        for c in chain_def:
            s     = md.get(str(c["conid"]), {})
            bid   = _f(s.get("84"))
            ask   = _f(s.get("86"))
            rows.append({
                "expiration":    c["maturityDate"],
                "type":          "call" if c.get("right") == "C" else "put",
                "strike":        float(c.get("strike", 0)),
                "last":          _f(s.get("31")),
                "bid":           bid,
                "ask":           ask,
                "mid":           round((bid + ask) / 2, 4) if bid and ask else None,
                "volume":        _f(s.get("87")),
                "open_interest": _f(s.get("7283")),
                "iv":            round(_f(s.get("7308")) * 100, 2) if s.get("7308") else None,
                "delta":         _f(s.get("7309")),
                "gamma":         _f(s.get("7310")),
                "theta":         _f(s.get("7311")),
            })

    except requests.exceptions.ConnectionError:
        return jsonify({
            "error": "Cannot connect to CP Gateway. Is it running? Start it with: cd clientportal && bin/run.sh root/conf.yaml"
        }), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 502

    return jsonify({
        "symbol":      symbol,
        "expiry":      target_month,
        "und_price":   und_price,
        "expirations": all_expirations,
        "rows":        rows,
    })


# ── API: Symbol info (futures months + underlying price) ─────────────────────

@app.route("/api/ib/symbol-info")
def symbol_info():
    symbol = request.args.get("symbol", "MCL").upper()
    try:
        # Try futures first, fall back to equity
        is_future = False
        search     = cp(f"/iserver/secdef/search?symbol={symbol}&secType=FUT")
        entry      = next((s for s in (search or []) if isinstance(s, dict) and s.get("conid")), None)

        if entry:
            sections = entry.get("sections", [])
            fop_sec  = next((s for s in sections if s.get("secType") == "FOP"), None)
            if fop_sec:
                is_future = True

        # If not a future with FOP options, search as equity
        if not is_future:
            search = cp(f"/iserver/secdef/search?symbol={symbol}&secType=STK")
            # Prefer entries that have OPT sections with months
            entry = next(
                (s for s in (search or [])
                 if isinstance(s, dict) and s.get("conid")
                 and any(sec.get("secType") == "OPT" and sec.get("months")
                         for sec in s.get("sections", []))),
                None
            )
            # Fall back to first STK result if none has OPT sections
            if not entry:
                entry = next((s for s in (search or []) if isinstance(s, dict) and s.get("conid")), None)
            if not entry:
                return jsonify({"error": f"Symbol {symbol} not found as FUT or STK"}), 404
            sections = entry.get("sections", [])

        search_conid = entry["conid"]

        if is_future:
            opt_sec    = next((s for s in sections if s.get("secType") == "FOP"), None)
            months     = opt_sec["months"].split(";") if opt_sec else []
            sectype    = "FOP"
            exchange   = "NYMEX"
            front      = _front_future(symbol)
            und_price  = _und_price(front["conid"])
        else:
            opt_sec    = next((s for s in sections if s.get("secType") == "OPT"), None)
            months     = opt_sec["months"].split(";") if opt_sec else []
            sectype    = "OPT"
            exchange   = "SMART"
            und_price  = _und_price(search_conid)

        return jsonify({
            "symbol":       symbol,
            "search_conid": search_conid,
            "is_future":    is_future,
            "sectype":      sectype,
            "exchange":     exchange,
            "opt_months":   months,
            "und_price":    und_price,
        })
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "CP Gateway offline"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ── API: Expiry dates within a FOP month ─────────────────────────────────────

@app.route("/api/ib/expirations")
def ib_expirations():
    month        = request.args.get("month",    "")
    search_conid = request.args.get("conid",    "")
    sectype      = request.args.get("sectype",  "FOP")
    exchange     = request.args.get("exchange", "NYMEX")

    if not month or not search_conid:
        return jsonify({"error": "month and conid required"}), 400
    try:
        if sectype == "OPT":
            # secdef/info for OPT requires a strike — fetch one from strikes endpoint first
            strikes_data = cp(f"/iserver/secdef/strikes?conid={search_conid}"
                              f"&sectype=OPT&month={month}&exchange={exchange}")
            call_strikes = strikes_data.get("call") or strikes_data.get("put") or []
            if not call_strikes:
                return jsonify({"expirations": []})
            sample_strike = call_strikes[len(call_strikes) // 2]  # pick middle strike
            chain = cp(f"/iserver/secdef/info?conid={search_conid}&sectype=OPT"
                       f"&month={month}&exchange={exchange}&strike={sample_strike}")
        else:
            chain = cp(f"/iserver/secdef/info?conid={search_conid}&sectype={sectype}"
                       f"&month={month}&exchange={exchange}")
        dates = sorted(set(c["maturityDate"] for c in chain if c.get("maturityDate")))
        return jsonify({"expirations": dates})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ── API: Spread analysis ──────────────────────────────────────────────────────

@app.route("/api/spreads")
def spreads():
    symbol       = request.args.get("symbol",     "MCL").upper()
    month        = request.args.get("month",       "")
    exp_date     = request.args.get("exp_date",    "")
    search_conid = int(request.args.get("conid",   "500567051"))
    sectype      = request.args.get("sectype",     "FOP")
    exchange     = request.args.get("exchange",    "NYMEX")
    is_future    = request.args.get("is_future",   "true").lower() == "true"
    otm_only     = request.args.get("otm_only",    "true").lower() == "true"
    strategy     = request.args.get("strategy",    "bull_call")  # bull_call | bear_put
    min_ret      = float(request.args.get("min_return",  6))
    max_ret      = float(request.args.get("max_return",  12))
    min_debit    = float(request.args.get("min_debit",   0.05))
    max_debit    = float(request.args.get("max_debit",   5.0))
    buy_price_m  = request.args.get("buy_price",  "ask")
    sell_price_m = request.args.get("sell_price", "bid")

    right = "C" if strategy == "bull_call" else "P"

    try:
        if is_future:
            front     = _front_future(symbol)
            und_price = _und_price(front["conid"])
        else:
            und_price = _und_price(search_conid)

        options = _fetch_options(search_conid, sectype, exchange, month,
                                 exp_date or None, und_price,
                                 right=right, otm_only=otm_only)

        if not options:
            label = "calls" if right == "C" else "puts"
            return jsonify({"error": f"No OTM {label} found", "und_price": und_price}), 404

        results = []
        pairs = itertools.combinations(options, 2)
        for a, b in pairs:
            # Bull call: buy lower strike, sell higher strike
            # Bear put:  buy higher strike, sell lower strike
            if strategy == "bull_call":
                buy, sell = (a, b) if a["strike"] < b["strike"] else (b, a)
            else:
                buy, sell = (a, b) if a["strike"] > b["strike"] else (b, a)

            bp = _best_price(buy,  buy_price_m)
            sp = _best_price(sell, sell_price_m)
            if bp is None or sp is None:
                continue
            net_debit = round(bp - sp, 3)
            if net_debit <= 0:
                continue
            width      = abs(buy["strike"] - sell["strike"])
            max_profit = round(width - net_debit, 3)
            if max_profit <= 0:
                continue
            ret = round(max_profit / net_debit, 2)
            if not (min_ret <= ret <= max_ret):
                continue
            if not (min_debit <= net_debit <= max_debit):
                continue

            if strategy == "bull_call":
                breakeven = round(buy["strike"] + net_debit, 3)
            else:
                breakeven = round(buy["strike"] - net_debit, 3)

            results.append({
                "buy_strike":  buy["strike"],
                "sell_strike": sell["strike"],
                "width":       width,
                "net_debit":   net_debit,
                "max_profit":  max_profit,
                "breakeven":   breakeven,
                "return_x":    ret,
                "buy_price":   bp,
                "sell_price":  sp,
                "buy_bid":     buy["bid"],
                "buy_ask":     buy["ask"],
                "sell_bid":    sell["bid"],
                "sell_ask":    sell["ask"],
                "buy_iv":      round(buy["iv"] * 100, 1) if buy.get("iv") else None,
                "buy_delta":   buy.get("delta"),
                "buy_volume":  buy.get("volume"),
            })

        results.sort(key=lambda r: r["return_x"], reverse=True)
        return jsonify({
            "symbol":    symbol,
            "strategy":  strategy,
            "exp_date":  exp_date,
            "und_price": und_price,
            "count":     len(results),
            "spreads":   results,
        })

    except requests.exceptions.ConnectionError:
        return jsonify({"error": "CP Gateway offline"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"⚡ Alpha Finder API → http://localhost:{port}")
    app.run(debug=False, port=port, threaded=True)
