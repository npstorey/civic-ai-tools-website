'use client';

import { useState } from 'react';

interface ProvNode {
  '@id': string;
  '@type': string | string[];
  [key: string]: unknown;
}

interface ProvGraph {
  '@context': Record<string, string>;
  '@graph': ProvNode[];
}

interface ProvenanceGraphSectionProps {
  provenance: ProvGraph;
  slug: string;
}

function getType(node: ProvNode): string {
  const t = node['@type'];
  if (Array.isArray(t)) return t.map(s => s.replace('prov:', '')).join(', ');
  return (t as string).replace('prov:', '');
}

function getDescription(node: ProvNode): string {
  return (node['dcterms:description'] as string) || (node['dcterms:title'] as string) || '';
}

function shortId(id: string): string {
  // Show last segment of URN
  const parts = id.split(':');
  return parts.slice(-2).join(':');
}

function TypeIcon({ type }: { type: string }) {
  if (type.includes('Agent')) return <span title="Agent" style={{ marginRight: '4px' }}>&#x1f916;</span>;
  if (type.includes('Activity')) return <span title="Activity" style={{ marginRight: '4px' }}>&#x2699;&#xFE0F;</span>;
  if (type.includes('Plan')) return <span title="Plan" style={{ marginRight: '4px' }}>&#x1f4cb;</span>;
  return <span title="Entity" style={{ marginRight: '4px' }}>&#x1f4e6;</span>;
}

export default function ProvenanceGraphSection({ provenance, slug }: ProvenanceGraphSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [showJson, setShowJson] = useState(false);

  // Deduplicate nodes by @id (the mapper may emit partial nodes for relationships)
  const nodeMap = new Map<string, ProvNode>();
  for (const node of provenance['@graph']) {
    const existing = nodeMap.get(node['@id']);
    if (existing) {
      // Merge properties
      nodeMap.set(node['@id'], { ...existing, ...node });
    } else {
      nodeMap.set(node['@id'], node);
    }
  }
  const nodes = Array.from(nodeMap.values());

  const entities = nodes.filter(n => {
    const t = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    return t.some(tt => tt === 'prov:Entity') && !t.some(tt => tt === 'prov:Plan');
  });
  const activities = nodes.filter(n => {
    const t = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    return t.some(tt => tt === 'prov:Activity');
  });
  const agents = nodes.filter(n => {
    const t = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    return t.some(tt => tt === 'prov:Agent');
  });
  const plans = nodes.filter(n => {
    const t = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    return t.some(tt => tt === 'prov:Plan');
  });

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(provenance, null, 2)], { type: 'application/ld+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `provenance-${slug}.jsonld`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      padding: '16px 20px', border: '1px solid var(--border-color)',
      borderRadius: '6px', backgroundColor: 'white',
    }}>
      {/* Summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded ? '16px' : 0 }}>
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <span>{entities.length} entities</span>
          <span>{activities.length} activities</span>
          <span>{agents.length} agents</span>
          {plans.length > 0 && <span>{plans.length} plan{plans.length !== 1 ? 's' : ''}</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleDownload}
            style={{
              background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px',
              padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: 'var(--text-secondary)',
            }}
          >
            Download PROV-O
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none', border: 'none', padding: '4px 8px',
              fontSize: '12px', cursor: 'pointer', color: 'var(--nyc-blue)',
            }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {/* Expanded view */}
      {expanded && (
        <>
          {/* Tab toggle */}
          <div style={{ display: 'flex', gap: '0', marginBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setShowJson(false)}
              style={{
                padding: '6px 12px', border: 'none', background: 'none',
                borderBottom: !showJson ? '2px solid var(--nyc-blue)' : '2px solid transparent',
                marginBottom: '-1px', fontSize: '12px', fontWeight: !showJson ? 600 : 400,
                color: !showJson ? 'var(--nyc-blue)' : 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              Summary
            </button>
            <button
              onClick={() => setShowJson(true)}
              style={{
                padding: '6px 12px', border: 'none', background: 'none',
                borderBottom: showJson ? '2px solid var(--nyc-blue)' : '2px solid transparent',
                marginBottom: '-1px', fontSize: '12px', fontWeight: showJson ? 600 : 400,
                color: showJson ? 'var(--nyc-blue)' : 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              JSON-LD
            </button>
          </div>

          {showJson ? (
            <pre style={{
              padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px',
              fontSize: '11px', lineHeight: 1.5, overflow: 'auto', maxHeight: '400px',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {JSON.stringify(provenance, null, 2)}
            </pre>
          ) : (
            <div style={{ fontSize: '12px' }}>
              {/* Agents */}
              {agents.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>Agents</div>
                  {agents.map(n => (
                    <div key={n['@id']} style={{ display: 'flex', gap: '6px', padding: '3px 0', color: 'var(--text-secondary)' }}>
                      <TypeIcon type={getType(n)} />
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>{shortId(n['@id'])}</span>
                      <span>{getDescription(n)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Activities */}
              {activities.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>Activities</div>
                  {activities.map(n => (
                    <div key={n['@id']} style={{ display: 'flex', gap: '6px', padding: '3px 0', color: 'var(--text-secondary)' }}>
                      <TypeIcon type={getType(n)} />
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>{shortId(n['@id'])}</span>
                      <span>{getDescription(n)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Entities */}
              {entities.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>Entities</div>
                  {entities.map(n => (
                    <div key={n['@id']} style={{ display: 'flex', gap: '6px', padding: '3px 0', color: 'var(--text-secondary)' }}>
                      <TypeIcon type={getType(n)} />
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>{shortId(n['@id'])}</span>
                      <span>{getDescription(n)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
