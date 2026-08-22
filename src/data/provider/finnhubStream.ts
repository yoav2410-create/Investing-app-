/**
 * Live marks over Finnhub's WebSocket.
 *
 * The owner asked for prices refreshing every minute or faster during the
 * session. Polling cannot honestly deliver that — fourteen holdings at even
 * one-minute intervals eats a quarter of the free REST allowance — but the
 * free tier also includes a trade stream: subscribe once per symbol, and
 * every real trade arrives the moment it prints. That is not "refresh every
 * half second"; it is better — nothing at all when nothing trades, and
 * sub-second when something does.
 *
 * Ticks are buffered and flushed once a second. A liquid open prints many
 * trades per second per name, and writing each one into the store would spend
 * the main thread re-rendering a number faster than an eye can read it.
 *
 * The stream is a layer on top of the feed, never a replacement: it needs a
 * device key, it only runs while the app is open in a US session, and the
 * moment it drops the fifteen-minute machinery is still underneath.
 */

export interface StreamHandle {
  close: () => void;
  /** Swap the subscription list, e.g. after a screenshot import. */
  setSymbols: (symbols: string[]) => void;
}

interface TradeMessage {
  type: string;
  data?: { s: string; p: number; t: number }[];
}

/** Rough US cash session including pre/after hours, weekdays. UTC. */
export function inUsSession(now = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 13:00–21:00 UTC covers the cash session across daylight-saving shifts.
  return minutes >= 13 * 60 && minutes <= 21 * 60;
}

export function openStream(
  token: string,
  symbols: string[],
  onPrices: (prices: Record<string, number>) => void,
  onStatus?: (s: 'open' | 'closed' | 'error') => void,
): StreamHandle {
  let ws: WebSocket | null = null;
  let current = [...new Set(symbols)];
  let closed = false;
  let retryMs = 2_000;
  const buffer: Record<string, number> = {};
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  const flush = () => {
    const keys = Object.keys(buffer);
    if (!keys.length) return;
    const batch = { ...buffer };
    for (const k of keys) delete buffer[k];
    onPrices(batch);
  };

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(token)}`);
    } catch {
      onStatus?.('error');
      return;
    }
    ws.onopen = () => {
      retryMs = 2_000;
      onStatus?.('open');
      for (const s of current) ws?.send(JSON.stringify({ type: 'subscribe', symbol: s }));
    };
    ws.onmessage = (ev) => {
      let msg: TradeMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type !== 'trade' || !msg.data) return;
      for (const t of msg.data) {
        if (typeof t.p === 'number' && t.p > 0) buffer[t.s] = t.p;
      }
    };
    ws.onclose = () => {
      onStatus?.('closed');
      if (closed) return;
      // Backed-off reconnect: a dropped socket at the open should come back in
      // seconds, but a dead network should not spin.
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 60_000);
    };
    ws.onerror = () => {
      onStatus?.('error');
      try {
        ws?.close();
      } catch {
        /* the close handler owns the retry */
      }
    };
  };

  connect();
  flushTimer = setInterval(flush, 1_000);

  return {
    close: () => {
      closed = true;
      if (flushTimer) clearInterval(flushTimer);
      flush();
      try {
        ws?.close();
      } catch {
        /* already gone */
      }
    },
    setSymbols: (next) => {
      const wanted = [...new Set(next)];
      if (ws && ws.readyState === WebSocket.OPEN) {
        for (const s of current.filter((x) => !wanted.includes(x))) {
          ws.send(JSON.stringify({ type: 'unsubscribe', symbol: s }));
        }
        for (const s of wanted.filter((x) => !current.includes(x))) {
          ws.send(JSON.stringify({ type: 'subscribe', symbol: s }));
        }
      }
      current = wanted;
    },
  };
}
