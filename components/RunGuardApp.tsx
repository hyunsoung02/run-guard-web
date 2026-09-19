'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowLeft, ChevronRight, CircleAlert, Crosshair, ExternalLink, Github, LocateFixed, MapPin, Menu, MessageSquare, Mic, MicOff, Pause, Play, RotateCcw, Search, Send, ShieldCheck, Square, Timer, Trash2 } from 'lucide-react';
import { acceptRunningPoint, calculateEstimatedRunMinutes, createSplits, DEFAULT_TARGET_DISTANCE_KM, distanceM, formatClock, formatPace, isLocationUsable, MAX_TARGET_DISTANCE_KM, MIN_TARGET_DISTANCE_KM, normalizeTargetDistanceKm, OFF_ROUTE_DISTANCE_M } from '@/lib/domain';
import { PROJECT_GITHUB_URL, removeAllRunGuardData, removeCoachConversation, removeRunningRecords, RUN_GUARD_STORAGE_KEYS } from '@/lib/runGuardStorage';
import { useMobileViewport } from '@/hooks/useMobileViewport';
import type { AppView, ChatMessage, CoachPlan, LngLat, LocationPoint, RouteCandidate, RunningRecord, SessionStatus } from '@/types/run-guard';

const RunGuardMap = dynamic(() => import('./RunGuardMap'), { ssr: false, loading: () => <div className="map-loading"><Image src="/run-guard/character/loading_character.png" alt="" width={120} height={120} loading="eager" sizes="120px"/><span>지도를 준비하고 있어요</span></div> });
const LOCATION_DISMISSED_KEY = 'run-guard-location-dismissed';
const LOCATION_GRANTED_HINT_KEY = 'run-guard-location-granted-v1';

type LocationState = 'unknown' | 'promptable' | 'checking' | 'granted' | 'denied' | 'unavailable' | 'low-accuracy';
type LocationPromptReason = 'entry' | 'gate';
type DeleteAction = 'records' | 'coach' | 'all';
type Place = { id: string; name: string; address: string; category: string; longitude: number; latitude: number; distanceM: number };

const toPoint = (position: GeolocationPosition): LocationPoint => ({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy, altitudeM: position.coords.altitude, speedMps: position.coords.speed, headingDegrees: position.coords.heading, timestampMs: position.timestamp || Date.now() });
const storageRead = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const storageWrite = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode can reject persistence */ } };

