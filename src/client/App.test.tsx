import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

import { mockFetch } from '../../vitest.setup';
import type { DiffCommentThread, DiffResponse, ReviewDecision } from '../types/diff';
import type { ClientWatchState } from '../types/watch';
import { DiffMode } from '../types/watch';
import { mergeCommentImports, parseCommentImportValue } from '../utils/commentImports';

import App from './App';
import { useDiffComments } from './hooks/useDiffComments';
import { useViewedFiles } from './hooks/useViewedFiles';
import { useViewport } from './hooks/useViewport';
import { getFileElementId } from './utils/domUtils';

// Mock the useViewport hook
vi.mock('./hooks/useViewport', () => ({
  useViewport: vi.fn(() => ({ isMobile: false, isDesktop: true })),
}));

// Mock the useDiffComments hook
vi.mock('./hooks/useDiffComments', () => ({
  useDiffComments: vi.fn(() => ({
    hasLoadedComments: true,
    comments: [],
    threads: mockComments,
    decisions: mockDecisions,
    replaceThreads: mockReplaceThreads,
    mergeDecisions: mockMergeDecisions,
    addComment: vi.fn(),
    addThread: vi.fn(),
    removeComment: vi.fn(),
    removeThread: vi.fn(),
    removeMessage: vi.fn(),
    replyToThread: vi.fn(),
    updateComment: vi.fn(),
    updateMessage: vi.fn(),
    clearAllComments: mockClearAllComments,
    applyCommentImports: mockApplyCommentImports,
    generatePrompt: vi.fn(),
    generateAllCommentsPrompt: mockGenerateAllCommentsPrompt,
  })),
}));

// Mock the useViewedFiles hook
const mockClearViewedFiles = vi.fn();
const mockToggleFileViewed = vi.fn();
let mockViewedFiles = new Set<string>();
let mockHasLoadedInitialViewedFiles = true;
vi.mock('./hooks/useViewedFiles', () => ({
  useViewedFiles: vi.fn(() => ({
    viewedFiles: mockViewedFiles,
    changedSinceViewedFiles: new Set<string>(),
    hasLoadedInitialViewedFiles: mockHasLoadedInitialViewedFiles,
    toggleFileViewed: mockToggleFileViewed,
    isFileContentChanged: vi.fn(),
    getViewedFileRecord: vi.fn(),
    clearViewedFiles: mockClearViewedFiles,
  })),
}));

const mockWatchState: ClientWatchState = {
  isWatchEnabled: true,
  diffMode: DiffMode.DEFAULT,
  shouldReload: false,
  isReloading: false,
  lastChangeTime: null,
  lastChangeType: null,
  connectionStatus: 'connected',
};

vi.mock('./hooks/useFileWatch', () => ({
  useFileWatch: vi.fn((onReload?: () => Promise<void>) => ({
    shouldReload: mockWatchState.shouldReload,
    isConnected: true,
    error: null,
    reload: vi.fn(async () => {
      if (onReload) {
        await onReload();
      }
      mockWatchState.shouldReload = false;
      mockWatchState.lastChangeType = null;
    }),
    watchState: mockWatchState,
  })),
}));

// Mock navigator.sendBeacon
Object.defineProperty(navigator, 'sendBeacon', {
  writable: true,
  value: vi.fn(),
});

// Mock window.confirm
const mockConfirm = vi.fn();
Object.defineProperty(window, 'confirm', {
  writable: true,
  value: mockConfirm,
});

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  url: string;

  static clearInstances() {
    MockEventSource.instances = [];
  }
}
Object.defineProperty(window, 'EventSource', {
  writable: true,
  value: MockEventSource,
});

let mockComments: DiffCommentThread[] = [];
let mockDecisions: ReviewDecision[] = [];
const mockReplaceThreads = vi.fn();
const mockMergeDecisions = vi.fn();
const mockClearAllComments = vi.fn();
const mockApplyCommentImports = vi.fn(() => []);
const mockGenerateAllCommentsPrompt = vi.fn(() => 'formatted prompt');

