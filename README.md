# RUN Guard Web

RUN Guard는 현재 위치에서 목표 거리의 왕복 러닝 코스를 추천하고, 공공 교통사고 데이터를 기준으로 코스 주변의 주의 지점을 설명하는 러닝 서비스입니다. 이 저장소는 기존 Expo/React Native Android MVP를 제품 기준으로 삼아, Wanted AI Championship에서 URL로 직접 체험할 수 있도록 Next.js Web 애플리케이션으로 변환한 버전입니다.

## Android MVP와 Web의 관계

기존 Android의 캐릭터, 라임 색상, RUN 중심 탐색, 지도 오버레이, 5/7/10km 흐름, 러닝 상태, 기록과 설정 의도를 유지했습니다. React Native UI, Expo Location, React Navigation, MapLibre React Native, AsyncStorage는 각각 반응형 HTML/CSS, Browser Geolocation, 공유 React 상태, MapLibre GL JS, localStorage로 다시 구현했습니다. Android 마이그레이션 전수표는 [`docs/WEB_MIGRATION.md`](docs/WEB_MIGRATION.md)에 있습니다.

## 핵심 원칙

> 거리·경로·안전도처럼 명확한 계산이 필요한 영역은 설명 가능한 규칙 기반 로직으로 처리하고, 사용자의 자연어 목표·일정·러닝 기록처럼 복합적인 조건을 이해해야 하는 개인화 코칭에 LLM을 활용합니다.

규칙 기반 영역:

- ORS 보행 경로를 이용한 5/7/10km 왕복 코스 후보 생성
- Android와 같은 3방향 후보, 최대 3회 거리 보정, 200m 또는 3% 허용오차
- 거리 정확도 점수
- KoROAD 보행노인 사고다발지역과 경로 사이의 거리, 사고 건수 및 거리에 따른 상대 안전도
- 상대 안전도 70% + 거리 정확도 30%의 추천 점수
- GPS Haversine 거리, 페이스, 진행률과 구간 기록

LLM 영역:

- 사용자의 자연어 목표와 가능한 요일 해석
- 최근 RUN Guard 기록을 반영한 개인화 주간 계획
- 기존 계획과 대화 맥락을 유지한 다중 턴 수정

Gemini가 경로 안전을 판단하거나 사고를 예측한다고 주장하지 않습니다. 안전 점수는 상대 비교를 위한 설명 가능한 규칙이며 절대적인 안전을 보장하지 않습니다.

## 반응형 경험

- 모바일: 기존 RUN Guard 앱의 캐릭터, 카드, 색상, AI 코치 / RUN / 메뉴 하단 탐색을 유지합니다. 코스 및 러닝 화면에서는 지도가 상단 작업 영역이 됩니다.
- 데스크톱: 왼쪽 기능 패널과 큰 오른쪽 지도로 구성됩니다. 라우팅, 러닝, 기록, AI 코치가 동일한 공유 상태를 사용합니다.
- 약 320px 너비부터 데스크톱까지 별도 반응형 구성을 사용하며, 고정 폰 프레임이나 스크린샷 모형이 아닙니다.

## 위치와 러닝

초기 위치는 `navigator.geolocation.getCurrentPosition()`, 러닝 중에는 `navigator.geolocation.watchPosition()`을 사용합니다. HTTPS(또는 localhost)와 브라우저 위치 권한이 필요합니다. 권한 거부, 위치 서비스 실패, 50m를 넘는 낮은 정확도를 별도 상태로 표시하며 가짜 위치로 대체하지 않습니다.

Android에서 확인한 필터를 유지합니다.

- 위치 정확도 최대 50m
- 현실적인 러닝 속도 최대 15m/s
- 의미 있는 최소 이동 2m
- 위치 샘플 간격 최대 10초
- 15초 이상 새 좌표가 없으면 신호 경고
- 경로에서 60m 이상 벗어나면 이탈 안내

웹 브라우저가 닫히거나 화면이 중단된 상태의 네이티브 수준 백그라운드 GPS는 지원하지 않습니다. 러닝 중 화면을 유지해야 합니다.

