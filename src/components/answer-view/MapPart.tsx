'use client';

/**
 * The map part (OF3b, Sprint OF-1, website #810; criteria 8 to 10): beside a map-format answer, under every layout
 * (`AnswerView.tsx` places it directly after the answer; fold 5, flag 6).
 *
 *   A RUN: the plot, the count line, the table of the mapped rows (in a focusable region, so a keyboard reaches it,
 *   under its caption) and "Download map data"; or W8's sentence. Never an empty plot: a drawn outcome has at least one
 *   point, and any other outcome shows its sentence.
 *   A RECORD: "Output format: {name}", the line saying the page draws no map (C2a = A), the count line and the table;
 *   or W8's sentence. No plot and no download (K4 = A; the seat's fold 3).
 *
 * THE PLOT is inline SVG drawn here from the points' coordinates (an equirectangular projection over their extent): no
 * basemap, no tile, no image from any host. Its alternative text is built from the counts (W9).
 *
 * NOTHING HERE RENDERS MARKUP FROM THE DATA: every value is a React text child or an attribute, so a row's name that
 * carries markup shows as text.
 */
import type { MapPartModel, MapPoint } from '@/lib/output-format/map-part';
import { MAP_DATA_DOWNLOAD, MAP_TABLE_HEADINGS, MAP_VALUE_NOT_STATED } from '@/lib/output-format/map-words';
import { saveBlobAsFile } from '@/lib/evidence/package-download';

const VIEW_WIDTH = 640;
const PAD = 16;

/** The plot's frame: each point at x, y in a `VIEW_WIDTH`-wide box whose height keeps the extent's shape. */
export function projectPoints(points: readonly MapPoint[]): { height: number; at: Array<[number, number]> } {
  const lons = points.map((p) => p.longitude);
  const lats = points.map((p) => p.latitude);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180) || 1;
  const spanX = Math.max((maxLon - minLon) * kx, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const inner = VIEW_WIDTH - 2 * PAD;
  const height = Math.min(Math.max((inner * spanY) / spanX, 160), 480) + 2 * PAD;
  const scale = Math.min(inner / spanX, (height - 2 * PAD) / spanY);
  const offX = (VIEW_WIDTH - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const single = points.length === 1 || (maxLon === minLon && maxLat === minLat);
  return {
    height,
    at: points.map((p) => single
      ? [VIEW_WIDTH / 2, height / 2]
      : [offX + (p.longitude - minLon) * kx * scale, height - offY - (p.latitude - minLat) * scale]),
  };
}

function Plot({ points, alt }: { points: MapPoint[]; alt: string }) {
  const { height, at } = projectPoints(points);
  return (
    <svg
      data-part="map-plot"
      role="img"
      aria-label={alt}
      viewBox={`0 0 ${VIEW_WIDTH} ${Math.round(height)}`}
      style={{ width: '100%', height: 'auto', display: 'block', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--card-background)' }}
    >
      <title>{alt}</title>
      {at.map(([x, y], i) => (
        <circle key={points[i].id} cx={x.toFixed(1)} cy={y.toFixed(1)} r={4} style={{ fill: 'var(--accent)', fillOpacity: 0.75, stroke: 'var(--accent)' }} />
      ))}
    </svg>
  );
}

function Table({ points, caption }: { points: MapPoint[]; caption: string }) {
  return (
    // A focusable region, so a keyboard reaches the table and scrolls it (WCAG 2.1.1).
    <div data-part="map-table" role="region" aria-label={caption} tabIndex={0} style={{ maxHeight: '320px', overflow: 'auto', marginTop: '12px', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <caption style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--text-primary)' }}>{caption}</caption>
        <thead>
          <tr>
            {[MAP_TABLE_HEADINGS.row, MAP_TABLE_HEADINGS.name, MAP_TABLE_HEADINGS.latitude, MAP_TABLE_HEADINGS.longitude].map((h) => (
              <th key={h} scope="col" style={{ textAlign: 'left', padding: '4px 10px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.id}>
              <td style={{ padding: '3px 10px', fontFamily: 'monospace' }}>{p.id}</td>
              {/* Fold 6: an empty label value is stated as such, never an empty cell. */}
              <td style={{ padding: '3px 10px', ...(p.name === undefined || p.name === '' ? { color: 'var(--text-muted)', fontStyle: 'italic' } : {}) }}>
                {p.name === undefined || p.name === '' ? MAP_VALUE_NOT_STATED : p.name}
              </td>
              <td style={{ padding: '3px 10px', fontFamily: 'monospace' }}>{p.latitude}</td>
              <td style={{ padding: '3px 10px', fontFamily: 'monospace' }}>{p.longitude}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LINE_STYLE: React.CSSProperties = { margin: '0 0 8px', fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' };

export default function MapPart({ map }: { map: MapPartModel }) {
  const outcome = map.outcome;
  if (map.surface === 'run' && outcome === undefined) return null;
  const download = map.download;
  return (
    <div data-part="map" style={{ margin: '0 0 24px' }}>
      {map.formatLine !== undefined && <p data-part="map-format-line" style={{ ...LINE_STYLE, fontWeight: 600, color: 'var(--text-primary)' }}>{map.formatLine}</p>}
      {map.notShownLine !== undefined && <p data-part="map-not-shown" style={LINE_STYLE}>{map.notShownLine}</p>}
      {outcome?.kind === 'drawn' && (
        <>
          {map.surface === 'run' && <Plot points={outcome.points} alt={outcome.alt} />}
          <p data-part="map-count-line" style={{ ...LINE_STYLE, marginTop: map.surface === 'run' ? '8px' : 0 }}>{outcome.countLine}</p>
          <Table points={outcome.points} caption={outcome.caption} />
          {/* Fold 6 (the seat's 7225128356): what "Label" and "Row" hold, under the table. */}
          {outcome.labelLine !== undefined && <p data-part="map-label-line" style={{ ...LINE_STYLE, margin: '8px 0 0', fontSize: '12px' }}>{outcome.labelLine}</p>}
          <p data-part="map-row-line" style={{ ...LINE_STYLE, margin: '4px 0 0', fontSize: '12px' }}>{outcome.rowLine}</p>
          {map.surface === 'run' && download !== undefined && (
            <button
              type="button"
              data-part="map-download"
              onClick={() => saveBlobAsFile(new Blob([download.json], { type: 'application/json' }), download.fileName)}
              style={{ marginTop: '10px', padding: '6px 12px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
            >
              {MAP_DATA_DOWNLOAD}
            </button>
          )}
        </>
      )}
      {outcome?.kind === 'none' && <p data-part="map-none" style={LINE_STYLE}>{outcome.sentence}</p>}
    </div>
  );
}