function createMockThread({
  id,
  filePath,
  line,
  body,
  author = 'User',
}: {
  id: string;
  filePath: string;
  line: number;
  body: string;
  author?: string;
}): DiffCommentThread {
  const timestamp = '2024-01-01T00:00:00.000Z';
  return {
    id,
    filePath,
    createdAt: timestamp,
    updatedAt: timestamp,
    position: { side: 'new', line },
    messages: [
      {
        id,
        body,
        author,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

// Helper to render App with HotkeysProvider
const renderApp = () => {
  return render(
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <App />
    </HotkeysProvider>,
  );
};

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllEnvs();
  MockEventSource.clearInstances();
  mockViewedFiles = new Set<string>();
  mockHasLoadedInitialViewedFiles = true;
  mockReplaceThreads.mockReset();
  mockGenerateAllCommentsPrompt.mockClear();
});

const mockDiffResponse: DiffResponse = {
  commit: 'abc123',
  baseCommitish: 'HEAD^',
  targetCommitish: 'HEAD',
  requestedBaseCommitish: 'HEAD^',
  requestedTargetCommitish: 'HEAD',
  files: [
    {
      path: 'test.ts',
      status: 'modified',
      additions: 5,
      deletions: 2,
      chunks: [],
    },
  ],
  ignoreWhitespace: false,
  isEmpty: false,
};

const pinnedDiffResponse: DiffResponse = {
  ...mockDiffResponse,
  baseCommitish: 'abc1234^',
  targetCommitish: 'abc1234',
  requestedBaseCommitish: 'abc1234^',
  requestedTargetCommitish: 'abc1234',
};

describe('App Component - Clear Comments Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockDecisions = [];
    mockApplyCommentImports.mockReset();
    mockApplyCommentImports.mockReturnValue([]);
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
  });

  describe('Copy All Prompt Button', () => {
    it('should generate Copy All Prompt with requested and resolved diff context', async () => {
      mockComments = [
        createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'Test comment' }),
      ];
      mockFetch({
        ...mockDiffResponse,
        baseCommitish: 'abcdef1',
        targetCommitish: '1234567',
        requestedBaseCommitish: 'main',
        requestedTargetCommitish: 'feature/docs-update',
        requestedBaseMode: 'merge-base',
      });

      renderApp();

      fireEvent.click(await screen.findByText(/Copy All Prompt/));

      await waitFor(() => {
        expect(mockGenerateAllCommentsPrompt).toHaveBeenCalledWith(
          {
            requestedBaseCommitish: 'main',
            requestedTargetCommitish: 'feature/docs-update',
            baseMode: 'merge-base',
            resolvedBaseCommitish: 'abcdef1',
            resolvedTargetCommitish: '1234567',
          },
          mockComments,
        );
      });
    });

    it('should leave settled threads out and copy only the open ones', async () => {
      mockComments = [
        createMockThread({ id: 'open', filePath: 'test.ts', line: 10, body: 'Still open' }),
        createMockThread({ id: 'approved', filePath: 'test.ts', line: 20, body: 'Approved' }),
      ];
      mockDecisions = [
        { threadId: 'approved', kind: 'approved', fixupSha: 'aaaa', at: '2026-01-01T00:00:00Z' },
      ];

      renderApp();

      fireEvent.click(await screen.findByText('Copy All Prompt (1)'));

      await waitFor(() => {
        expect(mockGenerateAllCommentsPrompt).toHaveBeenCalledWith(expect.anything(), [
          mockComments[0],
        ]);
      });
    });

    it('should say there is nothing open and write nothing when every thread is settled', async () => {
      mockComments = [
        createMockThread({ id: 'approved', filePath: 'test.ts', line: 20, body: 'Approved' }),
      ];
      mockDecisions = [
        { threadId: 'approved', kind: 'approved', fixupSha: 'aaaa', at: '2026-01-01T00:00:00Z' },
      ];
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      renderApp();

      fireEvent.click(await screen.findByText(/Copy All Prompt/));

      expect(await screen.findByText('No open comments')).toBeInTheDocument();
      expect(mockGenerateAllCommentsPrompt).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    });

    it('should show resolved threads again once none are left to hide', async () => {
      mockComments = [
        createMockThread({ id: 'settled', filePath: 'test.ts', line: 10, body: 'Settled' }),
      ];
      const at = (minute: number) => `2026-01-01T00:0${minute}:00Z`;
      const resolved = (minute: number): ReviewDecision => ({
        threadId: 'settled',
        kind: 'resolved',
        fixupSha: '',
        at: at(minute),
      });
      const reopened = (minute: number): ReviewDecision => ({
        threadId: 'settled',
        kind: 'unresolved',
        fixupSha: '',
        at: at(minute),
      });
      const showResolved = () => screen.queryByRole('checkbox', { name: '해결된 지적 보기' });
      mockDecisions = [resolved(0)];

      const { rerender } = renderApp();
      fireEvent.click(await screen.findByRole('checkbox', { name: '해결된 지적 보기' }));
      expect(showResolved()).toHaveAttribute('aria-checked', 'false');

      const app = () => (
        <HotkeysProvider initiallyActiveScopes={['navigation']}>
          <App />
        </HotkeysProvider>
      );
      mockDecisions = [resolved(0), reopened(1)];
      rerender(app());
      expect(showResolved()).not.toBeInTheDocument();

      mockDecisions = [reopened(1), resolved(2)];
      rerender(app());
      expect(showResolved()).toHaveAttribute('aria-checked', 'true');
    });

    it('should not read fixups for a review that follows HEAD', async () => {
      mockComments = [
        createMockThread({ id: 'plain', filePath: 'test.ts', line: 10, body: 'Plain review' }),
      ];

      renderApp();

      await screen.findByText('Copy All Prompt (1)');
      expect(
        vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).startsWith('/api/fixups')),
      ).toBe(false);
    });

    it('should not copy before the fixup list says which threads are answered', async () => {
      mockComments = [
        createMockThread({ id: 'answered', filePath: 'test.ts', line: 10, body: 'Answered' }),
      ];
      vi.mocked(global.fetch).mockImplementation((input) => {
        if (String(input).startsWith('/api/fixups')) return new Promise(() => {});
        if (String(input) === '/api/revisions') {
          return Promise.resolve({ ok: true, json: async () => null } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => pinnedDiffResponse,
          blob: async () => ({ size: 1024 }),
        } as Response);
      });

      renderApp();

      const button = await screen.findByText('Checking fixups…');
      fireEvent.click(button);

      expect(mockGenerateAllCommentsPrompt).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup All Prompt Button', () => {
    it('should not show delete button when no comments exist', async () => {
      mockComments = [];

      renderApp();

      await waitFor(() => {
        // Cleanup All Prompt should not be visible without comments (dropdown doesn't exist)
        expect(screen.queryByText('Copy All Prompt')).not.toBeInTheDocument();
        expect(screen.queryByText('Cleanup All Prompt')).not.toBeInTheDocument();
      });
    });

    it('should show delete button when comments exist', async () => {
      mockComments = [
        createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'Test comment' }),
      ];

      renderApp();

      await waitFor(() => {
        // Find and click the dropdown toggle button (chevron)
        const dropdownToggle = screen.getByTitle('More options');
        fireEvent.click(dropdownToggle);
      });

      await waitFor(() => {
        expect(screen.getByText('Cleanup All Prompt')).toBeInTheDocument();
      });
    });

    it('should call clearAllComments immediately when delete button is clicked', async () => {
      mockComments = [
        createMockThread({ id: '1', filePath: 'test.ts', line: 10, body: 'Comment 1' }),
        createMockThread({ id: '2', filePath: 'test.ts', line: 20, body: 'Comment 2' }),
      ];

      renderApp();

      await waitFor(() => {
        // First, open the dropdown
        const dropdownToggle = screen.getByTitle('More options');
        fireEvent.click(dropdownToggle);
      });

      await waitFor(() => {
        const deleteButton = screen.getByText('Cleanup All Prompt');
        fireEvent.click(deleteButton);
      });

      expect(mockClearAllComments).toHaveBeenCalled();
    });
  });

  describe('Clean flag on Startup', () => {
    it('should clear existing comments when clearComments flag is true in response', async () => {
      const responseWithClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: true,
      };

      mockFetch(responseWithClearFlag);

      renderApp();

      await waitFor(() => {
        expect(mockClearAllComments).toHaveBeenCalledWith({
          resetAppliedCommentImportIds: true,
        });
      });
    });

    it('should clear viewed files when clearComments flag is true in response', async () => {
      const responseWithClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: true,
      };

      mockFetch(responseWithClearFlag);

      renderApp();

      await waitFor(() => {
        expect(mockClearViewedFiles).toHaveBeenCalled();
      });
    });

    it('should not clear comments when clearComments flag is false', async () => {
      const responseWithoutClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: false,
      };

      mockFetch(responseWithoutClearFlag);

      renderApp();

      await waitFor(() => {
        expect(mockClearAllComments).not.toHaveBeenCalled();
      });
    });

    it('should not clear comments when clearComments flag is undefined', async () => {
      const responseWithoutFlag: DiffResponse = {
        ...mockDiffResponse,
        // clearComments is undefined
      };

      mockFetch(responseWithoutFlag);

      renderApp();

      await waitFor(() => {
        expect(mockClearAllComments).not.toHaveBeenCalled();
      });
    });

    it('should log message when clearing comments via CLI flag', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const responseWithClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: true,
      };

      mockFetch(responseWithClearFlag);

      renderApp();

      await waitFor(() => {
        expect(consoleLogSpy).toHaveBeenCalledWith(
          '✅ All existing comments and viewed files cleared as requested via --clean flag',
        );
      });

      consoleLogSpy.mockRestore();
    });

    it('hydrates comments from the server comment session on startup', async () => {
      const serverThreads = [
        createMockThread({
          id: 'imported-thread',
          filePath: 'test.ts',
          line: 10,
          body: 'Imported comment',
        }),
      ];

      vi.mocked(global.fetch).mockImplementation((input) => {
        const url = String(input);

        if (url.startsWith('/api/comments-json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ threads: serverThreads }),
          } as Response);
        }

        if (url.startsWith('/api/comments')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true }),
          } as Response);
        }

        if (url === '/api/revisions') {
          return Promise.resolve({
            ok: true,
            json: async () => null,
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => mockDiffResponse,
          blob: async () => ({ size: 1024 }),
        } as Response);
      });

      renderApp();

      await waitFor(() => {
        expect(mockReplaceThreads).toHaveBeenCalledWith(serverThreads);
      });

      expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
        '/api/comments-json?base=HEAD%5E&target=HEAD',
      );
    });

    it('pushes locally recorded decisions to a server session that has none', async () => {
      const thread = createMockThread({
        id: 'thread-1',
        filePath: 'test.ts',
        line: 10,
        body: 'Local comment',
      });
      mockComments = [thread];
      mockDecisions = [
        { threadId: 'thread-1', kind: 'rejected', fixupSha: 'aaaa', at: '2026-01-01T00:00:00Z' },
      ];

      vi.mocked(global.fetch).mockImplementation((input) => {
        const url = String(input);

        if (url.startsWith('/api/comments-json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ threads: [thread], decisions: [] }),
          } as Response);
        }

        if (url.startsWith('/api/comments')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true }),
          } as Response);
        }

        if (url === '/api/revisions') {
          return Promise.resolve({
            ok: true,
            json: async () => null,
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => mockDiffResponse,
          blob: async () => ({ size: 1024 }),
        } as Response);
      });

      renderApp();

      await waitFor(() => {
        const posts = vi
          .mocked(global.fetch)
          .mock.calls.filter(([url]) => String(url).startsWith('/api/comments?'));
        const [, request] = posts[0] as [string, RequestInit];
        expect(JSON.parse(String(request.body)).decisions).toEqual(mockDecisions);
      });
    });

    it('preserves server-provided comments after clearing local comments on startup', async () => {
      mockComments = [
        createMockThread({
          id: 'stale-local-thread',
          filePath: 'test.ts',
          line: 5,
          body: 'Stale local comment',
        }),
      ];
      const serverThreads = [
        createMockThread({
          id: 'imported-thread',
          filePath: 'test.ts',
          line: 10,
          body: 'Imported comment',
        }),
      ];
      const responseWithClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: true,
      };

      vi.mocked(global.fetch).mockImplementation((input) => {
        const url = String(input);

        if (url.startsWith('/api/comments-json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ threads: serverThreads }),
          } as Response);
        }

        if (url.startsWith('/api/comments')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true }),
          } as Response);
        }

        if (url === '/api/revisions') {
          return Promise.resolve({
            ok: true,
            json: async () => null,
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => responseWithClearFlag,
          blob: async () => ({ size: 1024 }),
        } as Response);
      });

      renderApp();

      await waitFor(() => {
        expect(mockClearAllComments).toHaveBeenCalledWith({
          resetAppliedCommentImportIds: true,
        });
      });

      await waitFor(() => {
        expect(mockReplaceThreads).toHaveBeenCalledWith(serverThreads);
      });

      expect(mockReplaceThreads).not.toHaveBeenCalledWith([...serverThreads, ...mockComments]);
    });
  });
});

describe('App Component - Heartbeat Connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
  });

  it('uses the direct API url for heartbeat when configured in development', async () => {
    vi.stubEnv('VITE_DIFIT_API_URL', 'http://localhost:4969');

    renderApp();

    await waitFor(() => {
      expect(MockEventSource.instances[0]?.url).toBe('http://localhost:4969/api/heartbeat');
    });
  });
});

describe('App Component - Initial file collapsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
    mockViewedFiles = new Set<string>();
    mockHasLoadedInitialViewedFiles = false;
  });

  it('collapses initially viewed files after viewed state finishes loading', async () => {
    const view = renderApp();

    await waitFor(() => {
      expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();
    });

    expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();

    act(() => {
      mockViewedFiles = new Set(['test.ts']);
      mockHasLoadedInitialViewedFiles = true;
      view.rerender(
        <HotkeysProvider initiallyActiveScopes={['navigation']}>
          <App />
        </HotkeysProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle('Expand file (Alt+Click to expand all)')).toBeInTheDocument();
    });
  });
});

