/**
 * A clock that ticks. Relative wording ("Due in 3h") goes stale the moment it is rendered, so anything
 * that shows an SLA chip reads `now` from here once and passes it down: one interval per page, not one
 * per chip, and it is cleared on unmount. The first value is the mount instant.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
