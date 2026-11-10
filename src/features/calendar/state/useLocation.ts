'use client';

import { useCallback, useEffect, useState } from 'react';
import { type CalendarLocation, parseLocation, sameLocation, toSearch } from './url';

/**
 * The calendar location (view, date, rooms) lives in the URL. Changing it pushes a history entry, so the
 * browser's Back and Forward buttons walk through what you looked at; those fire `popstate`, which we
 * read back. The server page is not re-run for these changes (the data comes from the client cache).
 */
export function useLocation(initial: CalendarLocation, tz: string) {
  const [location, setLocation] = useState(initial);

  useEffect(() => {
    const onPop = () =>
      setLocation(parseLocation(new URLSearchParams(window.location.search), Date.now(), tz));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [tz]);

  const navigate = useCallback(
    (next: CalendarLocation) => {
      if (sameLocation(next, location)) return;
      window.history.pushState(null, '', `${window.location.pathname}?${toSearch(next)}`);
      setLocation(next);
    },
    [location],
  );

  return [location, navigate] as const;
}