describe('App Component - Comment sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
  });

  it('syncs an empty comment list after the last comment is resolved', async () => {
    mockComments = [
      createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'Test comment' }),
    ];

    const mockGlobalFetch = vi.mocked(global.fetch);
    const { rerender } = renderApp();

    await waitFor(() => {
      const commentCalls = mockGlobalFetch.mock.calls.filter(([url]) =>
        String(url).startsWith('/api/comments?'),
      );
      expect(commentCalls).toHaveLength(1);

      const [url, request] = commentCalls[0] as [string, RequestInit];
      expect(url).toBe('/api/comments?base=HEAD%5E&target=HEAD');
      expect(request.method).toBe('POST');
      expect(JSON.parse(String(request.body))).toEqual({
        threads: [
          expect.objectContaining({
            id: 'test-1',
            filePath: 'test.ts',
            position: { side: 'new', line: 10 },
            messages: [
              expect.objectContaining({
                id: 'test-1',
                body: 'Test comment',
                author: 'User',
              }),
            ],
          }),
        ],
        decisions: [],
      });
    });

    mockComments = [];
    rerender(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <App />
      </HotkeysProvider>,
    );

    await waitFor(() => {
      const commentCalls = mockGlobalFetch.mock.calls.filter(([url]) =>
        String(url).startsWith('/api/comments?'),
      );
      expect(commentCalls).toHaveLength(2);

      const [url, request] = commentCalls[1] as [string, RequestInit];
      expect(url).toBe('/api/comments?base=HEAD%5E&target=HEAD');
      expect(request.method).toBe('POST');
      expect(JSON.parse(String(request.body))).toEqual({ threads: [], decisions: [] });
    });
  });

  it('sends an empty comment list on unload when no comments remain', async () => {
    mockComments = [];
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    renderApp();

    await waitFor(() => {
      expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    const beforeUnloadHandler = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'beforeunload',
    )?.[1] as (() => void) | undefined;
    expect(beforeUnloadHandler).toBeDefined();
    beforeUnloadHandler?.();

    expect(navigator.sendBeacon).toHaveBeenCalledWith(
      '/api/comments?base=HEAD%5E&target=HEAD',
      JSON.stringify({ threads: [], decisions: [] }),
    );
    addEventListenerSpy.mockRestore();
  });

  it('shows author badges in the comments modal when the diff has multiple authors', async () => {
    mockComments = [
      createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'User comment' }),
      createMockThread({
        id: 'test-2',
        filePath: 'other.ts',
        line: 20,
        body: 'Reviewer comment',
        author: 'Reviewer',
      }),
    ];
    mockFetch({
      ...mockDiffResponse,
      files: [
        ...mockDiffResponse.files,
        {
          path: 'other.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          chunks: [],
        },
      ],
    });

    renderApp();

    fireEvent.click(await screen.findByTitle('More options'));
    fireEvent.click(await screen.findByText('View All Comments'));

    expect(await screen.findByText('User')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });

  it('shows author badges when the reviewer and an agent without a named author both comment', async () => {
    const agentThreads = mergeCommentImports(
      [],
      parseCommentImportValue(
        JSON.stringify({
          type: 'thread',
          filePath: 'test.ts',
          position: { side: 'new', line: 20 },
          body: 'Agent comment',
        }),
      ),
    ).threads;
    mockComments = [
      createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'User comment' }),
      ...agentThreads,
    ];
    mockFetch(mockDiffResponse);

    renderApp();

    fireEvent.click(await screen.findByTitle('More options'));
    fireEvent.click(await screen.findByText('View All Comments'));

    expect(await screen.findByText('User')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });
});

describe('App Component - Diff Mode Persistence', () => {
  it('initializes the selected view mode from localStorage', async () => {
    mockFetch(mockDiffResponse);
    window.localStorage.setItem('difit.diffViewMode', 'unified');

    renderApp();

    const unifiedButton = await screen.findByRole('button', { name: 'Unified' });

    await waitFor(() => {
      expect(unifiedButton).toHaveClass('bg-github-bg-primary');
    });
  });

  it('persists the selected view mode to localStorage', async () => {
    mockFetch(mockDiffResponse);

    renderApp();

    const unifiedButton = await screen.findByRole('button', { name: 'Unified' });
    fireEvent.click(unifiedButton);

    expect(window.localStorage.getItem('difit.diffViewMode')).toBe('unified');
  });

  it('keeps the selected view mode after triggering refresh', async () => {
    const mockGlobalFetch = vi.mocked(global.fetch);
    mockGlobalFetch.mockClear();
    mockComments = [];
    mockClearAllComments.mockReset();
    mockConfirm.mockReturnValue(false);
    mockWatchState.shouldReload = true;
    mockWatchState.lastChangeType = 'file';
    mockFetch(mockDiffResponse);

    renderApp();

    const unifiedButton = await screen.findByRole('button', { name: 'Unified' });
    fireEvent.click(unifiedButton);

    await waitFor(() => {
      expect(unifiedButton).toHaveClass('bg-github-bg-primary');
    });

    const refreshButton = await screen.findByRole('button', { name: 'Refresh' });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      const diffCalls = mockGlobalFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.startsWith('/api/diff'),
      );
      expect(diffCalls).toHaveLength(2);
    });

    await waitFor(() => {
      expect(unifiedButton).toHaveClass('bg-github-bg-primary');
    });
    mockWatchState.shouldReload = false;
    mockWatchState.lastChangeType = null;
  });
});

describe('App Component - Merge-base selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('clears the resolved base revision after switching to a merge-base quick diff', async () => {
    const initialDiffResponse: DiffResponse = {
      ...mockDiffResponse,
      baseCommitish: '88aabb0',
      targetCommitish: '.',
      requestedBaseCommitish: 'HEAD',
      requestedTargetCommitish: '.',
    };
    const mergeBaseDiffResponse: DiffResponse = {
      ...mockDiffResponse,
      baseCommitish: '1122334',
      targetCommitish: '.',
      requestedBaseCommitish: 'origin/main',
      requestedTargetCommitish: '.',
      requestedBaseMode: 'merge-base',
    };
    const revisionsResponse = {
      specialOptions: [{ value: '.', label: 'All Uncommitted Changes' }],
      branches: [],
      commits: [
        {
          hash: '88aabb0fffff1111222233334444555566667777',
          shortHash: '88aabb0',
          message: 'stale direct base',
        },
        {
          hash: '1122334fffff1111222233334444555566667777',
          shortHash: '1122334',
          message: 'merge base',
        },
      ],
      originDefaultBranch: 'origin/main',
    };

    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);

      if (url.includes('/api/revisions')) {
        return Promise.resolve({
          ok: true,
          json: async () => revisionsResponse,
        } as Response);
      }

      if (url.includes('/api/diff')) {
        const response =
          url.includes('base=origin%2Fmain') && url.includes('baseMode=merge-base')
            ? mergeBaseDiffResponse
            : initialDiffResponse;

        return Promise.resolve({
          ok: true,
          json: async () => response,
          blob: async () => ({ size: 1024 }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as Response);
    });

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'origin/main...Uncommitted (merge-base)' }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'Revision menu: origin/main...Uncommitted Changes (merge-base)',
        }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', {
        name: 'Revision menu: 88aabb0...Uncommitted Changes (merge-base)',
      }),
    ).not.toBeInTheDocument();
  });

  it('uses resolved revisions for persisted diff state identity', async () => {
    const response: DiffResponse = {
      ...mockDiffResponse,
      baseCommitish: '1234567',
      targetCommitish: '98664e1',
      requestedBaseCommitish: '98664e1^',
      requestedTargetCommitish: '98664e1',
    };

    mockFetch(response);

    renderApp();

    await waitFor(() => {
      expect(vi.mocked(useDiffComments)).toHaveBeenCalledWith(
        '1234567',
        '98664e1',
        'abc123',
        undefined,
        undefined,
        undefined,
      );
    });

    expect(vi.mocked(useViewedFiles)).toHaveBeenCalledWith(
      '1234567',
      '98664e1',
      'abc123',
      undefined,
      response.files,
      undefined,
      [],
      undefined,
    );
  });

  it('ignores stale resolvedBase from /api/revisions on initial merge-base load', async () => {
    const mergeBaseDiffResponse: DiffResponse = {
      ...mockDiffResponse,
      baseCommitish: '1122334',
      targetCommitish: '.',
      requestedBaseCommitish: 'origin/main',
      requestedTargetCommitish: '.',
      requestedBaseMode: 'merge-base',
    };
    const revisionsResponse = {
      specialOptions: [{ value: '.', label: 'All Uncommitted Changes' }],
      branches: [],
      commits: [
        {
          hash: '88aabb0fffff1111222233334444555566667777',
          shortHash: '88aabb0',
          message: 'stale direct base',
        },
      ],
      originDefaultBranch: 'origin/main',
      resolvedBase: '88aabb0',
      resolvedTarget: '1122334',
    };

    let resolveRevisions: (() => void) | null = null;

    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);

      if (url.includes('/api/revisions')) {
        return new Promise<Response>((resolve) => {
          resolveRevisions = () =>
            resolve({
              ok: true,
              json: async () => revisionsResponse,
            } as Response);
        });
      }

      if (url.includes('/api/diff')) {
        return Promise.resolve({
          ok: true,
          json: async () => mergeBaseDiffResponse,
          blob: async () => ({ size: 1024 }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as Response);
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Reviewing:')).toBeInTheDocument();
    });

    await act(async () => {
      resolveRevisions?.();
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'Revision menu: origin/main...Uncommitted Changes (merge-base)',
        }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', {
        name: 'Revision menu: 88aabb0...Uncommitted Changes (merge-base)',
      }),
    ).not.toBeInTheDocument();
  });
});

