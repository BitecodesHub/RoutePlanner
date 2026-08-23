"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Number badge for sequenced stops; "S" for the start point. */
  label: string;
  kind: "start" | "shop" | "selected";
  title?: string;
}

export interface MapViewProps {
  markers: MapMarker[];
  polyline?: [number, number][] | null;
  height?: string;
  onMarkerClick?: (id: string) => void;
  /** Re-fit bounds whenever this key changes. */
  fitKey?: string;
}

const markerColors: Record<MapMarker["kind"], string> = {
  start: "#059669",
  shop: "#6b7280",
  selected: "#2563eb",
};

function makeIcon(marker: MapMarker): L.DivIcon {
  const bg = markerColors[marker.kind];
  const size = marker.kind === "start" ? 34 : 28;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${marker.kind === "start" ? 14 : 12}px;font-weight:700;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${marker.label}</div>`,
  });
}

function FitBounds({ markers, fitKey }: { markers: MapMarker[]; fitKey?: string }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.15), { maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, markers.length, map]);
  return null;
}

export default function MapViewInner({
  markers,
  polyline,
  height = "420px",
  onMarkerClick,
  fitKey,
}: MapViewProps) {
  const center = useMemo<[number, number]>(() => {
    if (markers.length > 0) return [markers[0].lat, markers[0].lng];
    return [23.0634, 72.512]; // sensible default until data loads
  }, [markers]);

  return (
    <div style={{ height }} className="overflow-hidden rounded-xl border border-gray-200">
      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {polyline && polyline.length > 1 && (
          <Polyline positions={polyline} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.75 }} />
        )}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={makeIcon(m)}
            eventHandlers={onMarkerClick ? { click: () => onMarkerClick(m.id) } : undefined}
          >
            {m.title && (
              <Tooltip direction="top" offset={[0, -14]}>
                {m.title}
              </Tooltip>
            )}
          </Marker>
        ))}
        <FitBounds markers={markers} fitKey={fitKey} />
      </MapContainer>
    </div>
  );
}
