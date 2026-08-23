"use client";

import dynamic from "next/dynamic";
import { LoadingBlock } from "@/components/ui";
import type { MapViewProps, MapMarker } from "@/components/MapViewInner";

export type { MapMarker };

/** Leaflet touches `window`, so the map only renders client-side. */
const MapView = dynamic(() => import("@/components/MapViewInner"), {
  ssr: false,
  loading: () => <LoadingBlock label="Loading map…" />,
});

export default MapView as React.ComponentType<MapViewProps>;
