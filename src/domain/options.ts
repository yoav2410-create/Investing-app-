import type { OptionsPositioning, OptionsRead } from './types';

/**
 * Alpha Vantage's own convention, kept deliberately: <= 0.70 reads bullish,
 * >= 1.00 reads bearish, anything between is neutral. Changing the thresholds
 * would silently disagree with the source the numbers came from.
 */
export const BULLISH_AT = 0.7;
export const BEARISH_AT = 1.0;

export function optionsRead(ratio: number | null): OptionsRead | null {
  if (ratio == null) return null;
  if (ratio <= BULLISH_AT) return 'bullish';
  if (ratio >= BEARISH_AT) return 'bearish';
  return 'neutral';
}

export function optionsSentence(o: OptionsPositioning | null): string {
  if (!o || o.putCallVolume == null) {
    return 'No options chain data on the last refresh.';
  }
  const read = optionsRead(o.putCallVolume)!;
  const oiRead = optionsRead(o.putCallOpenInterest);
  const parts = [
    `Put/call volume ${o.putCallVolume.toFixed(2)} reads ${read}`,
  ];
  if (o.putCallOpenInterest != null && oiRead) {
    parts.push(
      `open interest ${o.putCallOpenInterest.toFixed(2)} reads ${oiRead}`,
    );
  }
  const agree = oiRead == null || oiRead === read;
  return (
    parts.join('; ') +
    (agree
      ? '.'
      : ' — flow and existing positioning disagree, so treat the signal as weak.')
  );
}

export function readTone(read: OptionsRead | null): 'up' | 'down' | 'flat' {
  if (read === 'bullish') return 'up';
  if (read === 'bearish') return 'down';
  return 'flat';
}