describe('App Component - Revision-aware refetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('keeps the selected revisions when refetching without explicit revision params', async () => {
    const diffResponse: DiffResponse = {
      ...mockDiffResponse,
      requestedBaseCommitish: 'HEAD^',
      requestedTargetCommitish: 'HEAD',
    };

    vi.mocked(global.fetch).mockImplementation((input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/revisions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            specialOptions: [],
            branches: [],
            commits: [
              {
                hash: 'abc1234',
                shortHash: 'abc1234',
                message: 'Test commit',
              },
            ],
          }),
        } as Response);
      }

      if (url.startsWith('/api/comments?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => diffResponse,
        blob: async () => ({ size: 1024 }),
      } as Response);
    });

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Previous commit' }));

    await waitFor(() => {
      const diffCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/diff'));
      expect(diffCalls).toHaveLength(2);
      expect(String(diffCalls[1]?.[0])).toContain('base=HEAD%5E%5E');
      expect(String(diffCalls[1]?.[0])).toContain('target=HEAD%5E');
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ignore Whitespace' }));

    await waitFor(() => {
      const diffCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/diff'));
      expect(diffCalls).toHaveLength(3);
      expect(String(diffCalls[2]?.[0])).toContain('base=HEAD%5E%5E');
      expect(String(diffCalls[2]?.[0])).toContain('target=HEAD%5E');
    });
  });
});

describe('App Component - Returning from the review a comment was made on', () => {
  const reviewAt = (commit: string): DiffResponse => ({
    ...mockDiffResponse,
    baseCommitish: `${commit}^`,
    targetCommitish: commit,
    requestedBaseCommitish: `${commit}^`,
    requestedTargetCommitish: commit,
    files: [
      {
        path: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        chunks: [
          {
            header: '@@ -1,1 +1,1 @@',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              { type: 'normal', content: 'const a = 1;', oldLineNumber: 1, newLineNumber: 1 },
            ],
          },
        ],
      },
    ],
  });

  const diffTargets = () =>
    vi
      .mocked(global.fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/diff'))
      .map((url) => new URLSearchParams(url.split('?')[1]).get('target'));

  const originalReviewEntry = {
    difitReviewTarget: { baseCommitish: 'abc1234^', targetCommitish: 'abc1234' },
  };
  let serverTarget = 'abc1234';

  const loadedBy = (type: string) =>
    vi
      .spyOn(performance, 'getEntriesByType')
      .mockReturnValue([{ type } as unknown as PerformanceEntry]);

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    serverTarget = 'abc1234';
    mockDecisions = [];
    mockComments = [
      {
        ...createMockThread({ id: 'old', filePath: 'test.ts', line: 1, body: 'Old remark' }),
        codeSnapshot: { content: 'const a = 0;', commit: 'def5678' },
      },
    ];
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/revisions') {
        return Promise.resolve({ ok: true, json: async () => null } as Response);
      }
      if (url.startsWith('/api/fixups')) {
        return Promise.resolve({ ok: true, json: async () => ({ fixups: [] }) } as Response);
      }
      const target = url.startsWith('/api/diff')
        ? new URLSearchParams(url.split('?')[1]).get('target')
        : null;
      return Promise.resolve({
        ok: true,
        json: async () => reviewAt(target ?? serverTarget),
        blob: async () => ({ size: 1024 }),
      } as Response);
    });
  });

  it('adds a browser history entry when jumping to the older review', async () => {
    renderApp();
    const lengthBefore = window.history.length;

    fireEvent.click(await screen.findByRole('button', { name: '이 지적을 달던 시점으로' }));

    await waitFor(() => expect(diffTargets()).toContain('def5678'));
    expect(window.history.length).toBe(lengthBefore + 1);
  });

  it('switches back to the original review on Back and forward again on Forward', async () => {
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: '이 지적을 달던 시점으로' }));
    await waitFor(() => expect(diffTargets().at(-1)).toBe('def5678'));

    act(() => window.history.back());
    await waitFor(() => expect(diffTargets().at(-1)).toBe('abc1234'));
    expect(diffTargets()).toEqual([null, 'def5678', 'abc1234']);
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.lastCall?.slice(0, 2)).toEqual([
        'abc1234^',
        'abc1234',
      ]),
    );

    act(() => window.history.forward());
    await waitFor(() => expect(diffTargets().at(-1)).toBe('def5678'));
  });

  it("shows the original review's chips again after Back without recording decisions", async () => {
    const oldThread = mockComments[0]!;
    const fixedThread: DiffCommentThread = {
      ...createMockThread({ id: 'fixed', filePath: 'test.ts', line: 1, body: 'Fixed remark' }),
      codeSnapshot: { content: 'const a = 1;', commit: 'abc1234' },
    };
    const storedByTarget: Record<
      string,
      Pick<ReturnType<typeof useDiffComments>, 'threads' | 'decisions'>
    > = {
      abc1234: {
        threads: [oldThread, fixedThread],
        decisions: [
          { threadId: 'fixed', kind: 'approved', fixupSha: 'aaaa', at: '2026-01-01T00:00:00Z' },
        ],
      },
      def5678: {
        threads: [oldThread],
        decisions: [
          { threadId: 'old', kind: 'rejected', fixupSha: 'bbbb', at: '2026-01-01T00:00:00Z' },
        ],
      },
    };
    const recordDecision = vi.fn();
    const undoApproval = vi.fn();
    const defaultComments = vi.mocked(useDiffComments).getMockImplementation()!;
    vi.mocked(useDiffComments).mockImplementation((...args) => ({
      ...defaultComments(...args),
      ...(storedByTarget[args[1] ?? ''] ?? { threads: [], decisions: [] }),
      recordDecision,
      undoApproval,
    }));
    const chips = () =>
      screen
        .queryAllByTestId('review-state-chip')
        .map((chip) => chip.textContent)
        .sort();

    try {
      renderApp();
      await waitFor(() => expect(chips()).toEqual(['수정 중', '승인됨']));

      fireEvent.click(await screen.findByRole('button', { name: '이 지적을 달던 시점으로' }));
      await waitFor(() => expect(chips()).toEqual(['다시 수정 중']));

      act(() => window.history.back());
      await waitFor(() => expect(chips()).toEqual(['수정 중', '승인됨']));
      expect(recordDecision).not.toHaveBeenCalled();
      expect(undoApproval).not.toHaveBeenCalled();
    } finally {
      vi.mocked(useDiffComments).mockImplementation(defaultComments);
    }
  });

  it('reopens the review the history entry recorded when Back loads the page afresh', async () => {
    serverTarget = 'def5678';
    window.history.replaceState(originalReviewEntry, '');
    loadedBy('back_forward');

    renderApp();

    await waitFor(() => expect(diffTargets()).toEqual(['abc1234']));
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.lastCall?.slice(0, 2)).toEqual([
        'abc1234^',
        'abc1234',
      ]),
    );
  });

  it('leaves the review to the server on a plain reload', async () => {
    serverTarget = 'def5678';
    window.history.replaceState(originalReviewEntry, '');
    loadedBy('reload');

    renderApp();

    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.lastCall?.slice(0, 2)).toEqual([
        'def5678^',
        'def5678',
      ]),
    );
    expect(diffTargets()).toEqual([null]);
  });
});

describe('App Component - Sidebar persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
    mockFetch(mockDiffResponse);
  });

  it('restores file tree open state from localStorage', async () => {
    window.localStorage.setItem('difit.sidebarOpen', 'false');

    renderApp();

    const toggleButton = await screen.findByRole('button', { name: /toggle file tree panel/i });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('persists file tree open state when toggled', async () => {
    renderApp();

    const toggleButton = await screen.findByRole('button', { name: /toggle file tree panel/i });

    fireEvent.click(toggleButton);
    await waitFor(() => {
      expect(window.localStorage.getItem('difit.sidebarOpen')).toBe('false');
    });

    fireEvent.click(toggleButton);
    await waitFor(() => {
      expect(window.localStorage.getItem('difit.sidebarOpen')).toBe('true');
    });
  });
});

describe('App Component - Mobile layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    vi.mocked(useViewport).mockReturnValue({ isMobile: true, isDesktop: false });
    mockFetch(mockDiffResponse);
  });

  afterEach(() => {
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
  });

  it('lists changed files as chips and keeps the file tree drawer closed on load', async () => {
    window.localStorage.setItem('difit.sidebarOpen', 'true');

    renderApp();

    const chips = await screen.findByRole('navigation', { name: 'Changed files' });
    expect(within(chips).getByRole('button', { name: 'test.ts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /toggle file tree panel/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('closes the drawer when a file is selected on mobile', async () => {
    renderApp();

    const toggleButton = await screen.findByRole('button', { name: /toggle file tree panel/i });
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');

    const fileTree = document.getElementById('file-tree-panel')!;
    fireEvent.click(within(fileTree).getByTitle('test.ts').closest('[data-file-row]')!);

    await waitFor(() => {
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('leaves the PC sidebar preference alone when the drawer is toggled on a phone', async () => {
    window.localStorage.setItem('difit.sidebarOpen', 'true');

    renderApp();

    const toggleButton = await screen.findByRole('button', { name: /toggle file tree panel/i });
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    });
    expect(window.localStorage.getItem('difit.sidebarOpen')).toBe('true');
  });

  it('shows no file chips on a PC', async () => {
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });

    renderApp();

    await screen.findByRole('button', { name: /toggle file tree panel/i });
    expect(screen.queryByRole('navigation', { name: 'Changed files' })).not.toBeInTheDocument();
  });
});

describe('App Component - Fixup review colors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('scopes the fixup review palette to a review pinned to a hash', async () => {
    mockFetch(pinnedDiffResponse);

    const { container } = renderApp();

    await screen.findByRole('button', { name: /toggle file tree panel/i });
    expect(container.querySelector('[data-fixup-review]')).not.toBeNull();
  });

  it('keeps the original palette for a review that follows HEAD', async () => {
    mockFetch(mockDiffResponse);

    const { container } = renderApp();

    await screen.findByRole('button', { name: /toggle file tree panel/i });
    expect(container.querySelector('[data-fixup-review]')).toBeNull();
  });
});

