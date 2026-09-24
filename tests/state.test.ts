import { describe, expect, it } from 'vitest';
import { DEFAULT_BRIEF, initialState, progressOf, reducer } from '@/lib/client/state';
import type { WorkspaceState } from '@/lib/client/state';
import type { Source } from '@/lib/types';

const source: Source = {
  id: 'src-1',
  kind: 'pdf',
  title: 'report.pdf',
  text: 'Water use fell by 18%.',
  pageCount: 1,
  segments: [{ id: 'src-1-p1-1', sourceId: 'src-1', page: 1, text: 'Water use fell by 18%.' }],
  warnings: [],
  charCount: 22,
  extractedAt: '2026-01-01T00:00:00.000Z',
};

/** A workspace with two completed artefacts. */
function withTwoArtifacts(): WorkspaceState {
  let state = reducer(initialState, { type: 'extract_success', source });
  state = reducer(state, {
    type: 'set_brief',
    patch: { formats: ['exec_summary', 'linkedin'] },
  });
  state = reducer(state, { type: 'generate_start', formats: ['exec_summary', 'linkedin'] });
  state = reducer(state, {
    type: 'artifact_success',
    format: 'exec_summary',
    content: { title: 'Summary' },
    findings: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  state = reducer(state, {
    type: 'artifact_success',
    format: 'linkedin',
    content: { hook: 'Hook' },
    findings: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  return state;
}

describe('partial success', () => {
  it('a failed format does not remove a completed one', () => {
    let state = withTwoArtifacts();
    state = reducer(state, {
      type: 'artifact_failure',
      format: 'linkedin',
      error: 'provider overloaded',
    });

    expect(state.artifacts.linkedin?.status).toBe('failed');
    expect(state.artifacts.linkedin?.error).toBe('provider overloaded');
    // The other artefact survives untouched.
    expect(state.artifacts.exec_summary?.status).toBe('complete');
    expect(state.artifacts.exec_summary?.content).toEqual({ title: 'Summary' });
  });

  it('keeps the previous content when a retry fails', () => {
    let state = withTwoArtifacts();
    state = reducer(state, { type: 'generate_start', formats: ['linkedin'] });
    state = reducer(state, { type: 'artifact_failure', format: 'linkedin', error: 'timeout' });

    // A failed retry must not destroy the result the operator already had.
    expect(state.artifacts.linkedin?.content).toEqual({ hook: 'Hook' });
    expect(state.artifacts.linkedin?.status).toBe('failed');
  });

  it('regenerating one format leaves the others queued as they were', () => {
    let state = withTwoArtifacts();
    state = reducer(state, { type: 'generate_start', formats: ['linkedin'] });

    expect(state.artifacts.linkedin?.status).toBe('pending');
    expect(state.artifacts.exec_summary?.status).toBe('complete');
  });

  it('reports progress from real artefact status only', () => {
    let state = withTwoArtifacts();
    state = reducer(state, { type: 'artifact_failure', format: 'linkedin', error: 'x' });

    expect(progressOf(state, ['exec_summary', 'linkedin'])).toEqual({
      total: 2,
      complete: 1,
      failed: 1,
      running: 0,
    });
  });
});

describe('edit preservation', () => {
  it('stores edits separately from generated content', () => {
    let state = withTwoArtifacts();
    state = reducer(state, {
      type: 'edit_artifact',
      format: 'linkedin',
      content: { hook: 'Operator wrote this' },
    });

    expect(state.artifacts.linkedin?.content).toEqual({ hook: 'Hook' });
    expect(state.artifacts.linkedin?.edited).toEqual({ hook: 'Operator wrote this' });
    expect(state.artifacts.linkedin?.editedAt).toBeDefined();
  });

  it('reverting restores the generated version', () => {
    let state = withTwoArtifacts();
    state = reducer(state, { type: 'edit_artifact', format: 'linkedin', content: { hook: 'edited' } });
    state = reducer(state, { type: 'revert_edits', format: 'linkedin' });

    expect(state.artifacts.linkedin?.edited).toBeNull();
    expect(state.artifacts.linkedin?.content).toEqual({ hook: 'Hook' });
  });

  it('a successful regeneration replaces the edit', () => {
    let state = withTwoArtifacts();
    state = reducer(state, { type: 'edit_artifact', format: 'linkedin', content: { hook: 'edited' } });
    state = reducer(state, {
      type: 'artifact_success',
      format: 'linkedin',
      content: { hook: 'regenerated' },
      findings: [],
      generatedAt: '2026-01-02T00:00:00.000Z',
    });

    // The UI confirms before this happens; here we only assert the outcome.
    expect(state.artifacts.linkedin?.edited).toBeNull();
    expect(state.artifacts.linkedin?.content).toEqual({ hook: 'regenerated' });
  });
});

describe('source changes', () => {
  it('a new source invalidates the ledger and every artefact', () => {
    let state = withTwoArtifacts();
    state = reducer(state, { type: 'analyze_success', ledger: { ...emptyLedger, topic: 'T' } });
    state = reducer(state, { type: 'extract_success', source: { ...source, id: 'src-2' } });

    expect(state.ledger).toBeNull();
    expect(state.artifacts).toEqual({});
  });
});

describe('creative mode', () => {
  it('starting a creative draft clears source, ledger and artefacts', () => {
    let state = withTwoArtifacts();
    state = reducer(state, { type: 'start_creative', prompt: 'Draft a campaign' });

    expect(state.brief.mode).toBe('creative');
    expect(state.creativePrompt).toBe('Draft a campaign');
    expect(state.source).toBeNull();
    expect(state.ledger).toBeNull();
    expect(state.artifacts).toEqual({});
  });

  it('adding a source returns the workspace to grounded mode', () => {
    let state = reducer(initialState, { type: 'start_creative', prompt: 'Draft a campaign' });
    state = reducer(state, { type: 'extract_success', source });

    expect(state.brief.mode).toBe('grounded');
    expect(state.creativePrompt).toBe('');
    expect(state.source).toEqual(source);
  });

  it('reset keeps the operator\'s brief preferences', () => {
    let state = reducer(initialState, { type: 'set_brief', patch: { audience: 'Leadership' } });
    state = reducer(state, { type: 'reset' });

    expect(state.brief.audience).toBe('Leadership');
    expect(state.source).toBeNull();
    expect(state.brief.formats).toEqual(DEFAULT_BRIEF.formats);
  });
});

const emptyLedger = {
  topic: '',
  facts: [],
  entities: [],
  sourceActions: [],
  missingInformation: [],
  caveats: [],
  warnings: [],
};
