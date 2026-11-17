import { useEffect, useState } from 'react';
import { api, remoteRunAvailability } from '../services/api.js';
import { DEFAULT_CONTENT, mergeContent } from '../content/siteContent.js';

// Module-level cache so Home / About / Contact / footer all share one fetch.
let cached = null;
let inflight = null;

function load() {
  if (cached) return Promise.resolve(cached);
  // A `file://` desktop renderer with no configured API server has nothing to
  // ask: skip the doomed request and use the built-in copy instead of letting
  // the browser log a failed navigation (`/api/site/content` resolving against
  // the filesystem).
  if (!remoteRunAvailability().ok) {
    cached = structuredClone(DEFAULT_CONTENT);
    return Promise.resolve(cached);
  }
  if (!inflight) {
    inflight = api
      .siteContent()
      .then((data) => {
        cached = mergeContent(DEFAULT_CONTENT, data);
        return cached;
      })
      .catch(() => {
        cached = structuredClone(DEFAULT_CONTENT);
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Admin-editable public-page copy, merged over built-in defaults. */
export function useSiteContent() {
  const [content, setContent] = useState(cached || DEFAULT_CONTENT);
  useEffect(() => {
    let alive = true;
    load().then((c) => {
      if (alive) setContent(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return content;
}

/** Drop the shared cache so the next mount re-fetches (used after admin saves). */
export function invalidateSiteContent() {
  cached = null;
  inflight = null;
}

export default useSiteContent;