describe('App Component - Newer commits on the followed ref', () => {
  const reviewAt = (commit: string): DiffResponse => ({
    ...pinnedDiffResponse,
    baseCommitish: `${commit}^`,
    targetCommitish: commit,
    requestedBaseCommitish: `${commit}^`,
    requestedTargetCommitish: commit,
  });
  const reopenButton = () => screen.queryByRole('button', { name: /HEAD에 새 커밋 2개/ });

  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockDecisions = [];
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/revisions') {
        return Promise.resolve({ ok: true, json: async () => null } as Response);
      }
      if (url.startsWith('/api/fixups')) {
        const onOriginal = new URLSearchParams(url.split('?')[1]).get('target') === 'abc1234';
        return Promise.resolve({
          ok: true,
          json: async () => ({
            fixups: [],
            ...(onOriginal
              ? { newerTarget: { ref: 'HEAD', commit: 'fed9876', commitCount: 2 } }
              : {}),
          }),
        } as Response);
      }
      const target = url.startsWith('/api/diff')
        ? new URLSearchParams(url.split('?')[1]).get('target')
        : null;
      return Promise.resolve({
        ok: true,
        json: async () => reviewAt(target ?? 'abc1234'),
        blob: async () => ({ size: 1024 }),
      } as Response);
    });
  });

  it('reopens the review at the commit the followed ref moved to', async () => {
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /HEAD에 새 커밋 2개/ }));

    await waitFor(() =>
      expect(
        vi
          .mocked(global.fetch)
          .mock.calls.map(([url]) => String(url))
          .filter((url) => url.startsWith('/api/diff'))
          .map((url) => new URLSearchParams(url.split('?')[1]).get('base'))
          .at(-1),
      ).toBe('fed9876^'),
    );
    await waitFor(() => expect(reopenButton()).toBeNull());
  });
});

describe('App Component - Direct edit', () => {
  const editableReview: DiffResponse = {
    ...pinnedDiffResponse,
    directEditAvailable: true,
    files: [
      {
        path: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        chunks: [
          {
            header: '@@ -1,1 +1,2 @@',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: [
              { type: 'normal', content: 'const a = 1;', oldLineNumber: 1, newLineNumber: 1 },
              { type: 'add', content: '// says what a is', newLineNumber: 2 },
            ],
          },
        ],
      },
    ],
  };
  const editedThread = createMockThread({
    id: 'e1',
    filePath: 'test.ts',
    line: 2,
    body: '직접 고침',
    author: 'reviewer-edit',
  });
  const approval: ReviewDecision = {
    threadId: 'e1',
    kind: 'approved',
    fixupSha: 'f'.repeat(40),
    at: '2026-01-01T00:00:00Z',
  };

  function serve(editResponse: { status: number; body: unknown }) {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith('/api/direct-edit')) {
        return Promise.resolve({
          ok: editResponse.status === 200,
          status: editResponse.status,
          statusText: '',
          json: async () => editResponse.body,
        } as Response);
      }
      if (url.startsWith('/api/fixups')) {
        return Promise.resolve({ ok: true, json: async () => ({ fixups: [] }) } as Response);
      }
      if (url === '/api/revisions') {
        return Promise.resolve({ ok: true, json: async () => null } as Response);
      }
      if (url.startsWith('/api/blob/')) {
        const bytes = new TextEncoder().encode('const a = 1;\n// says what a is\n');
        return Promise.resolve({
          ok: true,
          text: async () => new TextDecoder().decode(bytes),
          arrayBuffer: async () => bytes.slice().buffer,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => editableReview,
        blob: async () => ({ size: 1024 }),
      } as Response);
    });
  }

  const callsTo = (prefix: string) =>
    vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).startsWith(prefix));

  async function hoverLineTwo() {
    const { container } = renderApp();
    const rows = await waitFor(() => {
      const found = container.querySelectorAll('[data-diff-line-row="true"]');
      expect(found).toHaveLength(2);
      return found;
    });
    fireEvent.mouseEnter(rows[1]!.children[2]!);
  }

  async function editLineTwo(text: string) {
    await hoverLineTwo();
    fireEvent.click(screen.getByRole('button', { name: '줄 직접 고치기' }));
    fireEvent.change(await screen.findByLabelText('고칠 코드'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockDecisions = [];
  });

  it('posts the edit as JSON and takes in the thread and approval the server made', async () => {
    serve({
      status: 200,
      body: {
        success: true,
        sha: approval.fixupSha,
        threadId: 'e1',
        version: 3,
        threads: [editedThread],
        decisions: [approval],
      },
    });

    await editLineTwo('');

    await waitFor(() => expect(mockMergeDecisions).toHaveBeenCalledWith([approval]));
    const [url, init] = callsTo('/api/direct-edit')[0]!;
    expect(String(url)).toBe('/api/direct-edit?base=abc1234%5E&target=abc1234');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      filePath: 'test.ts',
      startLine: 2,
      endLine: 2,
      original: ['// says what a is'],
      replacement: [''],
    });
    expect(mockReplaceThreads).toHaveBeenCalledWith([editedThread]);
    await waitFor(() => expect(callsTo('/api/fixups').length).toBeGreaterThan(1));
    expect(screen.queryByLabelText('고칠 코드')).not.toBeInTheDocument();
  });

  it('keeps the edit open and says why when the server refuses it', async () => {
    serve({
      status: 409,
      body: { error: 'Direct edit refused: commit-failed', reason: 'commit-failed', output: 'no' },
    });

    await editLineTwo('');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('fixup 커밋을 만들지 못했습니다.');
    expect(alert).toHaveTextContent('no');
    expect(mockMergeDecisions).not.toHaveBeenCalled();
    expect(screen.getByLabelText('고칠 코드')).toBeInTheDocument();
  });

  it('offers no edit for a review that follows HEAD', async () => {
    serve({ status: 200, body: {} });
    vi.mocked(global.fetch).mockImplementation((input) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(input).startsWith('/api/diff')
            ? { ...editableReview, ...mockDiffResponse, files: editableReview.files }
            : null,
      } as Response),
    );

    await hoverLineTwo();

    expect(screen.queryByRole('button', { name: 'Add a comment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '줄 직접 고치기' })).not.toBeInTheDocument();
  });
});

