import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

import { mockFetch } from '../../vitest.setup';
import type { DiffCommentThread, DiffResponse, ReviewDecision } from '../types/diff';
import type { ClientWatchState } from '../types/watch';
import { DiffMode } from '../types/watch';

import App from './App';
import { useDiffComments } from './hooks/useDiffComments';
import { useViewedFiles } from './hooks/useViewedFiles';
import { useViewport } from './hooks/useViewport';

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
    generateThreadPrompt: vi.fn(),
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

describe('App Component - Mobile sidebar auto-close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    vi.mocked(useViewport).mockReturnValue({ isMobile: true, isDesktop: false });
  });

  afterEach(() => {
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
  });

  it('closes the sidebar when a file is selected on mobile', async () => {
    mockFetch(mockDiffResponse);
    renderApp();

    // Sidebar toggle button
    const toggleButton = await screen.findByRole('button', { name: /toggle file tree panel/i });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');

    // Wait for file list to render, then click the file row
    const fileRow = await screen.findByTitle('test.ts');
    fireEvent.click(fileRow.closest('[data-file-row]')!);

    // Sidebar should now be closed on mobile
    await waitFor(() => {
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    });
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
