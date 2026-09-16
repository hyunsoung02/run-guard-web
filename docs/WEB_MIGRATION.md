# RUN Guard Android → Web migration audit

Source of truth: the Android implementation and Git history already present in this copied workspace at `android-stable-before-web-20260914` (`c7a17ff`). The browser implementation lives in `app/`, `components/`, `lib/`, `types/`, and `public/`.

Status terms: **IMPLEMENTED** is a direct Web capability, **ADAPTED** preserves the product intent with browser APIs, and **INTENTIONALLY EXCLUDED** records an honest platform/scope limitation.

| Android feature | Source file(s) | Existing behavior | Web equivalent | Strategy | Final status |
|---|---|---|---|---|---|
| Splash / initial state | `src/screens/SplashScreen.tsx`, `src/screens/LoadingScreen.tsx` | Branded transition and course-loading presets | Immediate branded shell with scoped location/route loading states | Adapt | **ADAPTED** — no artificial launch delay |
| Home | `src/screens/MainScreen.tsx`, `src/features/home/components/HomeCanvas.tsx` | Mascot hero, goal progress, RUN-centered bottom navigation | Mobile mascot home; desktop keeps the same state in a map-first panel | Reimplement UI, reuse assets | **IMPLEMENTED** |
| Bottom navigation | `src/features/home/components/BottomNavigation.tsx` | AI coach / raised RUN / menu | Fixed safe-area-aware mobile navigation | Reimplement | **IMPLEMENTED** |
| Distance selection | `LocationDistanceScreen.tsx`, `targetDistanceOptions.ts` | 5 / 7 / 10 km | Same three targets in route setup | Reuse product rule | **IMPLEMENTED** |
| Place search | `LocationSearchScreen.tsx`, `kakaoPlaceService.ts` | Kakao keyword search near a coordinate | `/api/search` server proxy, searchable result list | Reimplement transport | **IMPLEMENTED** when `KAKAO_REST_API_KEY` is configured |
| Route recommendation | `routeRecommendationService.ts`, `openRouteService.ts` | Three bearings, ORS walking round trips, retries and distance correction | `/api/routes` proxies ORS; client preserves candidate scoring and selection metadata | Adapt domain logic | **IMPLEMENTED** when `ORS_API_KEY` is configured |
| Route candidates | `routeRecommendationService.ts` | Candidates at 0°/120°/240° | Three candidates returned and selectable | Reuse | **IMPLEMENTED** |
| Distance correction | `routeRecommendationService.ts` | 3 attempts, 200 m or 3% tolerance, 0.75 initial radius scale | Same thresholds on server | Reuse | **IMPLEMENTED** |
| Map | `LiveRunningMap.tsx`, map layers | MapLibre, route, start, hazards, live position | MapLibre GL JS map with OSM-derived tiles, route/caution/live sources and fit bounds | Reimplement | **IMPLEMENTED** |
| Safety score | `routeSafetyService.ts` | Rule-based 200 m proximity, weighted deductions, grades | Same Haversine/segment distance and deductions on server | Reuse | **IMPLEMENTED**; explicitly not AI |
| Public safety data | `safetyDataService.ts`, `oldmanAccidentService.ts`, `kakaoRegionService.ts` | Kakao legal-region lookup then 2024 KoROAD elderly-pedestrian accident zones | `/api/safety` server proxy with timeout, XML/JSON parsing and unavailable states | Adapt | **IMPLEMENTED** when Kakao/Public Data keys are configured |
| Caution points | `routeSafetyService.ts`, `AccidentZoneLayer.tsx` | Hazard points within 200 m of route | Map markers and safety detail list | Reuse + reimplement UI | **IMPLEMENTED** |
| GPS initial location | `useLocationStore.ts`, `locationValidity.ts` | High accuracy; 50 m max; 60 s freshness | `getCurrentPosition`, high accuracy, 15 s timeout, 0 maximumAge; explicit denied/unavailable/poor-accuracy states | Adapt | **IMPLEMENTED** |
| Running Active | `RunningActiveScreen.tsx` | Map, guidance, metrics, pause/resume/finish | Shared running state with responsive running panel and map | Reimplement | **IMPLEMENTED** |
| GPS filtering | `useRunningSession.ts` | ≤50 m accuracy, ≤15 m/s, ≤10 s gap, ≥2 m movement, 15 s stale warning | Same thresholds around `watchPosition` | Reuse thresholds | **IMPLEMENTED** |
| Distance | `runningSessionCalculations.ts` | Haversine accumulated accepted segments | Same calculation | Reuse | **IMPLEMENTED** |
| Pace / elapsed / remaining | calculations + store | Active-time clock and pace after minimum valid distance | Same foreground timing and derived values | Reuse | **IMPLEMENTED** |
| Route progress | `useNavigationProgress.ts` | Nearest-route progress; 60 m off-route | Progress from accepted points; 60 m off-route status | Adapt | **IMPLEMENTED** |
| Navigation guidance | `runningGuidance.ts`, `useNavigationProgress.ts` | ORS step instructions and maneuver state | Current instruction plus distance-to-next-step | Adapt | **IMPLEMENTED** |
| Pause / resume / finish | `useRunningStore.ts` | Guarded state transitions and paused-duration exclusion | Explicit `idle → route-setup → route-ready → running ↔ paused → finished` reducer | Reimplement | **IMPLEMENTED** |
| Speech guidance | `runningVoiceGuide.ts`, `useRunningVoiceGuide.ts` | Turn/remaining/pace announcements | Feature-detected Web Speech synthesis; failure is non-blocking | Adapt | **ADAPTED** |
| Record saving | `useRunningStore.ts` | Persist completed record | `localStorage`; planned and actual routes retained | Adapt storage | **IMPLEMENTED** |
| Records list/detail | `HomeRecordsSheet.tsx`, record components | Summary, detail metrics, route and analysis | Records panel/list and detail view | Reimplement | **IMPLEMENTED** |
| Splits | `createRunningSplits.ts` | Per-km interpolation from timed route points | Same split interpolation | Reuse | **IMPLEMENTED** |
| Heart rate / cadence / elevation / calories | record types | Nullable; native runtime does not provide dependable values | Omitted or shown as unavailable | Honest platform handling | **INTENTIONALLY EXCLUDED** — browser geolocation has no valid source for these sensor metrics |
| Coach | `CoachScreen.tsx`, coach plan/badge components | Manual beginner/intermediate/advanced selection and rule plan | Conversational Gemini coach with quick prompts and structured weekly plan | Replace per competition brief | **ADAPTED** |
| Coach context / multi-turn | running store + coach store | Separate rule-plan state | Recent records, current plan and bounded conversation sent to server | New Web capability | **IMPLEMENTED** when `GEMINI_API_KEY` is configured |
| Settings / menu | `MenuScreen.tsx`, settings feature | Profile, goals and voice preferences | Compact settings panel with voice toggle and persistent preference | Adapt | **ADAPTED** |
| Assets / visual identity | `src/assets/images/**`, `src/assets/icons/**` | Lime `#B2F300`, deep green, mascot, raised RUN affordance, rounded cards | Project-owned assets copied into `public/run-guard/` and matching tokens | Reuse | **IMPLEMENTED** |
| Authentication/cloud sync/background GPS | none / native platform | Not essential to guest competition flow | No login; local-only persistence; foreground tracking notice | Exclude by brief | **INTENTIONALLY EXCLUDED** — competition scope and browser background limits |

## Architectural truth

- Route distance, route ranking and safety are explainable **rule-based calculations**.
- Gemini is used only for conversational interpretation of goals, schedules, record context, and weekly-plan revision.
- Public-data or routing failure never becomes fabricated success. Each capability exposes an unavailable/configuration/error state.
