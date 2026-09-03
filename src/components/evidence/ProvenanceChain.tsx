'use client';

import { useState } from 'react';
import type { EvidencePackage } from '@/lib/evidence/packager';
import { describeQueryOutcome } from '@/lib/evidence/query-step';
import { formatModelName } from '@/lib/models';

interface ProvenanceChainProps {
  pkg: EvidencePackage;
}

function StepContainer({ children, isLast }: { children: React.ReactNode; isLast?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '20px', flexShrink: 0 }}>
        <div style={{
          width: '10px', height: '10px', borderRadius: '50%',
          backgroundColor: 'var(--accent)', flexShrink: 0, marginTop: '5px',
        }} />
        {!isLast && (
          <div style={{ width: '2px', flex: 1, backgroundColor: 'var(--border-color)', minHeight: '16px' }} />
        )}
      </div>
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : '12px' }}>
        {children}
      </div>
    </div>
  );
}

function StepLabel({ label, detail }: { label: string; detail?: string }) {
  return (
    <div>
      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
      {detail && (
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '8px' }}>{detail}</span>
      )}
    </div>
  );
}

function ExpandableStep({ label, detail, children }: { label: string; detail?: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', gap: '6px', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '12px' }}>
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
        <StepLabel label={label} detail={detail} />
      </button>
      {expanded && (
        <div style={{
          marginTop: '8px', marginLeft: '18px', padding: '10px 12px',
          backgroundColor: 'var(--card-background)', borderRadius: '4px',
          border: '1px solid var(--border-color)', fontSize: '13px',
          fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          maxHeight: '300px', overflow: 'auto',
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function formatOperationType(op: string): string {
  switch (op) {
    case 'catalog': return 'Search catalog';
    case 'metadata': return 'Get metadata';
    case 'query': return 'Query data';
    case 'metrics': return 'Get metrics';
    default: return op;
  }
}

function buildSoqlSummary(args: Record<string, unknown>): string {
  const parts: string[] = [];
  if (args.select) parts.push(`SELECT ${args.select}`);
  if (args.where) parts.push(`WHERE ${args.where}`);
  if (args.group) parts.push(`GROUP BY ${args.group}`);
  if (args.order) parts.push(`ORDER BY ${args.order}`);
  if (args.limit) parts.push(`LIMIT ${args.limit}`);
  return parts.join('\n');
}

export default function ProvenanceChain({ pkg }: ProvenanceChainProps) {
  const totalSteps = 3 + pkg.queries.length; // prompt + model + queries + output
  let stepIndex = 0;

  return (
    <div>
      {/* Prompt */}
      <StepContainer>
        {pkg.prompt.visibility === 'full_text' && pkg.prompt.text ? (
          <ExpandableStep label="Prompt" detail="user query">
            {pkg.prompt.text}
          </ExpandableStep>
        ) : (
          <div>
            <StepLabel label="Prompt" detail="hash only" />
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'monospace' }}>
              {pkg.prompt.hash.slice(0, 16)}...
            </div>
          </div>
        )}
      </StepContainer>

      {/* Model + Skill */}
      <StepContainer>
        <StepLabel label="Model" detail={formatModelName(pkg.cost.model)} />
        {pkg.skillMetadata.systemPromptHash && (
          <div style={{ marginTop: '4px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Skill guidance
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>
              {pkg.skillMetadata.systemPromptHash.slice(0, 12)}
            </div>
          </div>
        )}
      </StepContainer>

      {/* Tool calls */}
      {pkg.queries.map((q, i) => {
        stepIndex++;
        const isLast = stepIndex === totalSteps - 1 && i === pkg.queries.length - 1;
        const opLabel = formatOperationType(q.operationType);
        const datasetLabel = q.datasetId ? ` \u00b7 ${q.datasetId}` : '';
        const portalLabel = q.portal ? ` on ${q.portal}` : '';
        const durationLabel = q.duration_ms ? ` \u00b7 ${(q.duration_ms / 1000).toFixed(1)}s` : '';
        // #384 F5: the outcome comes from the formatter both renderers share.
        // A returned result keeps this line's compact "\u2192 N rows"; a rejected
        // call is stated in words; an entry that recorded neither shows
        // neither here, rather than either.
        const outcome = describeQueryOutcome(q);
        const resultLabel = outcome.kind === 'returned'
          ? ` \u2192 ${q.resultRows} rows`
          : outcome.kind === 'failed'
            ? ` \u00b7 ${outcome.text}`
            : '';

        const soql = q.operationType === 'query' ? buildSoqlSummary(q.arguments) : null;
        const hasExpandableContent = soql || Object.keys(q.arguments).length > 2;

        return (
          <StepContainer key={i} isLast={isLast && !pkg.output}>
            {hasExpandableContent ? (
              <ExpandableStep
                label={`${q.tool}(${q.operationType})`}
                detail={`${opLabel}${datasetLabel}${portalLabel}${durationLabel}${resultLabel}`}
              >
                {soql || JSON.stringify(q.arguments, null, 2)}
              </ExpandableStep>
            ) : (
              <div>
                <StepLabel
                  label={`${q.tool}(${q.operationType})`}
                  detail={`${opLabel}${datasetLabel}${portalLabel}${durationLabel}${resultLabel}`}
                />
              </div>
            )}
          </StepContainer>
        );
      })}

      {/* Output — the detail page resolves BlobRef outputs to strings
         before passing the package in, so this is always a string in
         practice. The narrow below keeps the component resilient to a
         future change in the render pipeline. */}
      <StepContainer isLast>
        {typeof pkg.output === 'string' ? (
          <ExpandableStep
            label="Output"
            detail={`${pkg.output.length.toLocaleString()} characters`}
          >
            {pkg.output.slice(0, 2000)}{pkg.output.length > 2000 ? '\n\n[truncated]' : ''}
          </ExpandableStep>
        ) : (
          <StepLabel label="Output" detail="stored as blob — see detail page" />
        )}
      </StepContainer>
    </div>
  );
}
