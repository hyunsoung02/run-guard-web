'use client';

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { LngLat, LocationPoint, RouteCandidate } from '@/types/run-guard';

const mapStyle: StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

type Props = { location: LocationPoint | null; candidate: RouteCandidate | null; actualRoute: LocationPoint[]; progressCoordinate?: LngLat | null; followUser?: boolean; onFollowChange?: (follow: boolean) => void };

export default function RunGuardMap({ location, candidate, actualRoute, progressCoordinate, followUser = false, onFollowChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const turnaroundMarkerRef = useRef<maplibregl.Marker | null>(null);
  const locationRef = useRef(location);
  const progressCoordinateRef = useRef(progressCoordinate);
  const candidateRef = useRef(candidate);
  const actualRouteRef = useRef(actualRoute);
  const followUserRef = useRef(followUser);
  const followChangeRef = useRef(onFollowChange);
  const syncRef = useRef<() => void>(() => undefined);
  const lastFitCandidateRef = useRef<RouteCandidate | null>(null);
  const lastRouteDataCandidateRef = useRef<RouteCandidate | null>(null);
  const lastActualRouteSignatureRef = useRef('0');
  const lastCameraUpdateRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: mapStyle, center: [127.8, 36.3], zoom: 6.2, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    let syncScheduled = false;

    const scheduleSyncWhenReady = () => {
      if (syncScheduled) return;
      syncScheduled = true;
      map.once('idle', () => { syncScheduled = false; syncMap(); });
    };

    const syncMap = () => {
      const layersReady = map.getSource('planned') && map.getLayer('planned-shadow') && map.getLayer('planned-line') && map.getSource('actual') && map.getLayer('actual-line') && map.getSource('warnings') && map.getLayer('warning-circles');
      if (!layersReady) {
        if (!map.isStyleLoaded()) { scheduleSyncWhenReady(); return; }
        if (!map.getSource('planned')) map.addSource('planned', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        if (!map.getLayer('planned-shadow')) map.addLayer({ id: 'planned-shadow', type: 'line', source: 'planned', paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.92 } });
        if (!map.getLayer('planned-line')) map.addLayer({ id: 'planned-line', type: 'line', source: 'planned', paint: { 'line-color': '#6f9900', 'line-width': 6, 'line-opacity': 0.96 } });
        if (!map.getSource('actual')) map.addSource('actual', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        if (!map.getLayer('actual-line')) map.addLayer({ id: 'actual-line', type: 'line', source: 'actual', paint: { 'line-color': '#b2f300', 'line-width': 7 } });
        if (!map.getSource('warnings')) map.addSource('warnings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        if (!map.getLayer('warning-circles')) map.addLayer({ id: 'warning-circles', type: 'circle', source: 'warnings', paint: { 'circle-radius': 9, 'circle-color': '#ff5b37', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
      }

      const selected = candidateRef.current;
      const coordinates = selected?.coordinates ?? [];
      if (selected !== lastRouteDataCandidateRef.current) {
        lastRouteDataCandidateRef.current = selected;
        void (map.getSource('planned') as GeoJSONSource).setData(coordinates.length >= 2 ? { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} } : { type: 'FeatureCollection', features: [] });
        void (map.getSource('warnings') as GeoJSONSource).setData({ type: 'FeatureCollection', features: (selected?.warningPoints ?? []).map((point) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: point.coordinate }, properties: { name: point.name } })) });
      }
      const acceptedCoordinates = actualRouteRef.current.map((point) => [point.longitude, point.latitude]);
      const latestAcceptedPoint = actualRouteRef.current.at(-1);
      const actualRouteSignature = `${acceptedCoordinates.length}:${latestAcceptedPoint?.timestampMs ?? ''}`;
      if (actualRouteSignature !== lastActualRouteSignatureRef.current) {
        lastActualRouteSignatureRef.current = actualRouteSignature;
        void (map.getSource('actual') as GeoJSONSource).setData(acceptedCoordinates.length >= 2 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: acceptedCoordinates }, properties: {} } : { type: 'FeatureCollection', features: [] });
      }

      const currentLocation = locationRef.current;
      const currentCoordinate: LngLat | null = progressCoordinateRef.current ?? (currentLocation ? [currentLocation.longitude, currentLocation.latitude] : null);
      if (currentCoordinate) {
        if (!markerRef.current) {
          const element = document.createElement('div'); element.className = 'user-location-marker'; element.setAttribute('role', 'img'); element.setAttribute('aria-label', '현재 위치');
          markerRef.current = new maplibregl.Marker({ element }).setLngLat(currentCoordinate).addTo(map);
        } else markerRef.current.setLngLat(currentCoordinate);
      }

      const turnaroundCoordinate = selected?.turnaroundCoordinate;
      if (turnaroundCoordinate) {
        if (!turnaroundMarkerRef.current) {
          const element = document.createElement('img');
          element.className = 'turnaround-marker';
          element.src = '/assets/turnaround-marker.svg';
          element.alt = '반환 지점';
          turnaroundMarkerRef.current = new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, -8] }).setLngLat(turnaroundCoordinate).addTo(map);
        } else turnaroundMarkerRef.current.setLngLat(turnaroundCoordinate);
      } else if (turnaroundMarkerRef.current) {
        turnaroundMarkerRef.current.remove();
        turnaroundMarkerRef.current = null;
      }

      if (selected && coordinates.length > 1 && lastFitCandidateRef.current !== selected) {
        lastFitCandidateRef.current = selected;
        const bounds = coordinates.reduce((value, coordinate) => value.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: { top: 100, right: 70, bottom: 120, left: 70 }, maxZoom: 16, duration: 800 });
      } else if (!selected && currentCoordinate) {
        map.easeTo({ center: currentCoordinate, zoom: 15, duration: 700 });
      } else if (selected && currentCoordinate && followUserRef.current) {
        const now = Date.now();
        if (now - lastCameraUpdateRef.current >= 650) {
          lastCameraUpdateRef.current = now;
          map.easeTo({ center: currentCoordinate, zoom: Math.max(map.getZoom(), 16), bearing: currentLocation?.headingDegrees !== null && Number.isFinite(currentLocation?.headingDegrees) ? currentLocation!.headingDegrees! : map.getBearing(), duration: 350, essential: true });
        }
      }
    };

    syncRef.current = syncMap;
    map.on('load', syncMap);
    map.on('dragstart', () => followChangeRef.current?.(false));
    mapRef.current = map;
    return () => { markerRef.current?.remove(); turnaroundMarkerRef.current?.remove(); map.remove(); mapRef.current = null; syncRef.current = () => undefined; };
  }, []);

  useEffect(() => { locationRef.current = location; progressCoordinateRef.current = progressCoordinate; candidateRef.current = candidate; actualRouteRef.current = actualRoute; followUserRef.current = followUser; followChangeRef.current = onFollowChange; if (!candidate) lastFitCandidateRef.current = null; syncRef.current(); }, [location, progressCoordinate, candidate, actualRoute, followUser, onFollowChange]);

  return <div ref={containerRef} className="map-canvas" role="region" aria-label="RUN Guard 코스 지도" />;
}