## 지도와 외부 API

MapLibre GL JS가 OpenStreetMap 타일 위에 현재 위치, 계획 경로, 실제 이동 경로와 주의 지점을 표시합니다.

| 변수 | 서버에서 사용하는 서비스 | 용도 |
|---|---|---|
| `ORS_API_KEY` | OpenRouteService | 보행 왕복 경로 및 길안내 단계 |
| `KAKAO_REST_API_KEY` | Kakao Local | 장소 검색, 좌표→법정동 변환 |
| `PUBLIC_DATA_API_KEY` | 공공데이터포털/KoROAD | 2024 보행노인 교통사고 다발지역 |
| `GEMINI_API_KEY` | Google Gemini | 대화형 개인 맞춤 러닝 코치 |
| `GEMINI_MODEL` | Google Gemini | 기본값 `gemini-3.6-flash` |

모든 비밀 키는 Next.js 서버 Route Handler에서만 읽습니다. 브라우저 번들용 `NEXT_PUBLIC_*`에 비밀 키를 넣지 않습니다. 외부 API 실패는 가짜 성공 데이터로 대체하지 않고 구성 필요/일시 오류 상태를 표시합니다.

## AI 코치

기존의 수동 초급/중급/상급 선택은 제거했습니다. 빠른 프롬프트 또는 자유 입력을 보내면 `/api/ai-coach`가 최근 최대 10개 러닝 기록, 현재 계획, 최근 최대 12개 대화를 Gemini에 전달합니다. 응답은 `runnerLevel`, `goal`, `weeklySummary`, `sessions`, `coachComment`, `safetyNote` 스키마로 검증합니다.

키가 없으면 화면과 전체 앱은 정상 로드되며, 메시지를 보낼 때 `AI 코치 설정이 아직 완료되지 않았습니다.`라고 정확히 안내합니다. 로컬 생성 답변을 Gemini 답변처럼 표시하지 않습니다. 기본 IP별 요청 제한과 입력/대화 길이 제한이 포함돼 있습니다.

## 기록

완료한 러닝은 localStorage에 저장됩니다. 거리, 활성 러닝 시간, 평균 페이스, 계획/실제 경로와 GPS 기반 1km splits를 표시합니다. 웹에서 신뢰할 수 있는 센서 출처가 없는 심박수, 케이던스, 칼로리, 고도 상승 값은 만들지 않습니다.

## 로컬 개발

요구 사항: Node.js 20.9 이상(Next.js 16 권장 범위), npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. `.env.local`의 빈 값을 실제 키로 채워야 관련 외부 기능이 동작합니다.

검증 명령:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Vercel 배포

1. 이 저장소를 GitHub/GitLab/Bitbucket에 push합니다.
2. Vercel에서 **Add New → Project**로 저장소를 import합니다.
3. Framework Preset이 Next.js, Root Directory가 저장소 루트인지 확인합니다.
4. **Project → Settings → Environment Variables**에 `GEMINI_API_KEY`, `GEMINI_MODEL`, `ORS_API_KEY`, `KAKAO_REST_API_KEY`, `PUBLIC_DATA_API_KEY`를 입력합니다.
5. Production, Preview, Development 중 필요한 환경에 적용하고 Deploy합니다.
6. 배포된 HTTPS URL에서 위치 권한, API 오류 상태, 모바일/데스크톱 흐름을 다시 확인합니다.

## 대회 빌드의 의도적 제한

- 로그인, 계정, 클라우드 동기화 및 결제 없음
- 기록/설정/코치 계획은 현재 브라우저에만 저장
- 브라우저가 종료된 상태의 백그라운드 GPS 없음
- 심박수·케이던스 등 별도 센서가 필요한 지표 없음
- 공공데이터의 제공 범위와 기준연도(2024)에 따라 안전 데이터가 없을 수 있음

이 제한은 실제로 얻을 수 없는 데이터를 꾸며내지 않기 위한 것입니다.