export default function RunGuardApp() {
  useMobileViewport();
  const [view, setView] = useState<AppView>('home');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [locationState, setLocationState] = useState<LocationState>('unknown');
  const [location, setLocation] = useState<LocationPoint | null>(null);
  const [locationPromptReason, setLocationPromptReason] = useState<LocationPromptReason | null>(null);
  const [distanceKm, setDistanceKm] = useState(DEFAULT_TARGET_DISTANCE_KM);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [routeError, setRouteError] = useState('');
  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [routeReason, setRouteReason] = useState('');
  const [safetyNotice, setSafetyNotice] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [searchError, setSearchError] = useState('');
  const [records, setRecords] = useState<RunningRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<RunningRecord | null>(null);
  const [actualRoute, setActualRoute] = useState<LocationPoint[]>([]);
  const [runDistanceM, setRunDistanceM] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const [pausedDurationMs, setPausedDurationMs] = useState(0);
  const [gpsNotice, setGpsNotice] = useState('');
  const [followUser, setFollowUser] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<CoachPlan | null>(null);
  const [message, setMessage] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [deleteAction, setDeleteAction] = useState<DeleteAction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const watchId = useRef<number | null>(null);
  const sessionStatusRef = useRef<SessionStatus>('idle');
  const lastPointRef = useRef<LocationPoint | undefined>(undefined);
  const runDistanceRef = useRef(0);
  const elapsedRef = useRef(0);
  const gpsLocationRef = useRef<LocationPoint | null>(null);
  const qaScenarioRef = useRef<string | null>(null);
  const previousViewRef = useRef<AppView | null>(null);
  const coachScrollRef = useRef<HTMLDivElement | null>(null);
  const coachRequestRef = useRef<AbortController | null>(null);
  const deletingRef = useRef(false);

  const selectedCandidate = useMemo(() => candidates.find((candidate) => candidate.id === selectedId) ?? null, [candidates, selectedId]);
  const estimatedRunMinutes = useMemo(() => selectedCandidate ? calculateEstimatedRunMinutes(selectedCandidate.distanceM, records) : 0, [records, selectedCandidate]);
  const mapCandidate = selectedRecord ? { id: selectedRecord.id, coordinates: selectedRecord.plannedRoute, distanceM: selectedRecord.distanceM, durationSeconds: selectedRecord.durationSeconds, distanceAccuracyScore: 100, safetyScore: null, recommendationScore: null, warningPoints: [], navigationSteps: [] } : selectedCandidate;
  const latestWeeklyKm = useMemo(() => records.filter((record) => record.startedAtMs > Date.now() - 7 * 86400000).reduce((sum, record) => sum + record.distanceM / 1000, 0), [records]);
  const progress = selectedCandidate ? Math.min(1, runDistanceM / Math.max(1, selectedCandidate.distanceM)) : 0;
  const remainingM = Math.max(0, distanceKm * 1000 - runDistanceM);
  const offRoute = useMemo(() => {
    const point = actualRoute.at(-1); if (!point || !selectedCandidate) return false;
    let nearest = Infinity; for (let i = 0; i < selectedCandidate.coordinates.length; i += Math.max(1, Math.floor(selectedCandidate.coordinates.length / 80))) nearest = Math.min(nearest, distanceM([point.longitude, point.latitude], selectedCandidate.coordinates[i]));
    return nearest > OFF_ROUTE_DISTANCE_M;
  }, [actualRoute, selectedCandidate]);

  useEffect(() => {
    setRecords(storageRead(RUN_GUARD_STORAGE_KEYS.records, []));
    const coach = storageRead<{ chat: ChatMessage[]; plan: CoachPlan | null }>(RUN_GUARD_STORAGE_KEYS.coach, { chat: [], plan: null }); setChat(coach.chat); setPlan(coach.plan);
    setVoiceEnabled(storageRead(RUN_GUARD_STORAGE_KEYS.settings, { voiceEnabled: true }).voiceEnabled);
    setStorageHydrated(true);
  }, []);
  useEffect(() => {
    // Local development browser QA only. Production must never substitute GPS or routing data.
    if (process.env.NODE_ENV === 'production' || window.location.hostname !== 'localhost') return;
    const scenario = new URLSearchParams(window.location.search).get('qa');
    qaScenarioRef.current = scenario;
    const qaLocation: LocationPoint = { latitude: 37.5665, longitude: 126.978, accuracyM: scenario === 'poor-location' ? 120 : 8, altitudeM: null, speedMps: null, headingDegrees: null, timestampMs: Date.now() };
    if (scenario === 'location-prompt') { setLocationState('promptable'); setLocationPromptReason('entry'); }
    if (scenario === 'location-denied') { setLocationState('denied'); setLocationPromptReason('entry'); }
    if (scenario === 'location-unavailable') { setLocationState('unavailable'); setLocationPromptReason('gate'); }
    if (scenario === 'poor-location') { setView('route'); setSessionStatus('route-setup'); setLocation(qaLocation); setLocationState('low-accuracy'); setLocationPromptReason('gate'); }
    if (scenario === 'location-ready') { gpsLocationRef.current = qaLocation; setView('route'); setSessionStatus('route-setup'); setLocation(qaLocation); setLocationState('granted'); }
    if (scenario === 'home') setView('home');
    if (scenario === 'records') setView('records');
    if (scenario === 'menu') setView('menu');
    if (scenario === 'coach') {
      const qaPlan: CoachPlan = { runnerLevel: '초급', goal: '5km 완주 시간 단축', weeklySummary: '무리하지 않고 주 3회 리듬을 만드는 플랜이에요.', sessions: [{ day: '화요일', type: '인터벌 러닝', distanceKm: 4, intensity: '보통', description: '빠른 달리기와 회복 달리기를 번갈아 진행해요.' }, { day: '목요일', type: '이지 러닝', distanceKm: 3, intensity: '가볍게', description: '대화할 수 있는 속도로 편안하게 달려요.' }, { day: '토요일', type: '롱 러닝', distanceKm: 5, intensity: '천천히', description: '완주 감각을 익히며 일정한 호흡을 유지해요.' }], coachComment: '좋아요. 지금은 속도보다 일정한 리듬을 만드는 데 집중해볼게요.', safetyNote: '통증이 느껴지면 즉시 멈추고 충분히 회복하세요.' };
      setView('coach'); setChat([{ id: 'qa-user', role: 'user', text: '체력부터 천천히' }, { id: 'qa-assistant', role: 'assistant', text: qaPlan.coachComment, plan: qaPlan }]); setPlan(qaPlan);
    }
    if (scenario === 'route-ready' || scenario === 'gps-follow') {
      const route: RouteCandidate = { id: 'qa-route', coordinates: [[126.978,37.5665],[126.983,37.569],[126.987,37.565],[126.982,37.561],[126.978,37.5665]], turnaroundCoordinate: [126.987,37.565], distanceM: 5000, durationSeconds: 2100, distanceAccuracyScore: 100, safetyScore: 88, recommendationScore: 91.6, warningPoints: [{ id: 'qa-warning', coordinate: [126.984,37.566], name: 'QA 주의 지점', distanceFromRouteM: 76, accidentCount: 2, severity: 'medium' }], navigationSteps: [{ instruction: '200m 앞에서 오른쪽으로 이동하세요.', distanceM: 200, coordinateIndex: 1, maneuver: 'right' }] };
      gpsLocationRef.current = qaLocation; setLocation(qaLocation); setLocationState('granted'); setCandidates([route]); setSelectedId(route.id); setRouteReason('로컬 브라우저 QA 전용 코스입니다.'); setSafetyNotice('로컬 브라우저 QA 전용 안전 상태입니다.'); setRouteStatus('ready'); setSessionStatus('route-ready'); setView('route');
      if (scenario === 'gps-follow') { setView('running'); setSessionStatus('running'); setStartedAtMs(Date.now()); }
    }
  }, []);
  useEffect(() => { if (storageHydrated) storageWrite(RUN_GUARD_STORAGE_KEYS.records, records); }, [records, storageHydrated]);
  useEffect(() => { if (storageHydrated) storageWrite(RUN_GUARD_STORAGE_KEYS.coach, { chat, plan }); }, [chat, plan, storageHydrated]);
  useEffect(() => { if (storageHydrated) storageWrite(RUN_GUARD_STORAGE_KEYS.settings, { voiceEnabled }); }, [voiceEnabled, storageHydrated]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(''), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  useEffect(() => { runDistanceRef.current = runDistanceM; elapsedRef.current = elapsedSeconds; }, [runDistanceM, elapsedSeconds]);
  useEffect(() => { sessionStatusRef.current = sessionStatus; }, [sessionStatus]);
  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); }, []);
  useEffect(() => {
    if (view !== 'coach') return;
    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = coachScrollRef.current;
      if (scrollContainer) scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, chat, aiLoading, aiError]);

  useEffect(() => {
    if (sessionStatus !== 'running' || startedAtMs === null) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtMs - pausedDurationMs) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [sessionStatus, startedAtMs, pausedDurationMs]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || qaScenarioRef.current !== 'gps-follow' || sessionStatus !== 'running') return;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      const point: LocationPoint = { latitude: 37.5665, longitude: 126.978 + step * 0.000035, accuracyM: 8, altitudeM: null, speedMps: null, headingDegrees: 90, timestampMs: Date.now(), sessionElapsedSeconds: elapsedRef.current };
      const result = acceptRunningPoint(lastPointRef.current, point);
      if (!result.accepted) return;
      lastPointRef.current = point; setLocation(point); setActualRoute((current) => [...current, point]); setRunDistanceM((current) => current + result.segmentDistanceM);
      if (step === 3) setFollowUser(false);
    }, 900);
    return () => window.clearInterval(timer);
  }, [sessionStatus]);

  const requestLocation = useCallback((after?: (point: LocationPoint) => void) => {
    if (!navigator.geolocation) { setLocationState('unavailable'); setLocationPromptReason('gate'); return; }
    setLocationState('checking');
    navigator.geolocation.getCurrentPosition((position) => {
      const point = toPoint(position); setLocation(point); setSelectedPlace(null);
      if (!isLocationUsable(point)) { setLocationState('low-accuracy'); setLocationPromptReason('gate'); return; }
      gpsLocationRef.current = point; setLocationState('granted'); setLocationPromptReason(null);
      try { localStorage.setItem(LOCATION_GRANTED_HINT_KEY, '1'); } catch { /* storage can be unavailable */ }
      after?.(point);
    }, (error) => {
      const denied = error.code === error.PERMISSION_DENIED;
      setLocationState(denied ? 'denied' : 'unavailable');
      setLocationPromptReason('gate');
      if (denied) { try { localStorage.removeItem(LOCATION_GRANTED_HINT_KEY); } catch { /* storage can be unavailable */ } }
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }, []);

  useEffect(() => {
    if (qaScenarioRef.current) return;
    let active = true;
    let permissionStatus: PermissionStatus | null = null;
    const showEntryPrompt = () => {
      if (!active) return;
      let dismissed = false;
      try { dismissed = sessionStorage.getItem(LOCATION_DISMISSED_KEY) === '1'; } catch { /* session storage can be unavailable */ }
      if (!dismissed) setLocationPromptReason('entry');
    };
    const refreshReadiness = async () => {
      if (!navigator.geolocation) { setLocationState('unavailable'); showEntryPrompt(); return; }
      try {
        if (navigator.permissions?.query) {
          permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
          if (!active) return;
          if (permissionStatus.state === 'granted') requestLocation();
          else if (permissionStatus.state === 'denied') { setLocationState('denied'); showEntryPrompt(); }
          else { setLocationState('promptable'); showEntryPrompt(); }
          permissionStatus.onchange = refreshReadiness;
          return;
        }
      } catch { /* iOS Safari and embedded browsers may not expose geolocation permissions */ }
      let grantedHint = false;
      try { grantedHint = localStorage.getItem(LOCATION_GRANTED_HINT_KEY) === '1'; } catch { /* storage can be unavailable */ }
      if (grantedHint) requestLocation();
      else { setLocationState('promptable'); showEntryPrompt(); }
    };
    void refreshReadiness();
    return () => { active = false; if (permissionStatus) permissionStatus.onchange = null; };
  }, [requestLocation]);

  function resetRouteResult() {
    setCandidates([]); setSelectedId(null); setRouteReason(''); setSafetyNotice(''); setRouteError(''); setRouteStatus('idle');
  }

  function updateTargetDistance(value: number) {
    const nextDistance = normalizeTargetDistanceKm(value);
    if (nextDistance === distanceKm) return;
    setDistanceKm(nextDistance);
    resetRouteResult();
  }

  function resetRouteDraft() {
    setSearchText(''); setPlaces([]); setSelectedPlace(null); setSearchError(''); setSearching(false);
    const gpsLocation = gpsLocationRef.current;
    setLocation(gpsLocation); setLocationState(gpsLocation && isLocationUsable(gpsLocation) ? 'granted' : 'unknown');
  }

  function resetRunningSession() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null; sessionStatusRef.current = 'idle'; lastPointRef.current = undefined; runDistanceRef.current = 0; elapsedRef.current = 0;
    setActualRoute([]); setRunDistanceM(0); setElapsedSeconds(0); setStartedAtMs(null); setPausedAtMs(null); setPausedDurationMs(0); setGpsNotice(''); setFollowUser(true);
  }

  const openRoute = () => {
    resetRunningSession(); resetRouteResult(); resetRouteDraft(); setSelectedRecord(null); setView('route'); setSessionStatus('route-setup');
    const gpsLocation = gpsLocationRef.current;
    if (!gpsLocation || !isLocationUsable(gpsLocation)) setLocationPromptReason('gate');
  };

  function handleBottomNavigation(next: AppView | 'home') {
    setSelectedRecord(null);
    if (next === 'home') {
      if (view === 'route' || view === 'running') return;
      openRoute();
      return;
    }
    if (next === 'coach') previousViewRef.current = view;
    setView(next);
  }

  function handleCoachBack() {
    const previousView = previousViewRef.current;
    previousViewRef.current = null;
    if (previousView && previousView !== 'coach') { setView(previousView); return; }
    openRoute();
  }

  function handleRouteBack() {
    const returnToSetup = routeStatus === 'ready' || routeStatus === 'error';
    resetRunningSession(); resetRouteResult(); resetRouteDraft();
    setSessionStatus(returnToSetup ? 'route-setup' : 'idle'); setView(returnToSetup ? 'route' : 'home');
  }

  async function generateRoute() {
    if (!location || !isLocationUsable(location)) { setLocationPromptReason('gate'); return; }
    setCandidates([]); setSelectedId(null); setRouteStatus('loading'); setRouteError(''); setSafetyNotice('안전 공공데이터를 확인하고 있어요.'); setPlaces([]);
    let safetyPoints: Array<{ id: string; coordinate: LngLat; name: string; accidentCount: number; deathCount?: number; seriousInjuryCount?: number }> = [];
    let safetyAvailable = false;
    try {
      const safetyResponse = await fetch('/api/safety', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ longitude: location.longitude, latitude: location.latitude }) });
      const safety = await safetyResponse.json(); safetyPoints = safety.points ?? []; safetyAvailable = safety.status === 'available'; setSafetyNotice(safetyAvailable ? `2024 공공데이터 ${safetyPoints.length}개 지점을 규칙으로 비교했습니다.` : safety.message || '안전 데이터를 사용할 수 없습니다.');
    } catch { setSafetyNotice('안전 데이터를 불러오지 못해 거리 정확도 기준으로 추천합니다.'); }
    try {
      const response = await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: [location.longitude, location.latitude], targetDistanceM: distanceKm * 1000, safetyPoints, safetyAvailable }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const validCandidates = Array.isArray(data.candidates) ? data.candidates.filter((candidate: RouteCandidate) => Array.isArray(candidate.coordinates) && candidate.coordinates.length >= 2) : [];
      const selectedRoute = validCandidates.find((candidate: RouteCandidate) => candidate.id === data.recommendedId);
      if (!selectedRoute) throw new Error('추천 경로 데이터를 확인하지 못했습니다. 다시 추천해 주세요.');
      setCandidates(validCandidates); setSelectedId(selectedRoute.id); setRouteReason(data.reason); setRouteStatus('ready'); setSessionStatus('route-ready');
    } catch (error) { setRouteStatus('error'); setRouteError(error instanceof Error ? error.message : '코스를 만들지 못했습니다.'); }
  }

  function selectPlace(place: Place, keepResults = false) {
    const point: LocationPoint = { latitude: place.latitude, longitude: place.longitude, accuracyM: 0, altitudeM: null, speedMps: null, headingDegrees: null, timestampMs: Date.now() };
    resetRouteResult(); setLocation(point); setSelectedPlace(place); setSearchText(place.name); setSearchError('');
    if (!keepResults) {
      setPlaces([]);
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    }
  }

  async function searchPlaces() {
    const query = searchText.trim();
    if (!query || searching) return;
    setSearching(true); setSearchError(''); setPlaces([]);
    if (process.env.NODE_ENV === 'development') console.info('[PLACE_SEARCH]', { query, stage: 'request-start' });
    try {
      const response = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, ...(location ? { longitude: location.longitude, latitude: location.latitude } : {}) }) });
      if (process.env.NODE_ENV === 'development') console.info('[PLACE_SEARCH]', { query, stage: 'response', status: response.status });
      const data = await response.json() as { places?: Place[]; error?: string };
      if (!response.ok) throw new Error(data.error || '장소 검색 중 오류가 발생했습니다.');
      const validPlaces = Array.isArray(data.places) ? data.places.filter((place) => Number.isFinite(place.longitude) && Number.isFinite(place.latitude)) : [];
      if (process.env.NODE_ENV === 'development') console.info('[PLACE_SEARCH]', { query, stage: 'parsed', resultCount: validPlaces.length });
      if (!validPlaces.length) { setSearchError('검색 결과를 찾을 수 없습니다.'); return; }
      setPlaces(validPlaces); selectPlace(validPlaces[0], true);
    }
    catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('[PLACE_SEARCH]', { query, stage: 'error', message: error instanceof Error ? error.message : 'Unknown error' });
      setSearchError('장소 검색 중 오류가 발생했습니다.');
    }
    finally { setSearching(false); }
  }

  function speak(text: string) { if (!voiceEnabled || !('speechSynthesis' in window)) return; try { speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'ko-KR'; speechSynthesis.speak(utterance); } catch { /* speech is optional */ } }

  function startRunning() {
    if (!selectedCandidate || !location || sessionStatus !== 'route-ready') return;
    const now = Date.now(); sessionStatusRef.current = 'running'; setFollowUser(true); setView('running'); setSessionStatus('running'); setStartedAtMs(now); setPausedAtMs(null); setPausedDurationMs(0); setElapsedSeconds(0); setRunDistanceM(0); setActualRoute([]); setGpsNotice(''); lastPointRef.current = undefined;
    speak('러닝을 시작합니다. 정확한 기록을 위해 RUN Guard 화면을 유지해 주세요.');
    watchId.current = navigator.geolocation.watchPosition((position) => {
      if (sessionStatusRef.current !== 'running') return;
      const point = { ...toPoint(position), sessionElapsedSeconds: elapsedRef.current };
      const result = acceptRunningPoint(lastPointRef.current, point);
      if (!result.accepted) { if (result.reason === 'weak-signal' || result.reason === 'stale') setGpsNotice('GPS 정확도를 확인하고 있어요.'); return; }
      setGpsNotice(''); lastPointRef.current = point; setLocation(point); setActualRoute((current) => [...current, point]); setRunDistanceM((current) => current + result.segmentDistanceM);
    }, (error) => setGpsNotice(error.code === error.PERMISSION_DENIED ? '위치 권한이 중단되었습니다.' : 'GPS 신호를 확인하고 있어요.'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  function pauseRun() { if (sessionStatus !== 'running') return; sessionStatusRef.current = 'paused'; setSessionStatus('paused'); setPausedAtMs(Date.now()); speak('러닝을 일시정지합니다.'); }
  function resumeRun() { if (sessionStatus !== 'paused' || pausedAtMs === null) return; sessionStatusRef.current = 'running'; lastPointRef.current = undefined; setPausedDurationMs((value) => value + Date.now() - pausedAtMs); setPausedAtMs(null); setSessionStatus('running'); speak('러닝을 다시 시작합니다.'); }
  function finishRun() {
    if (!['running', 'paused'].includes(sessionStatus) || startedAtMs === null || !selectedCandidate) return;
    sessionStatusRef.current = 'finished'; if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    const endedAtMs = Date.now(); const duration = elapsedRef.current; const measured = runDistanceRef.current;
    const record: RunningRecord = { id: `run-${endedAtMs}`, startedAtMs, endedAtMs, targetDistanceM: distanceKm * 1000, distanceM: measured, durationSeconds: duration, averagePaceSecondsPerKm: measured >= 20 ? duration / (measured / 1000) : null, plannedRoute: selectedCandidate.coordinates, actualRoute, splits: createSplits(actualRoute, measured, duration) };
    setRecords((current) => [record, ...current]); setSelectedRecord(record); setSessionStatus('finished'); setView('records'); speak('러닝을 마쳤습니다. 수고하셨어요.');
  }

  async function sendCoach(nextMessage = message) {
    const trimmed = nextMessage.trim(); if (!trimmed || aiLoading) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text: trimmed }; const nextChat = [...chat, userMessage]; setChat(nextChat); setMessage(''); setAiLoading(true); setAiError('');
    const controller = new AbortController(); coachRequestRef.current = controller;
    try {
      const recordContext = records.slice(0, 10).map((record) => ({ distanceKm: record.distanceM / 1000, durationSeconds: record.durationSeconds, averagePaceSecondsPerKm: record.averagePaceSecondsPerKm, date: new Date(record.startedAtMs).toISOString().slice(0, 10) }));
      const response = await fetch('/api/ai-coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: trimmed, history: nextChat.slice(-12), records: recordContext, currentPlan: plan, targetDistanceKm: distanceKm }), signal: controller.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (coachRequestRef.current !== controller) return;
      const assistant: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', text: data.plan.coachComment, plan: data.plan }; setPlan(data.plan); setChat((current) => [...current, assistant]);
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setAiError(error instanceof Error ? error.message : 'AI 코치를 불러오지 못했습니다.'); }
    finally { if (coachRequestRef.current === controller) { coachRequestRef.current = null; setAiLoading(false); } }
  }

  function clearCoachState() {
    coachRequestRef.current?.abort(); coachRequestRef.current = null;
    setChat([]); setPlan(null); setMessage(''); setAiError(''); setAiLoading(false);
  }

  function confirmDataDeletion() {
    if (!deleteAction || deletingRef.current) return;
    deletingRef.current = true; setDeleting(true);
    try {
      if (deleteAction === 'records') {
        removeRunningRecords(localStorage); setRecords([]); setSelectedRecord(null);
        setFeedback('러닝 기록을 삭제했어요.');
      } else if (deleteAction === 'coach') {
        removeCoachConversation(localStorage); clearCoachState();
        setFeedback('AI 코치 대화를 삭제했어요.');
      } else {
        removeAllRunGuardData(localStorage, sessionStorage);
        setRecords([]); setSelectedRecord(null); clearCoachState(); setVoiceEnabled(true);
        setDistanceKm(DEFAULT_TARGET_DISTANCE_KM); resetRunningSession(); resetRouteResult();
        setFeedback('모든 데이터를 삭제했어요.');
      }
      setDeleteAction(null);
    } finally {
      deletingRef.current = false; setDeleting(false);
    }
  }

  const locationError = selectedPlace ? null : locationState === 'denied' ? { title: '위치 권한이 꺼져 있습니다.', body: 'RUN Guard의 코스 추천을 사용하려면 브라우저 설정에서 위치 접근을 허용해주세요.' } : locationState === 'low-accuracy' ? { title: '현재 위치 정확도가 낮습니다.', body: '탁 트인 곳으로 이동하거나 GPS 수신이 원활한 장소에서 다시 확인해주세요.' } : locationState === 'unavailable' ? { title: '현재 위치를 확인하지 못했습니다.', body: '기기의 위치 서비스와 네트워크 상태를 확인한 뒤 다시 시도해주세요.' } : null;
  const locationStatusLabel = selectedPlace ? '출발지 선택됨' : locationState === 'granted' ? 'GPS 연결됨' : locationState === 'checking' ? '위치 확인 중' : locationState === 'low-accuracy' ? '정확도 낮음' : '위치 설정 필요';
  const instruction = offRoute ? '경로에서 벗어났습니다. 표시된 코스로 돌아와 주세요.' : selectedCandidate?.navigationSteps[0]?.instruction ?? '표시된 코스를 따라 달려주세요.';

  const header = (title: string, back?: () => void, backClassName = '') => <header className="panel-header">{back && <button className={`icon-button ${backClassName}`.trim()} onClick={back} aria-label="뒤로가기"><ArrowLeft /></button>}<div><span className="eyebrow">RUN Guard</span><h1>{title}</h1></div><span className={`location-status status-${selectedPlace ? 'granted' : locationState}`}><LocateFixed size={15} />{locationStatusLabel}</span></header>;

  const routePanel = <div className="panel-scroll">{header(routeStatus === 'ready' ? '추천 코스' : '코스 설정', handleRouteBack)}
    <section className="route-setup-card"><label>출발 위치</label><div className="location-row"><span className="pin-box"><MapPin size={20} /></span><div><strong>{selectedPlace?.name ?? (locationState === 'granted' ? '현재 위치' : locationStatusLabel)}</strong><small>{selectedPlace?.address || (location ? `정확도 약 ${Math.round(location.accuracyM ?? 0)}m` : 'GPS 위치를 사용합니다')}</small></div><button onClick={() => requestLocation()} disabled={locationState === 'checking'} aria-label="현재 위치 사용"><Crosshair size={18} />{locationState === 'checking' ? '확인 중' : '위치'}</button></div>
      {locationError && <div className="error-card"><CircleAlert /><div><strong>{locationError.title}</strong><p>{locationError.body}</p><button onClick={() => requestLocation()}>다시 확인</button></div></div>}
      <div className="distance-slider"><div className="distance-slider-heading"><label htmlFor="target-distance">목표 거리</label><output htmlFor="target-distance" aria-live="polite"><strong>{distanceKm}</strong><span>km</span></output></div><input id="target-distance" type="range" min={MIN_TARGET_DISTANCE_KM} max={MAX_TARGET_DISTANCE_KM} step={1} value={distanceKm} onChange={(event) => updateTargetDistance(Number(event.target.value))} aria-label="목표 거리" aria-valuetext={`${distanceKm}킬로미터`} style={{ '--distance-progress': `${((distanceKm - MIN_TARGET_DISTANCE_KM) / (MAX_TARGET_DISTANCE_KM - MIN_TARGET_DISTANCE_KM)) * 100}%` } as CSSProperties}/><div className="distance-slider-ticks" aria-hidden="true">{[1, 5, 10, 15, 20].map((value) => <span key={value}>{value}</span>)}</div></div>
      <div className="search-box"><Search size={18}/><input value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && searchPlaces()} placeholder="공원, 카페, 출발 장소 검색" aria-label="출발 장소 검색"/><button onClick={searchPlaces} disabled={searching || !searchText.trim()} aria-busy={searching}>{searching ? '검색 중' : '검색'}</button></div>{searchError && <p className="inline-error" role="status">{searchError}</p>}{places.length > 0 && <div className="place-results" aria-label="장소 검색 결과">{places.slice(0, 4).map((place) => <button key={place.id} onClick={() => selectPlace(place)}><MapPin size={16}/><span><strong>{place.name}</strong><small>{place.address}</small></span></button>)}</div>}
      <button className="primary-button" onClick={generateRoute} disabled={routeStatus === 'loading'}>{routeStatus === 'loading' ? <><span className="spinner"/>코스를 만들고 있어요</> : '추천 코스 만들기'}</button>
    </section>
    {routeStatus === 'error' && <div className="error-card"><CircleAlert/><div><strong>코스를 만들지 못했어요.</strong><p>{routeError}</p><button onClick={generateRoute}>다시 생성</button></div></div>}
    {routeStatus === 'ready' && selectedCandidate && <section className="result-card"><div className="result-title"><span className="recommend-badge">추천</span><h2>{(selectedCandidate.distanceM / 1000).toFixed(2)}km 코스</h2></div><p>{routeReason}</p><p className="estimated-time-note">예상 시간은 최근 러닝 기록의 평균 페이스를 기준으로 계산하며, 기록이 없으면 기본 페이스를 적용합니다.</p><div className="metric-row"><div><span>예상 시간</span><strong>{estimatedRunMinutes}분</strong></div><div><span>거리 정확도</span><strong>{Math.round(selectedCandidate.distanceAccuracyScore)}점</strong></div><div><span>상대 안전도</span><strong>{selectedCandidate.safetyScore === null ? '확인 불가' : `${Math.round(selectedCandidate.safetyScore)}점`}</strong></div></div><p className="safety-note"><ShieldCheck size={17}/>{safetyNotice}</p>{selectedCandidate.warningPoints.length > 0 && <div className="warning-list"><strong>주의 지점 {selectedCandidate.warningPoints.length}개</strong>{selectedCandidate.warningPoints.slice(0,3).map((point) => <span key={point.id}><CircleAlert size={14}/>{point.name} · 경로에서 {Math.round(point.distanceFromRouteM)}m</span>)}</div>}<div className="candidate-tabs" role="group" aria-label="추천 코스 선택">{candidates.map((candidate, index) => <button key={candidate.id} className={selectedId === candidate.id ? 'active' : ''} onClick={() => setSelectedId(candidate.id)} aria-pressed={selectedId === candidate.id}>코스 {index + 1}<small>{(candidate.distanceM / 1000).toFixed(1)}km</small></button>)}</div><button className="run-button" onClick={startRunning}><Play fill="currentColor"/>러닝 시작</button></section>}
  </div>;

  const runningPanel = <div className="panel-scroll running-panel">{header('러닝 중')}
    <section className="guidance-card"><div className="turn-icon"><ChevronRight size={38}/></div><div><span>{offRoute ? '경로 이탈' : '다음 안내'}</span><strong>{instruction}</strong></div></section>{gpsNotice && <p className="gps-notice"><CircleAlert size={16}/>{gpsNotice}</p>}
    <section className="running-stats"><div className="main-stat"><span>러닝 시간</span><strong>{formatClock(elapsedSeconds)}</strong></div><div className="stat-grid"><div><span>달린 거리</span><strong>{(runDistanceM/1000).toFixed(2)}<small> km</small></strong></div><div><span>평균 페이스</span><strong>{formatPace(runDistanceM, elapsedSeconds)}<small> /km</small></strong></div><div><span>남은 거리</span><strong>{(remainingM/1000).toFixed(2)}<small> km</small></strong></div><div><span>경로 진행률</span><strong>{Math.round(progress*100)}<small>%</small></strong></div></div><div className="progress-track"><span style={{ width: `${progress*100}%` }}/></div></section>
    <p className="foreground-note">정확한 러닝 기록을 위해 RUN Guard 화면을 유지해주세요.</p><div className="running-controls"><button className="finish-control" onClick={finishRun}><Square fill="currentColor"/>종료</button>{sessionStatus === 'paused' ? <button className="pause-control" onClick={resumeRun}><Play fill="currentColor"/>계속</button> : <button className="pause-control" onClick={pauseRun}><Pause fill="currentColor"/>일시정지</button>}<button className="voice-control" onClick={() => setVoiceEnabled((value) => !value)} aria-pressed={voiceEnabled}>{voiceEnabled ? <Mic/> : <MicOff/>}음성</button></div>
  </div>;

  const recordsPanel = <div className="panel-scroll">{header(selectedRecord ? '러닝 기록' : '이전 기록', selectedRecord ? () => setSelectedRecord(null) : undefined)}{selectedRecord ? <RecordDetail record={selectedRecord}/> : records.length ? <div className="record-list">{records.map((record) => <button key={record.id} onClick={() => setSelectedRecord(record)}><div className="record-date"><Image src="/run-guard/records/running-shoe.png" alt="" width={34} height={34}/><span><strong>{new Date(record.startedAtMs).toLocaleDateString('ko-KR')}</strong><small>현재 위치 주변 코스</small></span></div><strong>{(record.distanceM/1000).toFixed(2)} km</strong><span>{formatClock(record.durationSeconds)} · {formatPace(record.distanceM, record.durationSeconds)}</span><ChevronRight/></button>)}</div> : <div className="empty-state"><Image src="/run-guard/records/record-coach-character.png" alt="기록을 기다리는 RUN Guard 캐릭터" width={170} height={170} loading="eager" sizes="170px"/><h2>아직 러닝 기록이 없어요</h2><p>첫 코스를 달리면 여기에 기록이 쌓여요.</p><button className="primary-button" onClick={openRoute}>첫 러닝 시작</button></div>}</div>;

  const coachPanel = <div className="coach-screen"><div ref={coachScrollRef} className="panel-scroll coach-scroll">{header('AI 코치', handleCoachBack, 'coach-back-button')}<div className="coach-intro"><Image className="coach-mascot" src="/assets/coach-running-mascot.png" alt="달리는 RUN Guard AI 코치 캐릭터" width={1728} height={2304} loading="eager" sizes="110px"/><div><h2>이번 주,<br/>어떻게 달려볼까요?</h2><p>목표와 가능한 요일을 알려주시면<br/>나에게 맞는 러닝 플랜을 만들어드릴게요.</p></div></div><div className="quick-prompts">{[`${distanceKm}km 기록 단축`, '주 3회 꾸준히', '체력부터 천천히'].map((text) => <button key={text} onClick={() => sendCoach(text)} disabled={aiLoading}>{text}</button>)}</div>{records.length === 0 ? <p className="context-note first-run-note">첫 러닝 전에는 목표를 기준으로 계획을 만들고, 기록이 쌓이면 최근 러닝 기록과 이번 주 누적 거리를 반영해 다음 계획을 조정합니다.</p> : <p className="context-note">최근 {Math.min(records.length,10)}회 기록 · 이번 주 {latestWeeklyKm.toFixed(1)}km를 코칭에 반영해요.</p>}<div className="chat-history" aria-live="polite">{chat.map((item) => <div key={item.id} className={`chat-message ${item.role}`}><p>{item.text}</p>{item.plan && <PlanCard plan={item.plan}/>}</div>)}{aiLoading && <div className="chat-message assistant typing"><span/><span/><span/> 계획을 만들고 있어요</div>}{aiError && <div className="ai-error"><CircleAlert/><span>{aiError}</span><button onClick={() => sendCoach(chat.at(-1)?.role === 'user' ? chat.at(-1)!.text : message)}><RotateCcw size={14}/>다시 시도</button></div>}</div><p className="ai-disclaimer">AI 코치는 일반적인 러닝 계획을 돕습니다. 의료 진단은 제공하지 않습니다.</p></div><div className="chat-input"><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sendCoach()} maxLength={800} placeholder="목표와 가능한 요일을 알려주세요" aria-label="AI 코치에게 메시지 입력"/><button onClick={() => sendCoach()} disabled={!message.trim() || aiLoading} aria-label="메시지 보내기"><Send/></button></div></div>;

  const menuPanel = <div className="panel-scroll menu-panel">{header('메뉴')}<div className="menu-profile"><Image src="/assets/coach-running-mascot.png" alt="달리는 RUN Guard 캐릭터" width={1728} height={2304} loading="eager" sizes="88px"/><div><strong>RUN Guard 러너</strong><span>로그인 없이 기기에 안전하게 저장돼요</span></div></div><section className="menu-section"><h2>러닝 설정</h2><button onClick={() => setVoiceEnabled((value) => !value)} aria-pressed={voiceEnabled}><span><Mic/>음성 길안내</span><em className={voiceEnabled ? 'toggle on' : 'toggle'} aria-hidden="true"><i/></em></button><button onClick={() => setView('records')}><span><Timer/>이전 기록</span><ChevronRight/></button></section><section className="menu-section"><h2>프로젝트</h2><a className="menu-link" href={PROJECT_GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="RUN Guard GitHub 저장소 새 탭에서 열기"><span><Github/><span className="menu-row-copy"><strong>GitHub 저장소</strong><small>소스코드와 구현 구조 보기</small></span></span><ExternalLink aria-hidden="true"/></a></section><section className="menu-section data-section"><h2>데이터</h2><button className="data-action danger" onClick={() => setDeleteAction('records')} aria-label="러닝 기록 삭제"><span><Trash2/><span className="menu-row-copy"><strong>러닝 기록 삭제</strong><small>저장된 러닝 기록을 모두 삭제합니다.</small></span></span></button><button className="data-action danger" onClick={() => setDeleteAction('coach')} aria-label="AI 코치 대화 삭제"><span><MessageSquare/><span className="menu-row-copy"><strong>AI 코치 대화 삭제</strong><small>저장된 AI 코치 대화를 모두 삭제합니다.</small></span></span></button><button className="data-action danger danger-all" onClick={() => setDeleteAction('all')} aria-label="모든 RUN Guard 데이터 삭제"><span><Trash2/><span className="menu-row-copy"><strong>모든 데이터 삭제</strong><small>RUN Guard에 저장된 모든 데이터를 초기화합니다.</small></span></span></button></section><div className="truth-card"><ShieldCheck/><div><strong>설명 가능한 RUN Guard</strong><p>경로·거리·안전도는 규칙 기반으로 계산하고, Gemini는 대화형 맞춤 코칭에만 사용합니다.</p></div></div></div>;

  const homePanel = (
    <div className="home-panel">
      <header className="home-header">
        <div className="home-brand"><span className="brand-mark">RUN</span><span>Guard</span></div>
      </header>
      <section className="home-hero">
        <p className="speech-bubble">{records.length ? `이번 주 ${latestWeeklyKm.toFixed(1)}km 달렸어요` : '오늘도 안전한 코스로 달려볼까요?'}</p>
        <div className="home-art">
          <Image className="home-mobile-mascot" src="/run-guard/character/loading_character.png" alt="달리는 RUN Guard 전신 캐릭터" width={541} height={544} loading="eager" sizes="(max-width: 767px) 55vw, 1px"/>
          <Image className="home-desktop-art" src="/run-guard/home/main_hero_background.png" alt="" width={1125} height={2436} priority sizes="(min-width: 768px) 352px, 1px"/>
        </div>
        <div className="goal-progress"><span style={{ width: `${Math.min(100, latestWeeklyKm/15*100)}%`}}/><strong>{latestWeeklyKm.toFixed(2)} / 15.00 KM</strong></div>
        <p className="weekly-message"><strong>{Math.max(0,15-latestWeeklyKm).toFixed(2)}KM 남았어요!</strong><span>조금만 더 파이팅!!</span></p>
      </section>
    </div>
  );

  const dismissLocationPrompt = () => {
    try { sessionStorage.setItem(LOCATION_DISMISSED_KEY, '1'); } catch { /* session storage can be unavailable */ }
    setLocationPromptReason(null);
  };
  const activePanel = view === 'route' ? routePanel : view === 'running' ? runningPanel : view === 'records' ? recordsPanel : view === 'coach' ? coachPanel : view === 'menu' ? menuPanel : homePanel;
  return <main className={`app-shell view-${view}`}><aside className="function-panel">{activePanel}{view !== 'coach' && <BottomNav view={view} onChange={handleBottomNavigation}/>}</aside><section className="desktop-map"><div className="map-brand"><span className="brand-mark">RUN</span><strong>Guard</strong><small>{sessionStatus === 'running' ? '러닝 진행 중' : locationState === 'granted' ? '현재 위치 연결됨' : '나만의 러닝 코스'}</small></div><RunGuardMap location={location} candidate={mapCandidate} actualRoute={selectedRecord?.actualRoute ?? actualRoute} progressCoordinate={actualRoute.at(-1) ? [actualRoute.at(-1)!.longitude, actualRoute.at(-1)!.latitude] : null} followUser={view === 'running' && followUser} onFollowChange={setFollowUser}/>{view === 'running' && !followUser && location && <button className="recenter-button" onClick={() => setFollowUser(true)}><LocateFixed size={17}/>현재 위치로 돌아가기</button>}{view === 'home' && <div className="desktop-welcome"><span>RUN Guard</span><h2>내 위치에서 시작하는<br/>설명 가능한 러닝 코스</h2><p>목표 거리를 고르면 실제 보행 경로와 공공 안전 데이터를 규칙으로 비교합니다.</p><button className="primary-button" onClick={openRoute}><LocateFixed/>내 위치로 코스 찾기</button></div>}</section>{locationPromptReason && <LocationPrompt state={locationState} reason={locationPromptReason} onUseLocation={() => requestLocation()} onDismiss={dismissLocationPrompt}/>} {deleteAction && <DeleteConfirmation action={deleteAction} deleting={deleting} onCancel={() => setDeleteAction(null)} onConfirm={confirmDataDeletion}/>} {feedback && <div className="data-feedback" role="status" aria-live="polite">{feedback}</div>}</main>;
}

const DELETE_COPY: Record<DeleteAction, { title: string; body: string; confirm: string }> = {
  records: { title: '러닝 기록을 삭제할까요?', body: '저장된 모든 러닝 기록이 삭제됩니다. 삭제된 기록은 복구할 수 없습니다.', confirm: '삭제' },
  coach: { title: 'AI 코치 대화를 삭제할까요?', body: '저장된 AI 코치 대화 내용이 모두 삭제됩니다. 삭제된 대화는 복구할 수 없습니다.', confirm: '삭제' },
  all: { title: '모든 데이터를 삭제할까요?', body: '러닝 기록, AI 코치 대화, 설정 등 RUN Guard에 저장된 모든 로컬 데이터가 삭제됩니다. 삭제한 데이터는 복구할 수 없습니다.', confirm: '모두 삭제' },
};

function DeleteConfirmation({ action, deleting, onCancel, onConfirm }: { action: DeleteAction; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onCancel();
      if (event.key !== 'Tab') return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [deleting, onCancel]);
  const copy = DELETE_COPY[action];
  return <div className="delete-dialog-backdrop" role="presentation"><section ref={dialogRef} className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description"><span className="delete-dialog-icon"><Trash2 size={24}/></span><h2 id="delete-dialog-title">{copy.title}</h2><p id="delete-dialog-description">{copy.body}</p><div className="delete-dialog-actions"><button ref={cancelRef} onClick={onCancel} disabled={deleting}>취소</button><button className="confirm-delete" onClick={onConfirm} disabled={deleting}>{copy.confirm}</button></div></section></div>;
}

function BottomNav({ view, onChange }: { view: AppView; onChange: (view: AppView | 'home') => void }) {
  const menuActive = view === 'menu' || view === 'records';
  return <nav className="bottom-nav" aria-label="주요 메뉴"><button onClick={() => onChange('coach')}><Image src="/run-guard/home/coach_icon.png" alt="" width={32} height={32}/><span>AI 코치</span></button><button className="center-run" onClick={() => onChange('home')} aria-label="RUN 시작" aria-current={view === 'route' || view === 'running' ? 'page' : undefined}><span><Image src="/run-guard/home/play_button.png" alt="" width={82} height={82} priority/></span><em>RUN</em></button><button className={menuActive ? 'active' : ''} onClick={() => onChange('menu')} aria-current={menuActive ? 'page' : undefined}><Menu/><span>메뉴</span></button></nav>;
}

function LocationPrompt({ state, reason, onUseLocation, onDismiss }: { state: LocationState; reason: LocationPromptReason; onUseLocation: () => void; onDismiss: () => void }) {
  const denied = state === 'denied';
  const checking = state === 'checking';
  const lowAccuracy = state === 'low-accuracy';
  const unavailable = state === 'unavailable';
  const title = denied ? '위치 권한이 꺼져 있습니다' : lowAccuracy ? '위치를 더 정확히 확인할게요' : unavailable ? '현재 위치를 확인하지 못했어요' : reason === 'gate' ? '러닝 코스를 만들려면 위치가 필요해요' : '현재 위치에서 달려볼까요?';
  const body = denied ? 'RUN Guard의 코스 추천을 사용하려면 브라우저 설정에서 이 사이트의 위치 접근을 허용해주세요.' : lowAccuracy ? '탁 트인 곳으로 이동한 뒤 다시 확인하면 더 정확한 러닝 코스를 만들 수 있어요.' : unavailable ? '기기의 위치 서비스와 네트워크 상태를 확인한 뒤 다시 시도해주세요.' : 'RUN Guard는 현재 위치를 기준으로 1~20km 러닝 코스를 추천합니다.';
  return <div className="location-prompt-backdrop" role="presentation"><section className="location-prompt" role="dialog" aria-modal="true" aria-labelledby="location-prompt-title"><span className="location-prompt-icon"><LocateFixed size={26}/></span><div><span className="eyebrow">LOCATION</span><h2 id="location-prompt-title">{title}</h2><p>{body}</p>{denied && <small>Android Chrome: 주소창의 사이트 정보 → 권한 → 위치 → 허용으로 변경한 뒤 다시 확인해주세요. iPhone에서는 브라우저의 사이트 설정에서 위치를 허용할 수 있어요.</small>}</div><button className="primary-button" onClick={onUseLocation} disabled={checking}>{checking ? <><span className="spinner"/>위치 확인 중</> : denied || lowAccuracy || unavailable ? '다시 확인' : '현재 위치 사용'}</button><button className="location-later" onClick={onDismiss}>{reason === 'entry' ? '나중에' : '닫기'}</button></section></div>;
}

function RecordDetail({ record }: { record: RunningRecord }) {
  return <div className="record-detail"><div className="record-hero"><span>수고했어요!</span><strong>{(record.distanceM/1000).toFixed(2)} km</strong><small>{new Date(record.startedAtMs).toLocaleString('ko-KR')}</small></div><div className="metric-row"><div><span>시간</span><strong>{formatClock(record.durationSeconds)}</strong></div><div><span>평균 페이스</span><strong>{formatPace(record.distanceM, record.durationSeconds)}</strong></div><div><span>목표</span><strong>{(record.targetDistanceM/1000).toFixed(0)}km</strong></div></div><section><h2>1km 구간 기록</h2>{record.splits.length ? record.splits.map((split, index) => <div className="split-row" key={index}><span>{index + 1}{split.distanceKm < 1 ? ` (${split.distanceKm.toFixed(2)}km)` : ' km'}</span><strong>{formatPace(split.distanceKm*1000, split.durationSeconds)}</strong><i style={{ width: `${Math.max(30, Math.min(100, 520/split.paceSecondsPerKm*100))}%`}}/></div>) : <p className="muted">유효한 GPS 이동이 20m 이상 기록되면 구간 페이스를 표시해요.</p>}</section><div className="truth-card"><CircleAlert/><p>웹에서 신뢰할 수 없는 심박수·케이던스·칼로리 값은 만들지 않았습니다.</p></div></div>;
}

function PlanCard({ plan }: { plan: CoachPlan }) {
  return <div className="plan-card"><div className="plan-heading"><span>현재 러닝 수준 <strong>{plan.runnerLevel}</strong></span><h3>{plan.goal}</h3><p>{plan.weeklySummary}</p></div><div className="plan-sessions">{plan.sessions.map((session, index) => <div key={`${session.day}-${index}`}><span>{session.day}</span><div><strong>{session.type} · {session.distanceKm}km</strong><small>{session.intensity} · {session.description}</small></div></div>)}</div><p className="safety-note"><ShieldCheck size={16}/>{plan.safetyNote}</p></div>;
}
