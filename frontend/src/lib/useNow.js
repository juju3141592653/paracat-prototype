import {useEffect, useState} from 'react';

/** Wall-clock milliseconds, refreshed every `interval` ms. */
export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

/** Chain time (seconds) extrapolated from the last block we read. */
export function chainNow(data, now) {
  if (!data?.chainTime) return Math.floor(now / 1000);
  return data.chainTime + Math.max(0, (now - data.fetchedAt) / 1000);
}
