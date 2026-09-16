import type { Metadata, Viewport } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
import './mobile.css';

export const metadata: Metadata = { title: 'RUN Guard Web', description: '현재 위치에서 시작하는 설명 가능한 러닝 코스와 Gemini 맞춤 코칭' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content', themeColor: '#b2f300' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body>{children}</body></html>; }
