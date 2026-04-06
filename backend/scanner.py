#!/usr/bin/env python3
"""
Alpha Finder — Phase 1: The Scanner
Identifies Nasdaq stocks showing mathematically anomalous strength vs. SPY.

Filter pipeline (all from price data, no API calls until fundamentals):
  1. Penny stock / volume guard   — price ≥ $5, avg vol ≥ 100k
  2. Beta sanity check            — Beta > 0 (exclude inverse ETFs / neg-beta)
  3. Beta divergence              — Ticker Return > (Beta × SPY Return)
  4. RS line slope                — 30-day Ticker/SPY ratio has positive linear slope
  5. Market cap                   — ≥ $500M (fetched only for survivors)
"""

import sys
import json
import logging
import argparse
import requests
import io
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── Config ───────────────────────────────────────────────────────────────────

LOOKBACK_DAYS     = 30       # RS / divergence window
BETA_DAYS         = 252      # ~12 months of trading days for beta
MIN_RS_MARGIN     = 5.0      # simple RS fallback floor (%)
MIN_BETA          = 0.0      # strictly positive beta required (> 0)
MIN_PRICE         = 5.0      # penny stock threshold ($)
MIN_MARKET_CAP    = 500e6    # $500M market cap minimum
MIN_AVG_VOLUME    = 100_000  # 20-day avg daily volume
BATCH_SIZE        = 300      # tickers per yf.download() call
OUTPUT_JSON       = "scan_results.json"
OUTPUT_CSV        = "scan_results.csv"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


# ─── Step 1: Nasdaq Ticker List ───────────────────────────────────────────────

def fetch_nasdaq_tickers() -> list[str]:
    url = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"
    try:
        log.info("Fetching Nasdaq ticker list from NASDAQ Trader…")
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text), sep="|")
        df = df[df["Test Issue"] == "N"]
        df = df[~df["Symbol"].str.contains(r"[\^$\.]", na=False)]
        tickers = df["Symbol"].dropna().str.strip().tolist()
        log.info(f"  → {len(tickers):,} active Nasdaq tickers found.")
        return tickers
    except Exception as exc:
        log.warning(f"Could not fetch Nasdaq list ({exc}). Using fallback sample.")
        return ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "COST", "NFLX"]


# ─── Step 2: Bulk price download (12-month window) ───────────────────────────

def bulk_fetch_prices(
    tickers:    list[str],
    beta_days:  int = BETA_DAYS,
    batch_size: int = BATCH_SIZE,
) -> tuple[dict, dict]:
    """
    Download 12+ months of Close + Volume for all tickers in batches.
    The extra history beyond 30 days is used for beta calculation.
    Returns (closes, volumes) — both {ticker: pd.Series}.
    """
    end   = datetime.today()
    # BETA_DAYS trading days ≈ 365 calendar days; add buffer
    start = end - timedelta(days=int(beta_days * 1.45) + 10)

    closes  = {}
    volumes = {}
    total_batches = (len(tickers) + batch_size - 1) // batch_size

    for i in range(0, len(tickers), batch_size):
        batch     = tickers[i : i + batch_size]
        batch_num = i // batch_size + 1
        log.info(f"  Batch {batch_num}/{total_batches}: downloading {len(batch)} tickers…")

        try:
            raw = yf.download(
                batch,
                start=start,
                end=end,
                progress=False,
                auto_adjust=True,
                threads=True,
            )
            if raw.empty:
                continue

            def _strip_tz(s: pd.Series) -> pd.Series:
                """Ensure index is always tz-naive for consistent comparisons."""
                if s.index.tz is not None:
                    s = s.copy()
                    s.index = s.index.tz_localize(None)
                return s

            if len(batch) == 1:
                ticker = batch[0]
                c = _strip_tz(raw["Close"].squeeze())
                v = _strip_tz(raw["Volume"].squeeze())
                if isinstance(c, pd.Series) and len(c) >= 20:
                    closes[ticker]  = c.dropna()
                    volumes[ticker] = v.dropna()
            else:
                close_df  = raw["Close"]
                volume_df = raw["Volume"]
                for ticker in batch:
                    try:
                        c = _strip_tz(close_df[ticker].dropna())
                        v = _strip_tz(volume_df[ticker].dropna())
                        if len(c) >= 20:
                            closes[ticker]  = c
                            volumes[ticker] = v
                    except KeyError:
                        pass

        except Exception as exc:
            log.warning(f"  Batch {batch_num} failed: {exc}")

    log.info(f"Price data retrieved for {len(closes):,} tickers.")
    return closes, volumes


# ─── Step 3: Beta + divergence calculations ──────────────────────────────────

