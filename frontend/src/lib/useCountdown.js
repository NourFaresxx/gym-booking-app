import { useEffect, useState } from 'react';

/** mm:ss countdown to `deadline` (a ms timestamp), ticking every second; null once it passes or if deadline is null. */
export function useCountdown(deadline) {
  const [remainingMs, setRemainingMs] = useState(() => (deadline ? deadline - Date.now() : null));

  useEffect(() => {
    if (!deadline) return;
    const interval = setInterval(() => setRemainingMs(deadline - Date.now()), 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (remainingMs === null || remainingMs <= 0) return null;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
