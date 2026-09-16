export type LngLat = [longitude: number, latitude: number];
export type AppView = 'home' | 'route' | 'running' | 'records' | 'coach' | 'menu';
export type SessionStatus = 'idle' | 'route-setup' | 'route-ready' | 'running' | 'paused' | 'finished';

export type LocationPoint = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  headingDegrees: number | null;
  timestampMs: number;
  sessionElapsedSeconds?: number;
};

export type NavigationStep = {
  instruction: string;
  distanceM: number;
  coordinateIndex: number;
  maneuver: string;
};

export type WarningPoint = {
  id: string;
  coordinate: LngLat;
  name: string;
  distanceFromRouteM: number;
  accidentCount: number;
  severity: 'high' | 'medium' | 'low';
};

export type RouteCandidate = {
  id: string;
  coordinates: LngLat[];
  turnaroundCoordinate?: LngLat;
  distanceM: number;
  durationSeconds: number;
  distanceAccuracyScore: number;
  safetyScore: number | null;
  recommendationScore: number | null;
  warningPoints: WarningPoint[];
  navigationSteps: NavigationStep[];
};

export type RunningRecord = {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  targetDistanceM: number;
  distanceM: number;
  durationSeconds: number;
  averagePaceSecondsPerKm: number | null;
  plannedRoute: LngLat[];
  actualRoute: LocationPoint[];
  splits: Array<{ distanceKm: number; durationSeconds: number; paceSecondsPerKm: number }>;
};

export type CoachSession = {
  day: string;
  type: string;
  distanceKm: number;
  intensity: string;
  description: string;
};

export type CoachPlan = {
  runnerLevel: '초급' | '중급' | '상급';
  goal: string;
  weeklySummary: string;
  sessions: CoachSession[];
  coachComment: string;
  safetyNote: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  plan?: CoachPlan;
};