def calculate_beta(ticker_close: pd.Series, spy_close: pd.Series, beta_days: int = BETA_DAYS) -> float | None:
    """
    OLS beta using up to `beta_days` most recent trading days.
    Beta = Cov(ticker, SPY) / Var(SPY)
    Returns None if insufficient data.
    """
    # Align on common dates, take last beta_days rows
    combined = pd.concat([ticker_close, spy_close], axis=1, join="inner").dropna()
    combined.columns = ["ticker", "spy"]
    combined = combined.tail(beta_days)

    if len(combined) < 60:   # need at least 3 months
        return None

    t_ret = combined["ticker"].pct_change().dropna()
    s_ret = combined["spy"].pct_change().dropna()

    aligned = pd.concat([t_ret, s_ret], axis=1, join="inner").dropna()
    if len(aligned) < 60:
        return None

    cov = aligned.cov().iloc[0, 1]
    var = aligned.iloc[:, 1].var()
    if var == 0:
        return None

    return round(float(cov / var), 3)


def calculate_rs_slope(ticker_close: pd.Series, spy_close: pd.Series, lookback: int = LOOKBACK_DAYS) -> float | None:
    """
    Computes the linear regression slope of the (Ticker / SPY) ratio
    over the last `lookback` trading days.
    Positive slope = strengthening relative performance.
    """
    combined = pd.concat([ticker_close, spy_close], axis=1, join="inner").dropna()
    combined.columns = ["ticker", "spy"]
    cutoff = pd.Timestamp.today().normalize() - pd.Timedelta(days=lookback)
    combined = combined[combined.index >= cutoff]
    if len(combined) < 5:
        combined = combined.tail(21)

    if len(combined) < 10:
        return None

    ratio = combined["ticker"] / combined["spy"]
    x     = np.arange(len(ratio))
    slope = float(np.polyfit(x, ratio.values, 1)[0])
    return round(slope, 6)


# ─── Step 4: Full price filter with beta logic ───────────────────────────────

def price_filter(
    closes:    dict,
    volumes:   dict,
    min_price: float = MIN_PRICE,
    min_vol:   float = MIN_AVG_VOLUME,
    min_beta:  float = MIN_BETA,
    lookback:  int   = LOOKBACK_DAYS,
    beta_days: int   = BETA_DAYS,
) -> tuple[list[dict], float]:
    """
    Applies the full 4-condition filter using only price data.
    Returns (candidates, spy_30d_return).

    Conditions:
      1. price ≥ MIN_PRICE  and  avg_volume ≥ MIN_AVG_VOLUME
      2. Beta > MIN_BETA  (strictly positive — exclude inverse ETFs)
      3. ticker_return_30d > (beta × spy_return_30d)   [beta-adjusted divergence]
      4. RS line slope > 0   [ratio Ticker/SPY trending upward over 30 days]
    """
    if "SPY" not in closes:
        raise RuntimeError("SPY data missing.")

    spy_full = closes["SPY"]

    # SPY 30-calendar-day return (index is always tz-naive after bulk_fetch_prices)
    cutoff    = pd.Timestamp.today().normalize() - pd.Timedelta(days=lookback)
    spy_30d   = spy_full[spy_full.index >= cutoff]
    if len(spy_30d) < 5:
        spy_30d = spy_full.tail(21)   # fallback: ~1 month of trading days
    spy_return = float((spy_30d.iloc[-1] - spy_30d.iloc[0]) / spy_30d.iloc[0] * 100)
    log.info(f"SPY 30-day return: {spy_return:+.2f}%")

    candidates = []
    rejected   = {"penny": 0, "volume": 0, "beta_invalid": 0,
                  "beta_divergence": 0, "rs_slope": 0}

    for ticker, close in closes.items():
        if ticker == "SPY":
            continue
        try:
            current_price = float(close.iloc[-1])

            # ── 1. Penny / volume guard
            if current_price < min_price:
                rejected["penny"] += 1
                continue

            vol_series = volumes.get(ticker, pd.Series(dtype=float))
            avg_vol    = float(vol_series.tail(20).mean()) if len(vol_series) >= 5 else 0
            if avg_vol < min_vol:
                rejected["volume"] += 1
                continue

            # ── 2. Beta calculation & sanity check
            beta = calculate_beta(close, spy_full, beta_days)
            if beta is None or beta <= min_beta:
                rejected["beta_invalid"] += 1
                continue

            # ── 3. Beta-adjusted divergence
            #    ticker_return > (beta × spy_return)
            #    e.g. SPY=-10%, beta=1.5 → expected=-15%; if ticker=+2% → divergence=+17%
            close_30d     = close[close.index >= cutoff]
            if len(close_30d) < 5:
                close_30d = close.tail(21)
            ticker_return   = float((close_30d.iloc[-1] - close_30d.iloc[0]) / close_30d.iloc[0] * 100)
            expected_return = beta * spy_return
            alpha_divergence = round(ticker_return - expected_return, 2)

            if ticker_return <= expected_return:
                rejected["beta_divergence"] += 1
                continue

            # ── 4. RS line slope must be positive
            rs_slope = calculate_rs_slope(close, spy_full, lookback)
            if rs_slope is None or rs_slope <= 0:
                rejected["rs_slope"] += 1
                continue

            # ── Tier label (kept for compatibility with output/Phase 2)
            simple_rs = round(ticker_return - spy_return, 2)
            if ticker_return >= 0 and simple_rs >= MIN_RS_MARGIN:
                tier = "STRONG"
            elif ticker_return >= 0:
                tier = "OUTPERFORMER"
            else:
                tier = "RELATIVE_ONLY"

            candidates.append({
                "ticker":            ticker,
                "pct_change_30d":    round(ticker_return, 2),
                "current_price":     round(current_price, 2),
                "spy_return_30d":    round(spy_return, 2),
                "relative_strength": simple_rs,
                "beta":              beta,
                "expected_return":   round(expected_return, 2),
                "alpha_divergence":  alpha_divergence,
                "rs_slope":          rs_slope,
                "rs_tier":           tier,
                "avg_volume":        round(avg_vol),
                "price_history":     close_30d.round(2).tolist(),
                "price_dates":       [d.strftime("%Y-%m-%d") for d in close_30d.index],
            })

        except Exception:
            continue

    log.info(
        f"Filter breakdown — "
        f"penny: {rejected['penny']}, volume: {rejected['volume']}, "
        f"beta_invalid: {rejected['beta_invalid']}, "
        f"beta_divergence: {rejected['beta_divergence']}, "
        f"rs_slope: {rejected['rs_slope']}"
    )

    # Store SPY 30d history for frontend ratio charts
    spy_history = {
        "dates":  [d.strftime("%Y-%m-%d") for d in spy_30d.index],
        "prices": spy_30d.round(2).tolist(),
    }

    # Sort by alpha_divergence descending (strongest anomaly first)
    candidates.sort(key=lambda r: -r["alpha_divergence"])
    log.info(f"Candidates after price filter: {len(candidates)}")
    return candidates, spy_return, spy_history


