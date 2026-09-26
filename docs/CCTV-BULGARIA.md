# Bulgaria — SBA road cameras

The existing CCTV catalog includes **15 Bulgarian still-image cameras** from
[SBA / Съюз на българските автомобилисти](https://www.sba.bg/cctv).
No API key or new dependency is needed. Set `CCTV_BULGARIA_ENABLED=0` to disable
the pack. The standard `CCTV_PREFER_AUSTIN` / custom file-or-env catalog gate
and catalog-wide fair cap apply just as they do to other packs.

## Discovery and coordinate provenance

Verified against the public page on **2026-09-26**. No separate JSON/API feed
was found in the page's camera references. Its map embeds JavaScript statements
of the form `cctv<ID> = new google.maps.LatLng(lat, lon)` followed by
`add_cctv_marker(cctv<ID>, name, "", ID)`. Each camera's modal control supplies
the same `cctv_id` plus its `cctv_name` image folder, and its thumbnail supplies
the complete JPEG URL. The page's modal builds that same URL.

The static registry `config/cctv_sources.bulgaria.json` preserves those exact
names, coordinates and URLs. Runtime does not scrape or execute SBA JavaScript.
This follows the existing Tallinn/Warendorf static-pack pattern and avoids
making every catalog refresh depend on SBA's HTML layout. To update it, compare
the official marker ID with the matching modal camera ID and image reference;
omit entries lacking either a verified coordinate or a published image path.
Do not derive IDs from the sequence of camera cards or guess missing folders.

Each URL has this exact form, where the folder below replaces `<folder>`:
`https://cdn.uab.org/images/cctv/images/cctv/<folder>/cctv.jpg`.
Application IDs are `bulgaria-sba-` plus the folder's numeric suffix.

| SBA marker ID | Image folder | Official name                   | Latitude   | Longitude  | Check on 2026-09-26                   |
| ------------- | ------------ | ------------------------------- | ---------- | ---------- | ------------------------------------- |
| 1             | cctv_01      | ГКПП Кулата - посока Гърция     | 41.3829516 | 23.3624983 | JPEG; old Last-Modified (2025-03-17)  |
| 2             | cctv_02      | ГКПП Кулата - посока София      | 41.3829516 | 23.3624983 | Recent JPEG                           |
| 3             | cctv_103     | ОМВ Окръжна болница, гр. София  | 42.6616918 | 23.3773061 | JPEG; old Last-Modified (2026-09-21)  |
| 5             | cctv_104     | ОМВ - Околовръстен път Бояна    | 42.65153   | 23.28747   | Recent JPEG                           |
| 8             | cctv_105     | ОМВ Слънчев Бряг                | 42.6931743 | 27.7003937 | JPEG; old Last-Modified (2026-01-25)  |
| 11            | cctv_106     | ОМВ Петолъчка                   | 42.6463887 | 26.6688425 | JPEG; old Last-Modified (2026-05-29)  |
| 14            | cctv_107     | ОМВ Момково                     | 41.8126723 | 26.1614012 | Recent JPEG                           |
| 17            | cctv_108     | ОМВ Изгрев, гр. Бургас          | 42.5282174 | 27.4522148 | Recent JPEG                           |
| 20            | cctv_109     | ОМВ Оризово                     | 42.1921184 | 25.191368  | Recent JPEG                           |
| 23            | cctv_110     | ОМВ Пловдив, Мария Луиза        | 42.149601  | 24.77775   | HTTP 404; normal unavailable fallback |
| 26            | cctv_111     | ОМВ Бяла                        | 43.46971   | 25.71497   | Recent JPEG                           |
| 32            | cctv_113     | ОМВ - Варна бул. В. Варненчик   | 43.2158857 | 27.8965658 | Recent JPEG                           |
| 35            | cctv_114     | ОМВ - магистрала Струма 166 км. | 41.3968512 | 23.3558197 | Recent JPEG                           |
| 39            | cctv_102     | ОМВ - Осиковица                 | 42.9546901 | 24.0212764 | Recent JPEG                           |
| 40            | cctv_115     | Петрохан                        | 43.121385  | 23.124707  | JPEG; old Last-Modified (2026-08-02)  |

All 15 locations are integrated; none are omitted. Both Kulata cameras use
the same coordinate because that is what SBA publishes. The verification
retrieved **14 JPEGs: 9 recent and 5 stale**, plus one 404. These are point-in-time
observations, not availability guarantees. No camera images were saved.

## Existing architecture and security

- `server/providers/cctv/sources.js` loads and validates the registry;
  `catalog.js` merges the enabled pack with other regions, deduplicates IDs,
  shares the cap fairly and caches metadata for 15 minutes.
- Sources use the existing `city: Bulgaria`, `cityId: bulgaria`, `provider`,
  `credit`, `license`, `sourceKind: bulgaria-sba` and `feedType: image` fields.
  The current camera selector lists city/region and name; it has no separate
  country/provider filter. No new filter or Bulgaria-only UI is introduced.
- `/api/cctv/sources` exposes metadata and existing same-origin frame/media
  paths. Camera selection, Cesium markers, proximity controls, visibility
  filtering and refresh behavior are unchanged.
- `/api/cctv/frame/:id` resolves only server-registered URLs. The SBA loader
  pins the exact HTTPS host and JPEG path for each ID, rejecting other ports,
  userinfo, query strings, paths and look-alike hosts. No arbitrary URL endpoint
  is introduced. SBA `/api/cctv/media/:id` redirects locally to that same frame
  route, so it cannot bypass the frame checks.
- `media.js` reuses the existing timeout (8 seconds), streaming byte cap and
  same-origin-only redirect handling. SBA additionally requires a JPEG content
  type and signature. Failures use the normal Street View / synthetic fallback
  and per-camera health records; they do not remove other cameras.
- The active still refresh remains 10 seconds, with the existing visibility
  and idle policies; no full-pack image polling is added. Client frame URLs
  are cache-busted and proxy frames use `Cache-Control: no-store`. SBA's CDN
  also returned no-cache/no-store headers during verification.
- Valid JPEGs whose upstream `Last-Modified` is over 10 minutes old are shown
  as **STALE / DEGRADED** in the existing health panel, with the timestamp.
  Missing, invalid or implausibly future timestamps report unknown freshness
  and degraded health. HTTP success alone does not establish a live feed.
  Last-Modified is a provider hint, not proof of the image's capture time.
- SBA does not publish surveyed camera orientations or heights on this page.
  Existing estimated pose defaults are marked low confidence; coordinates
  remain the official markers. Projection alignment is not surveyed.

## Attribution and rights

Source: Съюз на българските автомобилисти / SBA, https://www.sba.bg/cctv.
Publicly accessible traffic-camera imagery is accessed only at runtime. The
original provider retains all rights; no open-data license is claimed. Users
and deployers should comply with provider terms. The selected-camera metadata
and shared data-credit registry identify SBA. See also `DATA_SOURCES.md`.

## Manual verification

1. Start the application with `npm run dev`, or reload the running dev server.
2. Enable the existing **Cameras / CCTV** layer and navigate to Bulgaria.
3. Select a `Bulgaria` entry, such as `ГКПП Кулата - посока София` or
   `ОМВ - Околовръстен път Бояна`. Check the marker, Bulgarian name and SBA credit.
4. In browser Network tools, confirm images load from
   `/api/cctv/frame/bulgaria-sba-02` or `bulgaria-sba-104`, not a direct CDN URL.
   Leave the selected camera visible for two refresh intervals; timestamps in
   request URLs should change and responses should have `Cache-Control: no-store`.
5. Select Petrohan (`bulgaria-sba-115`) or Sofia hospital (`bulgaria-sba-103`).
   If SBA still serves the old images above, wait for the health refresh and
   confirm the stale status and last-modified message.
6. Select Plovdiv (`bulgaria-sba-110`); while its upstream is unavailable,
   confirm the normal fallback and degraded status, then select Kulata to
   confirm other cameras still load. For a controlled outage, temporarily
   block `cdn.uab.org` for the **server** (browser blocking will not affect a
   server-side fetch), repeat the check, and restore access. Unit tests mock
   this failure without relying on the public service.
7. Check an existing non-Bulgarian camera and the nearest/cycle controls.
8. Optional: set `CCTV_BULGARIA_ENABLED=0`, restart, and verify Bulgaria is
   absent while other packs remain; remove the override afterward.

Automated coverage: `node --test src/data/cctvBulgaria.test.mjs`, plus the
existing CCTV proxy, catalog, source, rendering and UI suites. All automated
upstream responses are mocked.

## Changed files and validation

- `config/cctv_sources.bulgaria.json`: the 15 verified metadata records.
- `server/providers/cctv/{constants,sources,catalog}.js`: source loading,
  validation and catalog registration.
- `server/providers/cctv/media.js` and `server/providers/cctv.js`: shared frame
  fetching, JPEG validation, freshness reporting and local media redirection.
- `src/data/dataCredits.js`, `DATA_SOURCES.md`, `.env.example` and this document:
  attribution, provenance, licensing and the optional disable switch.
- `src/data/cctvBulgaria.test.mjs`: 13 mocked catalog, security, health and
  timeout tests.
- `build/vite.js` and `src/tooling/viteBuild.test.mjs`: exclude runtime caches
  and logs from dev watching. A Windows EBUSY error while watching the downloaded
  source page had stopped localhost; source files remain watched normally.

Validation on 2026-09-26: relevant CCTV/data-credit/Vite tests passed (298
passing, 4 existing skips; the Vite tests were rerun as the file owner because
the sandbox cannot read the protected `.env`). Import/package boundary checks,
format checks for changed code, and production build passed. The build emitted
its large-chunk warning. This repository defines no separate lint or typecheck
script.

A hidden-browser smoke check confirmed the application initializes, the API
serves all 15 records with correct Bulgarian text, Kulata and Petrohan JPEGs
decode through the frame proxy, Petrohan is marked stale, and the unavailable
Plovdiv feed falls back cleanly. The dev server also continued returning HTTP
200 while a cache file was held under an exclusive Windows file lock.
