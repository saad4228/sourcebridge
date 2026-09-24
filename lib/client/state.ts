/**
 * Workspace state.
 *
 * Two rules are structural here rather than incidental:
 *  - Generated content and edited content are stored separately, so an edit is
 *    never silently lost and regeneration can warn before replacing it.
 *  - Each artefact carries its own status, so one failure cannot remove another
 *    format's completed result.
 */

import type {
  Artifact,
  FactLedger,
  FormatId,
  GenerationBrief,
  Source,
  ValidationFinding,
} from '../types';

export type Stage =
  | 'empty'
  | 'extracting'
  | 'source_ready'
  | 'analyzing'
  | 'analyzed'
  | 'generating'
  | 'reviewing';

export interface WorkspaceState {
  stage: Stage;
  source: Source | null;
  /** Operator-supplied background, sent with analysis. */
  context: string;
  ledger: FactLedger | null;
  brief: GenerationBrief;
  creativePrompt: string;
  artifacts: Partial<Record<FormatId, Artifact>>;
  /** Top-level error, e.g. extraction or analysis failure. */
  error: string | null;
  /** Transient status line describing a real operation in progress. */
  activity: string | null;
}

export const DEFAULT_BRIEF: GenerationBrief = {
  mode: 'grounded',
  audience: 'General public',
  objective: 'Inform',
  tone: 'Accessible',
  language: 'English',
  detail: 'Standard',
  formats: ['exec_summary', 'linkedin', 'presentation'],
};

export const initialState: WorkspaceState = {
  stage: 'empty',
  source: null,
  context: '',
  ledger: null,
  brief: DEFAULT_BRIEF,
  creativePrompt: '',
  artifacts: {},
  error: null,
  activity: null,
};

export type Action =
  | { type: 'reset' }
  | { type: 'extract_start' }
  | { type: 'extract_success'; source: Source }
  | { type: 'extract_failure'; error: string }
  | { type: 'set_context'; context: string }
  | { type: 'set_creative_prompt'; prompt: string }
  | { type: 'start_creative'; prompt: string }
  | { type: 'set_brief'; patch: Partial<GenerationBrief> }
  | { type: 'toggle_format'; format: FormatId }
  | { type: 'analyze_start' }
  | { type: 'analyze_success'; ledger: FactLedger }
  | { type: 'analyze_failure'; error: string }
  | { type: 'generate_start'; formats: FormatId[] }
  | { type: 'artifact_start'; format: FormatId }
  | {
      type: 'artifact_success';
      format: FormatId;
      content: unknown;
      findings: ValidationFinding[];
      generatedAt: string;
    }
  | { type: 'artifact_failure'; format: FormatId; error: string }
  | { type: 'generate_finished' }
  | { type: 'edit_artifact'; format: FormatId; content: unknown }
  | { type: 'revert_edits'; format: FormatId }
  | { type: 'dismiss_error' };

function artifactId(format: FormatId): string {
  return `art-${format}-${Date.now().toString(36)}`;
}

export function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'reset':
      return { ...initialState, brief: state.brief };

    case 'extract_start':
      return { ...state, stage: 'extracting', error: null, activity: 'Extracting source text' };

    case 'extract_success':
      return {
        ...state,
        stage: 'source_ready',
        // A real source returns the workspace to grounded mode.
        brief: { ...state.brief, mode: 'grounded' },
        creativePrompt: '',
        source: action.source,
        // A new source invalidates the ledger and every artefact derived from it.
        ledger: null,
        artifacts: {},
        error: null,
        activity: null,
      };

    case 'extract_failure':
      return { ...state, stage: 'empty', error: action.error, activity: null };

    case 'set_context':
      return { ...state, context: action.context };

    case 'set_creative_prompt':
      return { ...state, creativePrompt: action.prompt };

    case 'start_creative':
      // No source and no ledger: the draft is explicitly not source-verified.
      return {
        ...state,
        stage: 'analyzed',
        source: null,
        ledger: null,
        artifacts: {},
        creativePrompt: action.prompt,
        brief: { ...state.brief, mode: 'creative' },
        error: null,
        activity: null,
      };

    case 'set_brief':
      return { ...state, brief: { ...state.brief, ...action.patch } };

    case 'toggle_format': {
      const selected = state.brief.formats.includes(action.format)
        ? state.brief.formats.filter((f) => f !== action.format)
        : [...state.brief.formats, action.format];
      return { ...state, brief: { ...state.brief, formats: selected } };
    }

    case 'analyze_start':
      return { ...state, stage: 'analyzing', error: null, activity: 'Analysing source' };

    case 'analyze_success':
      return { ...state, stage: 'analyzed', ledger: action.ledger, activity: null };

    case 'analyze_failure':
      return { ...state, stage: 'source_ready', error: action.error, activity: null };

    case 'generate_start': {
      // Queue only the formats in this run; leave other artefacts untouched.
      const artifacts = { ...state.artifacts };
      for (const format of action.formats) {
        artifacts[format] = {
          id: artifactId(format),
          format,
          status: 'pending',
          content: artifacts[format]?.content ?? null,
          edited: artifacts[format]?.edited ?? null,
          findings: [],
        };
      }
      return { ...state, stage: 'generating', artifacts, error: null, activity: null };
    }

    case 'artifact_start': {
      const existing = state.artifacts[action.format];
      if (!existing) return state;
      return {
        ...state,
        artifacts: { ...state.artifacts, [action.format]: { ...existing, status: 'generating' } },
      };
    }

    case 'artifact_success': {
      const existing = state.artifacts[action.format];
      return {
        ...state,
        artifacts: {
          ...state.artifacts,
          [action.format]: {
            id: existing?.id ?? artifactId(action.format),
            format: action.format,
            status: 'complete',
            content: action.content,
            // A fresh generation replaces the previous edit deliberately; the UI
            // confirms with the operator before triggering this.
            edited: null,
            findings: action.findings,
            generatedAt: action.generatedAt,
          },
        },
      };
    }

    case 'artifact_failure': {
      const existing = state.artifacts[action.format];
      return {
        ...state,
        artifacts: {
          ...state.artifacts,
          [action.format]: {
            id: existing?.id ?? artifactId(action.format),
            format: action.format,
            status: 'failed',
            // Keep any previously successful content so a retry failure is not
            // destructive.
            content: existing?.content ?? null,
            edited: existing?.edited ?? null,
            findings: existing?.findings ?? [],
            error: action.error,
          },
        },
      };
    }

    case 'generate_finished':
      return { ...state, stage: 'reviewing', activity: null };

    case 'edit_artifact': {
      const existing = state.artifacts[action.format];
      if (!existing) return state;
      return {
        ...state,
        artifacts: {
          ...state.artifacts,
          [action.format]: { ...existing, edited: action.content, editedAt: new Date().toISOString() },
        },
      };
    }

    case 'revert_edits': {
      const existing = state.artifacts[action.format];
      if (!existing) return state;
      return {
        ...state,
        artifacts: {
          ...state.artifacts,
          [action.format]: { ...existing, edited: null, editedAt: undefined },
        },
      };
    }

    case 'dismiss_error':
      return { ...state, error: null };

    default:
      return state;
  }
}

/** Counts used for progress display. Derived from real artefact status only. */
export function progressOf(state: WorkspaceState, formats: FormatId[]) {
  const tracked = formats.map((f) => state.artifacts[f]).filter(Boolean) as Artifact[];
  return {
    total: formats.length,
    complete: tracked.filter((a) => a.status === 'complete').length,
    failed: tracked.filter((a) => a.status === 'failed').length,
    running: tracked.filter((a) => a.status === 'generating').length,
  };
}