describe('App Component - File at the top of the diff', () => {
  const twoFileResponse: DiffResponse = {
    ...mockDiffResponse,
    files: ['first.ts', 'second.ts'].map((path) => ({
      path,
      status: 'modified',
      additions: 1,
      deletions: 0,
      chunks: [
        {
          header: '@@ -1,1 +1,2 @@',
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 2,
          lines: [
            { type: 'normal', content: 'const a = 1;', oldLineNumber: 1, newLineNumber: 1 },
            { type: 'add', content: 'const b = 2;', newLineNumber: 2 },
          ],
        },
      ],
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    mockFetch(twoFileResponse);
  });

  afterEach(() => {
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
  });

  function stubTop(element: HTMLElement, top: number) {
    element.getBoundingClientRect = () =>
      ({ top, bottom: top + 600, left: 0, right: 0, width: 0, height: 600 }) as DOMRect;
  }

  async function putCursorOnFirstFileThenScrollToSecond() {
    const user = userEvent.setup();
    renderApp();
    await screen.findAllByTitle('second.ts');

    await user.keyboard('j');

    const main = document.querySelector('main')!;
    const first = document.getElementById(getFileElementId('first.ts'))!;
    const second = document.getElementById(getFileElementId('second.ts'))!;
    stubTop(main, 0);
    main.scrollTop = 700;
    stubTop(first, -700);
    stubTop(second, -100);
    fireEvent.scroll(main);
  }

  it('marks the file at the top in the file list and leaves the cursor where it was', async () => {
    await putCursorOnFirstFileThenScrollToSecond();

    const fileTree = document.getElementById('file-tree-panel')!;
    const rowOf = (title: string) =>
      within(fileTree).getByTitle(title).closest<HTMLElement>('[data-file-row="true"]')!;
    await waitFor(() => {
      expect(rowOf('second.ts')).toHaveAttribute('data-scroll-visible', 'true');
    });
    expect(rowOf('second.ts')).not.toHaveAttribute('aria-current');
    expect(rowOf('first.ts')).toHaveAttribute('aria-current', 'true');
    expect(rowOf('first.ts')).not.toHaveAttribute('data-scroll-visible');
  });

  it('marks the file at the top among the phone chips the same way', async () => {
    vi.mocked(useViewport).mockReturnValue({ isMobile: true, isDesktop: false });

    await putCursorOnFirstFileThenScrollToSecond();

    const chips = screen.getByRole('navigation', { name: 'Changed files' });
    await waitFor(() => {
      expect(within(chips).getByTitle('second.ts')).toHaveAttribute('data-scroll-visible', 'true');
    });
    expect(within(chips).getByTitle('second.ts')).not.toHaveAttribute('aria-current');
    expect(within(chips).getByTitle('first.ts')).toHaveAttribute('aria-current', 'true');
  });
});

describe('App Component - Commits of the review', () => {
  const full = (short: string) => short.padEnd(40, '0');
  const COMMITS = [
    {
      sha: full('1111111'),
      shortSha: '1111111',
      parentSha: full('def4567'),
      subject: 'first step',
    },
    {
      sha: full('abc1234'),
      shortSha: 'abc1234',
      parentSha: full('1111111'),
      subject: 'second step',
    },
  ];
  const REVIEW = {
    selection: { baseCommitish: 'def4567', targetCommitish: 'abc1234' },
    requested: { baseCommitish: full('def4567'), targetCommitish: full('abc1234') },
    commits: COMMITS,
  };
  const file = {
    path: 'test.ts',
    status: 'modified' as const,
    additions: 1,
    deletions: 0,
    chunks: [
      {
        header: '@@ -1,1 +1,1 @@',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { type: 'normal' as const, content: 'const a = 1;', oldLineNumber: 1, newLineNumber: 1 },
        ],
      },
    ],
  };
  let review: DiffResponse['review'] = REVIEW;
  let firstStepLine = 'const a = 1;';
  const fileOf = (target: string | null) =>
    target === COMMITS[0]!.sha
      ? {
          ...file,
          chunks: file.chunks.map((chunk) => ({
            ...chunk,
            lines: chunk.lines.map((line) => ({ ...line, content: firstStepLine })),
          })),
        }
      : file;
  const THIRD = {
    sha: full('2222222'),
    shortSha: '2222222',
    parentSha: full('abc1234'),
    subject: 'third step',
  };
  const THREE_COMMITS = {
    selection: { baseCommitish: 'def4567', targetCommitish: '2222222' },
    requested: { baseCommitish: full('def4567'), targetCommitish: THIRD.sha },
    commits: [...COMMITS, THIRD],
  };
  let requested = REVIEW.requested;
  const viewOf = (base: string | null, target: string | null): DiffResponse => ({
    ...mockDiffResponse,
    baseCommitish: (base ?? requested.baseCommitish).slice(0, 7),
    targetCommitish: (target ?? requested.targetCommitish).slice(0, 7),
    requestedBaseCommitish: base ?? requested.baseCommitish,
    requestedTargetCommitish: target ?? requested.targetCommitish,
    files: [fileOf(target)],
    ...(review ? { review } : {}),
  });
  const pinnedThread = (line: string): DiffCommentThread => ({
    ...createMockThread({ id: 'c3', filePath: 'test.ts', line: 1, body: 'Pinned here' }),
    codeSnapshot: { content: line, commit: COMMITS[0]!.sha },
    view: { baseCommitish: COMMITS[0]!.parentSha, targetCommitish: COMMITS[0]!.sha },
    fixupTarget: COMMITS[0]!.sha,
  });
  const fixupsFor: { current: unknown[] } = { current: [] };
  let chosenFixupTarget: string | undefined;
  const firstRow = () =>
    waitFor(() => {
      const found = document.querySelector('[data-diff-line-row="true"]');
      expect(found).not.toBeNull();
      return found!;
    });
  const diffQueries = () =>
    vi
      .mocked(global.fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/diff'))
      .map((url) => {
        const params = new URLSearchParams(url.split('?')[1]);
        return [params.get('base'), params.get('target')];
      });
  const commitButton = (name: RegExp | string) =>
    within(
      within(screen.getByRole('region', { name: '리뷰 범위의 커밋' })).getByRole('list'),
    ).getByRole('button', { name });

  beforeEach(() => {
    vi.clearAllMocks();
    review = REVIEW;
    firstStepLine = 'const a = 1;';
    fixupsFor.current = [];
    chosenFixupTarget = undefined;
    requested = REVIEW.requested;
    mockDecisions = [];
    mockComments = [
      createMockThread({ id: 'c1', filePath: 'test.ts', line: 1, body: 'Look here' }),
    ];
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/revisions') {
        return Promise.resolve({ ok: true, json: async () => null } as Response);
      }
      if (url.startsWith('/api/fixups')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ fixups: fixupsFor.current }),
        } as Response);
      }
      if (url.startsWith('/api/fixup-target')) {
        return Promise.resolve({
          ok: chosenFixupTarget !== undefined,
          json: async () => ({ fixupTarget: chosenFixupTarget }),
        } as Response);
      }
      const params = new URLSearchParams(url.split('?')[1]);
      return Promise.resolve({
        ok: true,
        json: async () =>
          url.startsWith('/api/diff')
            ? viewOf(params.get('base'), params.get('target'))
            : { threads: [], decisions: [] },
        blob: async () => ({ size: 1024 }),
      } as Response);
    });
  });

  afterEach(() => {
    window.history.replaceState(null, '');
  });

  it('lists the commits of the review above the files', async () => {
    renderApp();

    expect(await screen.findByRole('region', { name: '리뷰 범위의 커밋' })).toBeInTheDocument();
    expect(commitButton('전체')).toHaveAttribute('aria-current', 'true');
    expect(commitButton(/1111111/)).toBeInTheDocument();
  });

  it('lists no commits for a review of one commit or one that is not pinned', async () => {
    review = { ...REVIEW, commits: COMMITS.slice(1) };
    const { unmount } = renderApp();
    await screen.findByText('Look here');
    expect(screen.queryByRole('region', { name: '리뷰 범위의 커밋' })).not.toBeInTheDocument();
    unmount();

    review = undefined;
    renderApp();
    await screen.findByText('Look here');
    expect(screen.queryByRole('region', { name: '리뷰 범위의 커밋' })).not.toBeInTheDocument();
  });

  it('shows one commit on a click and the whole review again on Back', async () => {
    renderApp();
    const lengthBefore = window.history.length;

    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/1111111/));

    await waitFor(() =>
      expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.parentSha, COMMITS[0]!.sha]),
    );
    expect(window.history.length).toBe(lengthBefore + 1);
    await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));

    act(() => window.history.back());
    await waitFor(() => expect(commitButton('전체')).toHaveAttribute('aria-current', 'true'));
    expect(diffQueries().at(-1)).toEqual([
      REVIEW.requested.baseCommitish,
      REVIEW.requested.targetCommitish,
    ]);
  });

  it('draws a comment from before commit views only on the whole review and its last commit', async () => {
    renderApp();
    await screen.findByText('Look here');

    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/1111111/));
    await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));

    expect(vi.mocked(useDiffComments).mock.lastCall?.slice(0, 2)).toEqual(['def4567', 'abc1234']);
    expect(screen.queryByText('Look here')).not.toBeInTheDocument();

    fireEvent.click(commitButton(/abc1234/));
    expect(await screen.findByText('Look here')).toBeInTheDocument();

    fireEvent.click(commitButton('전체'));
    expect(await screen.findByText('Look here')).toBeInTheDocument();
  });

  it('binds a comment made on one commit to that commit', async () => {
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/1111111/));
    await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));

    fireEvent.mouseEnter((await firstRow()).children[2]!);
    const addButton = screen.getByRole('button', { name: 'Add a comment' });
    fireEvent.mouseDown(addButton, { shiftKey: true });
    fireEvent.change(await screen.findByPlaceholderText(/comment/i), {
      target: { value: 'Fix this here' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(
        vi
          .mocked(useDiffComments)
          .mock.results.flatMap(({ value }) => vi.mocked(value.addThread).mock.calls),
      ).toEqual([
        [
          expect.objectContaining({
            filePath: 'test.ts',
            line: 1,
            body: 'Fix this here',
            binding: {
              view: { baseCommitish: COMMITS[0]!.parentSha, targetCommitish: COMMITS[0]!.sha },
              fixupTarget: COMMITS[0]!.sha,
              snapshotCommit: COMMITS[0]!.sha,
            },
          }),
        ],
      ]),
    );
  });

  const addCommentOnFirstLine = async (body: string) => {
    fireEvent.mouseEnter((await firstRow()).children[2]!);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Add a comment' }), { shiftKey: true });
    fireEvent.change(await screen.findByPlaceholderText(/comment/i), { target: { value: body } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  };
  const addedThreads = () =>
    vi
      .mocked(useDiffComments)
      .mock.results.flatMap(({ value }) => vi.mocked(value.addThread).mock.calls);
  const fixupTargetQueries = () =>
    vi
      .mocked(global.fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/fixup-target'))
      .map((url) => Object.fromEntries(new URLSearchParams(url.split('?')[1])));

  const showFirstTwoOfThree = async () => {
    review = THREE_COMMITS;
    requested = THREE_COMMITS.requested;
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/1111111/));
    await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));
    fireEvent.click(commitButton(/abc1234/), { shiftKey: true });
    await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));
  };

  it('binds a comment made on a run of commits to the run and the commit the server chose', async () => {
    chosenFixupTarget = COMMITS[0]!.sha;
    await showFirstTwoOfThree();

    await addCommentOnFirstLine('Fix this in the run');

    await waitFor(() =>
      expect(addedThreads()).toEqual([
        [
          expect.objectContaining({
            body: 'Fix this in the run',
            binding: {
              view: { baseCommitish: COMMITS[0]!.parentSha, targetCommitish: COMMITS[1]!.sha },
              fixupTarget: COMMITS[0]!.sha,
              snapshotCommit: COMMITS[1]!.sha,
            },
          }),
        ],
      ]),
    );
    expect(fixupTargetQueries()).toEqual([
      { base: 'def4567', target: 'abc1234', path: 'test.ts', start: '1', end: '1', side: 'new' },
    ]);
  });

  it('binds a comment made on a run to its last commit when the server cannot choose', async () => {
    await showFirstTwoOfThree();

    await addCommentOnFirstLine('Fix this in the run');

    await waitFor(() =>
      expect(addedThreads()).toEqual([
        [
          expect.objectContaining({
            binding: expect.objectContaining({ fixupTarget: COMMITS[1]!.sha }),
          }),
        ],
      ]),
    );
  });

  it('adds the comment through the thread list as it is once the server has answered', async () => {
    let answer: ((response: Response) => void) | undefined;
    const answered = vi.mocked(global.fetch).getMockImplementation()!;
    vi.mocked(global.fetch).mockImplementation((input, init) =>
      String(input).startsWith('/api/fixup-target')
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : answered(input, init),
    );
    const { rerender } = renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });

    await addCommentOnFirstLine('Fix this somewhere');
    await waitFor(() => expect(answer).toBeDefined());
    rerender(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <App />
      </HotkeysProvider>,
    );
    const rendersBeforeAnswer = vi.mocked(useDiffComments).mock.results.length;
    answer!({ ok: true, json: async () => ({ fixupTarget: COMMITS[0]!.sha }) } as Response);

    await waitFor(() => expect(addedThreads()).toHaveLength(1));
    const callers = vi
      .mocked(useDiffComments)
      .mock.results.map(({ value }, index) => [index, vi.mocked(value.addThread).mock.calls.length])
      .filter(([, calls]) => calls > 0)
      .map(([index]) => index);
    expect(callers).toEqual([expect.any(Number)]);
    expect(callers[0]).toBeGreaterThanOrEqual(rendersBeforeAnswer - 1);
  });

  it('binds only the chosen commit to a comment made on the whole review', async () => {
    chosenFixupTarget = COMMITS[0]!.sha;
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });

    await addCommentOnFirstLine('Fix this somewhere');

    await waitFor(() =>
      expect(addedThreads()).toEqual([
        [expect.objectContaining({ binding: { fixupTarget: COMMITS[0]!.sha } })],
      ]),
    );
  });

  it('draws a comment made on one commit there and leaves it off the other commit', async () => {
    mockComments = [pinnedThread('const a = 1;')];
    renderApp();
    expect(await screen.findByText('Pinned here')).toBeInTheDocument();
    expect(screen.queryByLabelText('Outdated comment')).not.toBeInTheDocument();

    fireEvent.click(commitButton(/abc1234/));
    await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));
    expect(screen.queryByText('Pinned here')).not.toBeInTheDocument();

    fireEvent.click(commitButton(/1111111/));
    expect(await screen.findByText('Pinned here')).toBeInTheDocument();
    expect(screen.queryByLabelText('Outdated comment')).not.toBeInTheDocument();
  });

  it('lists a comment the shown commit leaves off without marking it outdated', async () => {
    mockComments = [
      {
        ...createMockThread({ id: 'c2', filePath: 'other.ts', line: 1, body: 'Elsewhere' }),
        codeSnapshot: { content: 'const b = 2;', commit: 'abc1234' },
      },
    ];
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/1111111/));
    await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));

    await userEvent.keyboard('{Shift>}L{/Shift}');

    expect(await screen.findByText('Elsewhere')).toBeInTheDocument();
    expect(screen.queryByLabelText('Outdated comment')).not.toBeInTheDocument();
  });

  it('paints a run of commits shown on load and names its ends in the header', async () => {
    review = THREE_COMMITS;

    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });

    expect(commitButton('전체')).not.toHaveAttribute('aria-current');
    expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true');
    expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true');
    expect(commitButton(/2222222/)).not.toHaveAttribute('aria-current');
    expect(
      within(screen.getByRole('region', { name: '리뷰 범위의 커밋' })).getByRole('button', {
        expanded: true,
      }),
    ).toHaveTextContent('1111111~abc1234 (2개)');
  });

  describe('with three commits', () => {
    beforeEach(() => {
      review = THREE_COMMITS;
      requested = THREE_COMMITS.requested;
    });

    it('shows the run between two commits on a Shift+click from either end', async () => {
      renderApp();
      await screen.findByRole('region', { name: '리뷰 범위의 커밋' });

      fireEvent.click(commitButton(/1111111/));
      await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));
      fireEvent.click(commitButton(/abc1234/), { shiftKey: true });
      await waitFor(() =>
        expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.parentSha, COMMITS[1]!.sha]),
      );
      await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));
      expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true');

      fireEvent.click(commitButton(/2222222/));
      await waitFor(() => expect(commitButton(/1111111/)).not.toHaveAttribute('aria-current'));
      fireEvent.click(commitButton(/abc1234/), { shiftKey: true });
      await waitFor(() => expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.sha, THIRD.sha]));
    });

    it('shows the same run after dragging from one commit to another', async () => {
      renderApp();
      await screen.findByRole('region', { name: '리뷰 범위의 커밋' });

      fireEvent.mouseDown(commitButton(/abc1234/), { button: 0 });
      fireEvent.mouseEnter(commitButton(/1111111/));
      fireEvent.mouseUp(commitButton(/1111111/));

      await waitFor(() =>
        expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.parentSha, COMMITS[1]!.sha]),
      );
      await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));
      expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true');
    });

    it('shows the whole review for a run that covers every commit', async () => {
      renderApp();
      await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
      fireEvent.click(commitButton(/2222222/));
      await waitFor(() => expect(commitButton(/2222222/)).toHaveAttribute('aria-current', 'true'));

      fireEvent.click(commitButton(/1111111/), { shiftKey: true });

      await waitFor(() => expect(commitButton('전체')).toHaveAttribute('aria-current', 'true'));
      expect(diffQueries().at(-1)).toEqual([
        THREE_COMMITS.requested.baseCommitish,
        THREE_COMMITS.requested.targetCommitish,
      ]);
      expect(await screen.findByText('Look here')).toBeInTheDocument();
    });

    it('moves to the previous and next commit with the keys and from the whole review to the first and last', async () => {
      renderApp();
      await screen.findByRole('region', { name: '리뷰 범위의 커밋' });

      await userEvent.keyboard('{Shift>}>{/Shift}');
      await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));
      await userEvent.keyboard('{Shift>}>{/Shift}');
      await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));
      expect(diffQueries().at(-1)).toEqual([COMMITS[1]!.parentSha, COMMITS[1]!.sha]);
      await userEvent.keyboard('{Shift>}<{/Shift}');
      await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));

      fireEvent.click(commitButton('전체'));
      await waitFor(() => expect(commitButton('전체')).toHaveAttribute('aria-current', 'true'));
      await userEvent.keyboard('{Shift>}<{/Shift}');
      await waitFor(() => expect(commitButton(/2222222/)).toHaveAttribute('aria-current', 'true'));
      expect(diffQueries().at(-1)).toEqual([THIRD.parentSha, THIRD.sha]);
    });

    it('goes back from a run to the commit shown before on Back', async () => {
      renderApp();
      await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
      fireEvent.click(commitButton(/1111111/));
      await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));
      fireEvent.click(commitButton(/abc1234/), { shiftKey: true });
      await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));

      act(() => window.history.back());

      await waitFor(() => expect(commitButton(/abc1234/)).not.toHaveAttribute('aria-current'));
      expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true');
      expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.parentSha, COMMITS[0]!.sha]);
    });

    it('keeps the comments of the review while a run is shown, without drawing or taking any', async () => {
      renderApp();
      await screen.findByText('Look here');
      fireEvent.click(commitButton(/1111111/));
      await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));
      fireEvent.click(commitButton(/abc1234/), { shiftKey: true });
      await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));

      expect(vi.mocked(useDiffComments).mock.lastCall?.slice(0, 2)).toEqual(['def4567', '2222222']);
      expect(screen.queryByText('Look here')).not.toBeInTheDocument();
      const row = await waitFor(() => {
        const found = document.querySelector('[data-diff-line-row="true"]');
        expect(found).not.toBeNull();
        return found!;
      });
      fireEvent.mouseEnter(row);
      expect(screen.queryByRole('button', { name: 'Add a comment' })).not.toBeInTheDocument();
    });

    describe('on a phone', () => {
      const drawerButton = () => screen.getByRole('button', { name: '커밋 목록' });
      const longPress = async (name: RegExp) => {
        fireEvent.touchStart(commitButton(name), { touches: [{ clientX: 10, clientY: 10 }] });
        await act(() => new Promise((resolve) => setTimeout(resolve, 550)));
        fireEvent.touchEnd(commitButton(name), { changedTouches: [{ clientX: 10, clientY: 10 }] });
      };

      beforeEach(() => {
        vi.mocked(useViewport).mockReturnValue({ isMobile: true, isDesktop: false });
        vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
      });

      afterEach(() => {
        vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
        vi.mocked(document.elementFromPoint).mockRestore();
      });

      it('opens the commits in a drawer from the header and closes it once a commit is tapped', async () => {
        renderApp();
        await screen.findByText('Look here');
        expect(drawerButton()).toHaveAttribute('aria-expanded', 'false');
        expect(drawerButton()).toHaveTextContent('전체');

        fireEvent.click(drawerButton());
        expect(drawerButton()).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(commitButton(/abc1234/));

        await waitFor(() =>
          expect(diffQueries().at(-1)).toEqual([COMMITS[1]!.parentSha, COMMITS[1]!.sha]),
        );
        expect(drawerButton()).toHaveAttribute('aria-expanded', 'false');
        await waitFor(() => expect(drawerButton()).toHaveTextContent('abc1234'));
      });

      it('closes the drawer from outside it without changing what is shown', async () => {
        renderApp();
        await screen.findByText('Look here');
        const queries = diffQueries().length;

        fireEvent.click(drawerButton());
        fireEvent.click(screen.getByRole('button', { name: '커밋 목록 닫기' }));

        expect(drawerButton()).toHaveAttribute('aria-expanded', 'false');
        expect(diffQueries()).toHaveLength(queries);
      });

      it('shows the run between a long-pressed commit and the next one tapped', async () => {
        renderApp();
        await screen.findByText('Look here');
        fireEvent.click(drawerButton());
        const queries = diffQueries().length;

        await longPress(/1111111/);
        expect(screen.getByRole('status')).toHaveTextContent('범위 고르는 중');
        expect(diffQueries()).toHaveLength(queries);
        expect(drawerButton()).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(commitButton(/abc1234/));

        await waitFor(() =>
          expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.parentSha, COMMITS[1]!.sha]),
        );
        expect(drawerButton()).toHaveAttribute('aria-expanded', 'false');
        await waitFor(() =>
          expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'),
        );
        expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      });

      it('goes back to choosing as before on cancel', async () => {
        renderApp();
        await screen.findByText('Look here');
        fireEvent.click(drawerButton());
        fireEvent.click(commitButton(/abc1234/));
        await waitFor(() =>
          expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'),
        );
        fireEvent.click(drawerButton());
        const queries = diffQueries().length;

        await longPress(/2222222/);
        fireEvent.click(screen.getByRole('button', { name: '취소' }));

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(diffQueries()).toHaveLength(queries);
        expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true');
        fireEvent.click(commitButton(/1111111/));
        await waitFor(() =>
          expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.parentSha, COMMITS[0]!.sha]),
        );
      });

      it('stops choosing a run when the drawer is closed', async () => {
        renderApp();
        await screen.findByText('Look here');
        fireEvent.click(drawerButton());
        await longPress(/1111111/);

        fireEvent.click(screen.getByRole('button', { name: '커밋 목록 닫기' }));
        fireEvent.click(drawerButton());

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      });
    });
  });

  it('offers no commit drawer on a phone for a review of one commit', async () => {
    vi.mocked(useViewport).mockReturnValue({ isMobile: true, isDesktop: false });
    review = { ...REVIEW, commits: COMMITS.slice(1) };
    renderApp();
    await screen.findByText('Look here');

    expect(screen.queryByRole('button', { name: '커밋 목록' })).not.toBeInTheDocument();
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
  });

  it('goes back to the whole review to show a comment picked from the list', async () => {
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/1111111/));
    await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));

    await userEvent.keyboard('{Shift>}L{/Shift}');
    await screen.findByRole('button', { name: 'Close comments list' });
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(commitButton('전체')).toHaveAttribute('aria-current', 'true'));
    expect(diffQueries().at(-1)).toEqual([
      REVIEW.requested.baseCommitish,
      REVIEW.requested.targetCommitish,
    ]);
    expect(await screen.findByText('Look here')).toBeInTheDocument();
  });

  it('goes back to the whole review for a comment on a file the shown commit leaves alone', async () => {
    mockComments = [
      createMockThread({ id: 'c9', filePath: 'other.ts', line: 1, body: 'Elsewhere' }),
    ];
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/abc1234/));
    await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));

    await userEvent.keyboard('{Shift>}L{/Shift}');
    await screen.findByRole('button', { name: 'Close comments list' });
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(commitButton('전체')).toHaveAttribute('aria-current', 'true'));
    expect(diffQueries().at(-1)).toEqual([
      REVIEW.requested.baseCommitish,
      REVIEW.requested.targetCommitish,
    ]);
  });

  it('goes back to the whole review for a comment the shown commit cannot place', async () => {
    mockComments = [
      {
        ...createMockThread({ id: 'c8', filePath: 'test.ts', line: 1, body: 'Gone here' }),
        codeSnapshot: { content: 'const gone = 0;' },
      },
    ];
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/abc1234/));
    await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));

    await userEvent.keyboard('{Shift>}L{/Shift}');
    await screen.findByRole('button', { name: 'Close comments list' });
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(commitButton('전체')).toHaveAttribute('aria-current', 'true'));
  });

  it('stays on the shown commit to show a comment drawn there', async () => {
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/abc1234/));
    await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));
    const queriesBefore = diffQueries().length;

    await userEvent.keyboard('{Shift>}L{/Shift}');
    await screen.findByRole('button', { name: 'Close comments list' });
    await userEvent.keyboard('{Enter}');

    expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true');
    expect(diffQueries()).toHaveLength(queriesBefore);
  });

  it('names on the card the commit a fix for the comment goes into', async () => {
    mockComments = [pinnedThread('const a = 1;')];
    renderApp();
    await screen.findByText('Pinned here');

    const card = document.getElementById('comment-thread-c3')!;
    expect(within(card).getByText('1111111')).toHaveAttribute('title', 'first step');
  });

  it('takes a comment outdated on the whole review back to its commit, and Back returns', async () => {
    firstStepLine = 'const pinned = 0;';
    mockComments = [pinnedThread('const pinned = 0;')];
    renderApp();
    await screen.findByText('Pinned here');
    const lengthBefore = window.history.length;

    expect(screen.getByLabelText('Outdated comment')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '이 지적을 달던 시점으로' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '이 지적을 단 화면으로' }));

    await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));
    expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.parentSha, COMMITS[0]!.sha]);
    expect(window.history.length).toBe(lengthBefore + 1);
    await screen.findByText('Pinned here');
    expect(screen.queryByLabelText('Outdated comment')).not.toBeInTheDocument();

    act(() => window.history.back());
    await waitFor(() => expect(commitButton('전체')).toHaveAttribute('aria-current', 'true'));
    expect(await screen.findByLabelText('Outdated comment')).toBeInTheDocument();
  });

  it('shows the fixup for a comment made on one commit under it there, ready to approve', async () => {
    firstStepLine = 'const pinned = 0;';
    mockComments = [pinnedThread('const pinned = 0;')];
    fixupsFor.current = [
      {
        sha: 'f'.repeat(40),
        shortSha: 'fffffff',
        patchId: 'patch-1',
        subject: 'fixup! first step',
        threadIds: ['c3'],
        files: [{ path: 'test.ts', status: 'modified', chunks: file.chunks }],
      },
    ];
    const recordDecision = vi.fn();
    const defaultComments = vi.mocked(useDiffComments).getMockImplementation()!;
    vi.mocked(useDiffComments).mockImplementation((...args) => ({
      ...defaultComments(...args),
      recordDecision,
    }));

    try {
      renderApp();
      await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
      fireEvent.click(commitButton(/1111111/));
      await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));

      expect(await screen.findByTestId('fixup-overlay-card')).toHaveTextContent('fffffff');
      fireEvent.click(screen.getByRole('button', { name: '승인' }));
      expect(recordDecision).toHaveBeenCalledWith('c3', 'approved', 'f'.repeat(40), 'patch-1');
      expect(vi.mocked(useDiffComments).mock.lastCall?.slice(0, 2)).toEqual(['def4567', 'abc1234']);
    } finally {
      vi.mocked(useDiffComments).mockImplementation(defaultComments);
    }
  });

  it('opens the commit a comment was made on to show it from the list', async () => {
    mockComments = [pinnedThread('const a = 1;')];
    renderApp();
    await screen.findByRole('region', { name: '리뷰 범위의 커밋' });
    fireEvent.click(commitButton(/abc1234/));
    await waitFor(() => expect(commitButton(/abc1234/)).toHaveAttribute('aria-current', 'true'));
    expect(screen.queryByText('Pinned here')).not.toBeInTheDocument();

    await userEvent.keyboard('{Shift>}L{/Shift}');
    await screen.findByRole('button', { name: 'Close comments list' });
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(commitButton(/1111111/)).toHaveAttribute('aria-current', 'true'));
    expect(diffQueries().at(-1)).toEqual([COMMITS[0]!.parentSha, COMMITS[0]!.sha]);
  });
});