# ─── Step 5: Enrich winners with fundamentals ────────────────────────────────

def fetch_fundamentals(ticker: str) -> dict:
    try:
        info = yf.Ticker(ticker).info
        return {
            "name":           info.get("longName") or info.get("shortName", ticker),
            "sector":         info.get("sector", "N/A"),
            "industry":       info.get("industry", "N/A"),
            "market_cap":     info.get("marketCap") or 0,
            "pe_ratio":       info.get("trailingPE"),
            "forward_pe":     info.get("forwardPE"),
            "eps_ttm":        info.get("trailingEps"),
            "revenue_growth": info.get("revenueGrowth"),
            "week_52_high":   info.get("fiftyTwoWeekHigh"),
            "week_52_low":    info.get("fiftyTwoWeekLow"),
        }
    except Exception:
        return {}


def enrich_with_fundamentals(candidates: list[dict], workers: int = 10) -> list[dict]:
    log.info(f"Fetching fundamentals for {len(candidates)} candidates ({workers} workers)…")
    enriched = []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_fundamentals, c["ticker"]): c for c in candidates}
        for future in as_completed(futures):
            base = futures[future]
            info = future.result()
            if info.get("market_cap", 0) < MIN_MARKET_CAP:
                continue
            enriched.append({**base, **info})

    enriched.sort(key=lambda r: -r["alpha_divergence"])
    log.info(f"Winners after market-cap filter: {len(enriched)}")
    return enriched


# ─── Step 6: Save outputs ─────────────────────────────────────────────────────

def save_results(winners: list[dict], spy_return: float, spy_history: dict | None = None) -> None:
    summary = {
        "generated_at":  datetime.now(tz=timezone.utc).isoformat(),
        "lookback_days": LOOKBACK_DAYS,
        "spy_return":    round(spy_return, 2),
        "total_winners": len(winners),
        "spy_history":   spy_history or {},   # {dates: [...], prices: [...]}
        "tickers":       winners,
    }
    with open(OUTPUT_JSON, "w") as f:
        json.dump(summary, f, indent=2)
    log.info(f"JSON saved → {OUTPUT_JSON}")

    csv_rows = [{k: v for k, v in row.items() if k not in ("price_history", "price_dates")}
                for row in winners]
    pd.DataFrame(csv_rows).to_csv(OUTPUT_CSV, index=False)
    log.info(f"CSV  saved → {OUTPUT_CSV}")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Alpha Finder — Phase 1 Scanner")
    p.add_argument("--lookback",   type=int,   default=LOOKBACK_DAYS,  help="RS window in trading days (default 30)")
    p.add_argument("--beta-days",  type=int,   default=BETA_DAYS,      help="Trading days for beta calculation (default 252)")
    p.add_argument("--min-price",  type=float, default=MIN_PRICE,      help="Min price, penny stock filter (default $5)")
    p.add_argument("--min-beta",   type=float, default=MIN_BETA,       help="Min beta threshold (default 0, i.e. strictly positive)")
    p.add_argument("--workers",    type=int,   default=10,             help="Workers for fundamentals fetch (default 10)")
    p.add_argument("--batch",      type=int,   default=BATCH_SIZE,     help="Tickers per download batch (default 300)")
    p.add_argument("--sample",     type=int,   default=0,              help="Limit to first N tickers (0 = all)")
    p.add_argument("--tickers",    type=str,   default=None,           help="Comma-separated ticker override list")
    p.add_argument("--price-only", action="store_true",                help="Stop after price filter, skip fundamentals")
    return p.parse_args()


def main():
    args = parse_args()

    # ── Ticker list
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",")]
        log.info(f"Using {len(tickers)} tickers from --tickers flag.")
    else:
        tickers = fetch_nasdaq_tickers()

    if args.sample:
        tickers = tickers[: args.sample]
        log.info(f"Sample mode: first {len(tickers)} tickers.")

    if "SPY" not in tickers:
        tickers = ["SPY"] + tickers

    # ── Bulk price download (12 months for beta + 30 days for RS)
    log.info(f"Starting bulk price download for {len(tickers):,} tickers (12-month window)…")
    closes, volumes = bulk_fetch_prices(tickers, beta_days=args.beta_days, batch_size=args.batch)

    # ── Full price filter (beta divergence + RS slope)
    candidates, spy_return, spy_history = price_filter(
        closes, volumes,
        min_price=args.min_price,
        min_beta=args.min_beta,
        lookback=args.lookback,
        beta_days=args.beta_days,
    )

    if not candidates:
        log.info("No candidates passed the filter.")
        save_results([], spy_return, spy_history)
        return

    if args.price_only:
        log.info(f"\n{'='*70}")
        log.info(f"PRICE-ONLY RESULTS — {len(candidates)} candidates  (SPY {spy_return:+.2f}%)")
        log.info(f"  STRONG       : {sum(1 for c in candidates if c['rs_tier']=='STRONG')}")
        log.info(f"  OUTPERFORMER : {sum(1 for c in candidates if c['rs_tier']=='OUTPERFORMER')}")
        log.info(f"  RELATIVE_ONLY: {sum(1 for c in candidates if c['rs_tier']=='RELATIVE_ONLY')}")
        log.info(f"{'='*70}")
        log.info(f"{'#':<4} {'Ticker':<8} {'Alpha Div':>10} {'Ticker Ret':>11} {'Expected':>10} {'Beta':>6} {'RS Slope':>10} {'Price':>8}")
        log.info(f"{'─'*70}")
        for i, c in enumerate(candidates[:25], 1):
            log.info(
                f"{i:<4} {c['ticker']:<8} {c['alpha_divergence']:>+9.1f}%  "
                f"{c['pct_change_30d']:>+9.1f}%  {c['expected_return']:>+9.1f}%  "
                f"{c['beta']:>6.2f}  {c['rs_slope']:>+10.6f}  ${c['current_price']:>7.2f}"
            )
        return

    # ── Enrich with fundamentals (survivors only)
    winners = enrich_with_fundamentals(candidates, workers=args.workers)

    log.info(f"\n{'='*70}")
    log.info(f"SCAN COMPLETE — {len(winners)} winners  (SPY {spy_return:+.2f}%)")
    log.info(f"  STRONG       : {sum(1 for w in winners if w['rs_tier']=='STRONG')}")
    log.info(f"  OUTPERFORMER : {sum(1 for w in winners if w['rs_tier']=='OUTPERFORMER')}")
    log.info(f"{'='*70}\n")
    log.info(f"{'#':<4} {'Ticker':<8} {'Alpha Div':>10} {'Beta':>6} {'RS Slope':>10}  {'Name'}")
    log.info(f"{'─'*70}")
    for i, w in enumerate(winners[:20], 1):
        log.info(
            f"{i:<4} {w['ticker']:<8} {w['alpha_divergence']:>+9.1f}%  "
            f"{w['beta']:>6.2f}  {w['rs_slope']:>+10.6f}  {w.get('name','')[:35]}"
        )

    save_results(winners, spy_return, spy_history)


if __name__ == "__main__":
    main()
