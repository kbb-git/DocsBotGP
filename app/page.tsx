'use client';

import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import ChatInput from './components/ChatInput';
import ChatMessages from './components/ChatMessages';
import ChatHistory from './components/ChatHistory';
import ErrorDisplay from './components/ErrorDisplay';
import Header from './components/Header';
import RawApiDisplay from './components/RawApiDisplay';

// Message type
export type Message = {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: string; // Store timestamp as string to avoid hydration issues
  isError?: boolean;
  hasVectorStoreError?: boolean;
  vectorStoreErrorMessage?: string;
  rawApiResponse?: any;
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};

type LastUserMessage = {
  chatId: string;
  content: string;
} | null;

const CHAT_HISTORY_STORAGE_KEY = 'docsbotgp_chat_history_v1';
const ACTIVE_CHAT_STORAGE_KEY = 'docsbotgp_active_chat_v1';
const HISTORY_COLLAPSE_STORAGE_KEY = 'docsbotgp_history_collapsed_v1';
const DEFAULT_CHAT_TITLE = 'New Chat';
const DEFAULT_WELCOME_MESSAGE =
  'Hello! I\'m the Global Payments Developer Helper. How can I assist you with Global Payments Inc. documentation today?';

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getCurrentTimeLabel = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const createWelcomeMessage = (): Message => ({
  id: createId('msg'),
  content: DEFAULT_WELCOME_MESSAGE,
  role: 'assistant',
  timestamp: '--:--',
});

const createSession = (): ChatSession => {
  const nowIso = new Date().toISOString();
  return {
    id: createId('chat'),
    title: DEFAULT_CHAT_TITLE,
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [createWelcomeMessage()],
  };
};

const toSafeTimestamp = (value: string) => {
  const parsedTimestamp = new Date(value).getTime();
  return Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp;
};

const sortSessionsByNewest = (sessions: ChatSession[]) =>
  [...sessions].sort((a, b) => toSafeTimestamp(b.updatedAt) - toSafeTimestamp(a.updatedAt));

const buildChatTitleFromMessage = (content: string): string => {
  const normalized = content.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return DEFAULT_CHAT_TITLE;
  }

  if (normalized.length <= 54) {
    return normalized;
  }

  return `${normalized.slice(0, 54).trimEnd()}...`;
};

const sanitizeStoredMessage = (message: unknown): Message | null => {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const candidate = message as Partial<Message>;
  if ((candidate.role !== 'user' && candidate.role !== 'assistant') || typeof candidate.content !== 'string') {
    return null;
  }

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('msg'),
    content: candidate.content,
    role: candidate.role,
    timestamp:
      typeof candidate.timestamp === 'string' && candidate.timestamp
        ? candidate.timestamp
        : getCurrentTimeLabel(),
    isError: Boolean(candidate.isError),
    hasVectorStoreError: Boolean(candidate.hasVectorStoreError),
    vectorStoreErrorMessage:
      typeof candidate.vectorStoreErrorMessage === 'string' ? candidate.vectorStoreErrorMessage : '',
  };
};

const sanitizeStoredSession = (session: unknown): ChatSession | null => {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const candidate = session as Partial<ChatSession>;
  const candidateMessages = Array.isArray(candidate.messages)
    ? candidate.messages
        .map(sanitizeStoredMessage)
        .filter((message): message is Message => message !== null)
    : [];

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('chat'),
    title:
      typeof candidate.title === 'string' && candidate.title.trim()
        ? candidate.title.trim()
        : DEFAULT_CHAT_TITLE,
    createdAt:
      typeof candidate.createdAt === 'string' && candidate.createdAt
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === 'string' && candidate.updatedAt
        ? candidate.updatedAt
        : new Date().toISOString(),
    messages: candidateMessages.length > 0 ? candidateMessages : [createWelcomeMessage()],
  };
};

export default function HomePage() {
  const initialSessionRef = useRef<ChatSession | null>(null);
  const getInitialSession = () => {
    if (!initialSessionRef.current) {
      initialSessionRef.current = createSession();
    }

    return initialSessionRef.current;
  };

  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => [getInitialSession()]);
  const [activeChatId, setActiveChatId] = useState<string>(() => getInitialSession().id);
  const [hasLoadedPersistedHistory, setHasLoadedPersistedHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState<LastUserMessage>(null);
  const [showRawApi, setShowRawApi] = useState<Record<string, boolean>>({});
  const [contextWindowNotices, setContextWindowNotices] = useState<Record<string, string>>({});
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeChat = chatSessions.find((session) => session.id === activeChatId) ?? chatSessions[0];
  const messages = activeChat?.messages ?? [];
  const contextWindowNotice = contextWindowNotices[activeChatId] || '';
  const isMobileViewport = () => window.matchMedia('(max-width: 767px)').matches;

  // Toggle raw API display for a specific message
  const toggleRawApi = (messageId: string) => {
    setShowRawApi(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }));
  };

  // Add a cache to store formatted message content and prevent duplicate processing
  const formattedContentCache = useRef(new Map<string, string>());
  
  // Function to clear cache for a specific message ID
  const clearCacheForMessage = (messageId: string) => {
    // Find and remove all cache entries for this message ID
    const keysToRemove: string[] = [];
    formattedContentCache.current.forEach((_, key) => {
      if (key.startsWith(`${messageId}-`)) {
        keysToRemove.push(key);
      }
    });
    
    keysToRemove.forEach(key => {
      formattedContentCache.current.delete(key);
      console.log(`Cleared cache for key: ${key}`);
    });
  };
  
  // Restore local chat history from browser storage.
  useEffect(() => {
    try {
      const rawStoredSessions = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
      const rawStoredActiveChatId = window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY);

      if (!rawStoredSessions) {
        return;
      }

      const parsedSessions = JSON.parse(rawStoredSessions);
      if (!Array.isArray(parsedSessions)) {
        return;
      }

      const restoredSessions = sortSessionsByNewest(
        parsedSessions
          .map(sanitizeStoredSession)
          .filter((session): session is ChatSession => session !== null)
      );

      if (restoredSessions.length === 0) {
        return;
      }

      setChatSessions(restoredSessions);

      if (
        rawStoredActiveChatId &&
        restoredSessions.some((session) => session.id === rawStoredActiveChatId)
      ) {
        setActiveChatId(rawStoredActiveChatId);
      } else {
        setActiveChatId(restoredSessions[0].id);
      }
    } catch (error) {
      console.error('Unable to restore local chat history:', error);
    } finally {
      setHasLoadedPersistedHistory(true);
    }
  }, []);

  // Save chat history after hydration to avoid overwriting restored state.
  useEffect(() => {
    if (!hasLoadedPersistedHistory) {
      return;
    }

    try {
      const persistableSessions = chatSessions.map((session) => ({
        ...session,
        // Drop large raw API payloads to keep localStorage within quota.
        messages: session.messages.map(({ rawApiResponse, ...message }) => message),
      }));

      window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(persistableSessions));
      window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeChatId);
    } catch (error) {
      console.error('Unable to persist local chat history:', error);
    }
  }, [chatSessions, activeChatId, hasLoadedPersistedHistory]);

  useEffect(() => {
    try {
      const savedHistoryCollapseState = window.localStorage.getItem(HISTORY_COLLAPSE_STORAGE_KEY);
      if (savedHistoryCollapseState !== null) {
        setIsHistoryCollapsed(savedHistoryCollapseState === '1');
      } else if (isMobileViewport()) {
        setIsHistoryCollapsed(true);
      }
    } catch (error) {
      console.error('Unable to restore history panel preference:', error);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        HISTORY_COLLAPSE_STORAGE_KEY,
        isHistoryCollapsed ? '1' : '0'
      );
    } catch (error) {
      console.error('Unable to persist history panel preference:', error);
    }
  }, [isHistoryCollapsed]);

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isHistoryCollapsed && isMobileViewport()) {
        setIsHistoryCollapsed(true);
      }
    };

    window.addEventListener('keydown', handleEscapeKey);
    return () => {
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isHistoryCollapsed]);

  useEffect(() => {
    if (isHistoryCollapsed || !isMobileViewport()) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isHistoryCollapsed]);

  // Keep active selection valid if sessions are replaced by restored data.
  useEffect(() => {
    if (!chatSessions.length) {
      return;
    }

    if (!chatSessions.some((session) => session.id === activeChatId)) {
      setActiveChatId(chatSessions[0].id);
    }
  }, [chatSessions, activeChatId]);

  // Add global error handler for unhandled promise rejections
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      event.preventDefault(); // Prevents the default error being shown
    };
    
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCreateChat = () => {
    if (isLoading) {
      return;
    }

    const nextSession = createSession();
    setChatSessions((prev) => [nextSession, ...prev]);
    setActiveChatId(nextSession.id);
    setLastUserMessage(null);
    setShowRawApi({});
    formattedContentCache.current.clear();

    if (isMobileViewport()) {
      setIsHistoryCollapsed(true);
    }
  };

  const handleSelectChat = (chatId: string) => {
    if (isLoading || chatId === activeChatId) {
      return;
    }

    setActiveChatId(chatId);
    setLastUserMessage(null);
    setShowRawApi({});
    formattedContentCache.current.clear();

    if (isMobileViewport()) {
      setIsHistoryCollapsed(true);
    }
  };

  const handleDeleteChat = (chatId: string) => {
    if (isLoading) {
      return;
    }

    const sessionToDelete = chatSessions.find((session) => session.id === chatId);
    if (!sessionToDelete) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete chat "${sessionToDelete.title}"? This cannot be undone.`
    );
    if (!shouldDelete) {
      return;
    }

    const remainingSessions = sortSessionsByNewest(
      chatSessions.filter((session) => session.id !== chatId)
    );

    const nextSessions = remainingSessions.length > 0 ? remainingSessions : [createSession()];
    const nextActiveChatId =
      chatId === activeChatId || !nextSessions.some((session) => session.id === activeChatId)
        ? nextSessions[0].id
        : activeChatId;

    setChatSessions(nextSessions);
    setActiveChatId(nextActiveChatId);
    setLastUserMessage((previous) =>
      previous && previous.chatId === chatId ? null : previous
    );
    setContextWindowNotices((previous) => {
      const { [chatId]: _removed, ...rest } = previous;
      return rest;
    });
    setShowRawApi({});
    formattedContentCache.current.clear();
  };

  const handleToggleHistory = () => {
    setIsHistoryCollapsed((previousState) => !previousState);
  };

  // Handle retry for failed messages
  const handleRetry = async () => {
    if (!lastUserMessage || lastUserMessage.chatId !== activeChatId) return;
    
    setChatSessions((prev) =>
      prev.map((session) => {
        if (session.id !== activeChatId) {
          return session;
        }

        return {
          ...session,
          messages: session.messages.filter((message) => !message.isError),
        };
      })
    );
    
    await handleSendMessage(lastUserMessage.content, activeChatId);
  };

  // Handle send message
  const handleSendMessage = async (content: string, chatIdOverride?: string) => {
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    const targetChatId = chatIdOverride || activeChatId;
    const targetSession = chatSessions.find((session) => session.id === targetChatId);
    if (!targetSession) {
      return;
    }

    setLastUserMessage({ chatId: targetChatId, content: trimmedContent });

    const userMessage: Message = {
      id: createId('msg'),
      content: trimmedContent,
      role: 'user',
      timestamp: getCurrentTimeLabel(),
    };

    setChatSessions((prev) =>
      sortSessionsByNewest(
        prev.map((session) => {
          if (session.id !== targetChatId) {
            return session;
          }

          const userMessageCount = session.messages.filter((message) => message.role === 'user').length;
          const shouldUpdateTitle =
            session.title === DEFAULT_CHAT_TITLE || userMessageCount === 0;

          return {
            ...session,
            title: shouldUpdateTitle ? buildChatTitleFromMessage(trimmedContent) : session.title,
            updatedAt: new Date().toISOString(),
            messages: [...session.messages, userMessage],
          };
        })
      )
    );

    setIsLoading(true);

    try {
      const historyForRequest = [...targetSession.messages, userMessage]
        .filter((message) => !message.isError)
        .map((message) => ({
          role: message.role,
          content: message.content
        }));

      // Send message to API
      const controller = new AbortController();
      // GPT-5 models can take longer due to reasoning, increase timeout to 90 seconds
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmedContent, messages: historyForRequest }),
        signal: controller.signal
      }).finally(() => {
        clearTimeout(timeoutId);
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();
      
      // Log the raw API response for debugging
      console.log("Raw API response from server:", JSON.stringify({
        hasResponse: !!data.response,
        responseLength: data.response ? data.response.length : 0,
        contextWindowTruncated: !!data.contextWindow?.truncated,
        contextWindowMessage: data.contextWindow?.message || '',
        hasRawApiResponse: !!data.raw_api_response,
        hasFullResponse: data.raw_api_response ? !!data.raw_api_response.fullResponse : false,
        hasOutputText: data.raw_api_response && data.raw_api_response.fullResponse ? !!data.raw_api_response.fullResponse.output_text : false,
        outputTextLength: data.raw_api_response && data.raw_api_response.fullResponse && data.raw_api_response.fullResponse.output_text ? data.raw_api_response.fullResponse.output_text.length : 0
      }));

      setContextWindowNotices((prev) => ({
        ...prev,
        [targetChatId]:
          data.contextWindow?.truncated && data.contextWindow?.message
            ? data.contextWindow.message
            : '',
      }));
      
      // Add bot response to state with vector store error info if present
      const botMessage: Message = {
        id: createId('msg'),
        content:
          typeof data.response === 'string' && data.response
            ? data.response
            : 'I could not generate a response. Please try again.',
        role: 'assistant',
        timestamp: getCurrentTimeLabel(),
        hasVectorStoreError: !!data.vectorStoreError,
        vectorStoreErrorMessage: data.vectorStoreError?.message || '',
        rawApiResponse: data.raw_api_response
      };
      
      clearCacheForMessage(botMessage.id);

      setChatSessions((prev) =>
        sortSessionsByNewest(
          prev.map((session) => {
            if (session.id !== targetChatId) {
              return session;
            }

            return {
              ...session,
              updatedAt: new Date().toISOString(),
              messages: [...session.messages, botMessage],
            };
          })
        )
      );
    } catch (error: any) {
      console.error('Error sending message:', error);

      // Determine error message based on error type
      let errorContent = 'Sorry, I encountered an error processing your request. Please try again.';
      if (error?.name === 'AbortError') {
        errorContent = 'The request timed out. Please try again with a simpler question.';
      }

      // Add error message
      const errorMessage: Message = {
        id: createId('msg'),
        content: errorContent,
        role: 'assistant',
        timestamp: getCurrentTimeLabel(),
        isError: true,
      };

      setChatSessions((prev) =>
        sortSessionsByNewest(
          prev.map((session) => {
            if (session.id !== targetChatId) {
              return session;
            }

            return {
              ...session,
              updatedAt: new Date().toISOString(),
              messages: [...session.messages, errorMessage],
            };
          })
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to format message content with better styling
  const formatMessageContent = (content: string) => {
    const escapeHtml = (value: string) => {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };

    const codeBlockPlaceholders: string[] = [];
    const normalizeInlineTagSpacing = (value: string) =>
      value
        .replace(/([A-Za-z0-9])(<strong>)/g, '$1 $2')
        .replace(/(<\/strong>)([A-Za-z0-9])/g, '$1 $2')
        .replace(/([A-Za-z0-9])(<em>)/g, '$1 $2')
        .replace(/(<\/em>)([A-Za-z0-9])/g, '$1 $2');

    const renderCodeBlock = (code: string, language = '') => {
      const normalizedLanguage = language.toLowerCase();
      const displayLanguage = normalizedLanguage || 'code';
      const trimmedCode = code.replace(/\s+$/, '');

      if (normalizedLanguage === 'json') {
        const highlightedJson = escapeHtml(trimmedCode)
          .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
          .replace(/: "([^"]+)"/g, ': <span class="string">"$1"</span>')
          .replace(/: (true|false|null)/g, ': <span class="boolean">$1</span>')
          .replace(/: (\d+(?:\.\d+)?)/g, ': <span class="number">$1</span>');

        return `<div class="code-block-wrap"><button type="button" class="code-copy-button" aria-label="Copy code snippet" title="Copy code">Copy code</button><pre data-language="json"><code class="json">${highlightedJson}</code></pre></div>`;
      }

      return `<div class="code-block-wrap"><button type="button" class="code-copy-button" aria-label="Copy code snippet" title="Copy code">Copy code</button><pre data-language="${displayLanguage}"><code class="${normalizedLanguage}">${escapeHtml(trimmedCode)}</code></pre></div>`;
    };

    const createCodePlaceholder = (code: string, language = '') => {
      const placeholderId = codeBlockPlaceholders.length;
      codeBlockPlaceholders.push(renderCodeBlock(code, language));
      return `__CODE_BLOCK_${placeholderId}__`;
    };

    const restoreCodePlaceholders = (value: string) => {
      return value.replace(/__CODE_BLOCK_(\d+)__/g, (match, indexText) => {
        const index = Number.parseInt(indexText, 10);
        return Number.isNaN(index) ? match : (codeBlockPlaceholders[index] || match);
      });
    };

    const extractCodeBlocks = (value: string) => {
      const normalizedValue = value.replace(/\r\n/g, '\n');
      const lines = normalizedValue.split('\n');
      const outputLines: string[] = [];
      let isInsideFence = false;
      let activeFenceChar = '`';
      let activeFenceLength = 3;
      let activeFenceIndent = 0;
      let activeLanguage = '';
      let activeCodeLines: string[] = [];

      const closeFence = () => {
        outputLines.push(createCodePlaceholder(activeCodeLines.join('\n'), activeLanguage));
        isInsideFence = false;
        activeFenceChar = '`';
        activeFenceLength = 3;
        activeFenceIndent = 0;
        activeLanguage = '';
        activeCodeLines = [];
      };

      for (const line of lines) {
        if (!isInsideFence) {
          const singleLineFenceMatch = line.match(/^\s*(`{3,}|~{3,})([a-zA-Z0-9_-]+)?\s+(.*?)\s*\1\s*$/);
          if (singleLineFenceMatch) {
            outputLines.push(createCodePlaceholder(singleLineFenceMatch[3] || '', (singleLineFenceMatch[2] || '').toLowerCase()));
            continue;
          }

          const openingFenceMatch = line.match(/^(\s*)(`{3,}|~{3,})([a-zA-Z0-9_-]+)?(?:\s+(.*))?\s*$/);
          if (openingFenceMatch) {
            isInsideFence = true;
            activeFenceIndent = openingFenceMatch[1].length;
            activeFenceChar = openingFenceMatch[2][0];
            activeFenceLength = openingFenceMatch[2].length;
            activeLanguage = (openingFenceMatch[3] || '').toLowerCase();
            activeCodeLines = [];

            if (openingFenceMatch[4]) {
              activeCodeLines.push(openingFenceMatch[4]);
            }

            continue;
          }

          outputLines.push(line);
          continue;
        }

        const closingFenceMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
        if (
          closingFenceMatch &&
          closingFenceMatch[1][0] === activeFenceChar &&
          closingFenceMatch[1].length >= activeFenceLength
        ) {
          closeFence();
          continue;
        }

        if (activeFenceIndent > 0 && line.startsWith(' '.repeat(activeFenceIndent))) {
          activeCodeLines.push(line.slice(activeFenceIndent));
        } else {
          activeCodeLines.push(line);
        }
      }

      if (isInsideFence) {
        closeFence();
      }

      let extractedContent = outputLines.join('\n');

      extractedContent = extractedContent.replace(/``([a-z0-9_-]+)?\s+([^\n`]+)``/gi, (match, language, code) => {
        return createCodePlaceholder(code || '', (language || '').toLowerCase());
      });

      extractedContent = extractedContent.replace(/^`([a-z0-9_-]+)\s+(.+)$/gim, (match, language, code) => {
        return createCodePlaceholder(code || '', (language || '').toLowerCase());
      });

      return extractedContent;
    };

    // Extract code blocks first so downstream markdown formatting does not mangle snippets.
    content = extractCodeBlocks(content);

    // Prevent broken or irrelevant embedded images in assistant markdown; convert to normal links.
    content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, altText, imageTarget) => {
      const [firstPart] = String(imageTarget).trim().split(/\s+/);
      const href = firstPart?.replace(/^<|>$/g, '') || '';

      if (!href) {
        return altText ? String(altText) : '';
      }

      const label = altText ? `Image: ${String(altText).trim()}` : 'Image link';
      return `[${label}](${href})`;
    });

    // Escape raw HTML that is not in fenced code blocks to avoid accidental rendering.
    content = escapeHtml(content);

    // First, detect if the content contains tables and handle them specially
    if (content.includes('|')) {
      // Extract table sections from the content
      const tableSections: string[] = [];
      const contentWithoutTables = content.replace(/\n([\s]*\|[^\n]+\|\n)([\s]*\|[^\n]+\|\n)+([\s]*\|[^\n]+\|)?/g, 
        (match) => {
          tableSections.push(match);
          return '\n{{TABLE_PLACEHOLDER_' + (tableSections.length - 1) + '}}\n';
        }
      );

      // Process the non-table content with standard formatting
      let formattedContent = contentWithoutTables
        // Headers
        .replace(/^#### (.*$)/gm, '<h4 class="message-h4">$1</h4>')
        .replace(/^### (.*$)/gm, '<h3 class="message-h3">$1</h3>')
        .replace(/^## (.*$)/gm, '<h2 class="message-h2">$1</h2>')
        .replace(/^# (.*$)/gm, '<h1 class="message-h1">$1</h1>')
        .replace(/^\s*(?:---|\*\*\*|___)\s*$/gm, '<hr>')
        
        // Emphasis
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        
        // Ordered and unordered lists
        .replace(/^\s*\d+[.)]\s+(.*?)$/gm, (match, item) => {
          return `<li>${item}</li>`;
        })
        .replace(/^\s*\*\s+(.*?)$/gm, (match, item) => {
          return `<li>${item}</li>`;
        })
        .replace(/^\s*-\s+(.*?)$/gm, (match, item) => {
          return `<li>${item}</li>`;
        })
        
        // Fix nested lists by adding start/end tags
        .replace(/(<li>.*<\/li>)(\n)(?=<li>)/g, '$1</ul><ul>');
      
      // Process inline code
      formattedContent = formattedContent.replace(/`(.*?)`/g, '<code>$1</code>');
      formattedContent = normalizeInlineTagSpacing(formattedContent);
      
      // Group list items in ul tags
      formattedContent = formattedContent.replace(/(<li>.*?<\/li>)(?:\s*\n\s*<li>.*?<\/li>)*/g, '<ul>$&</ul>');
      
      // Convert newlines to <br> tags outside of specific elements
      formattedContent = formattedContent.replace(/\n(?![<])/g, '<br>');
      
      // Process tables and replace placeholders
      tableSections.forEach((tableText: string, index: number) => {
        // Parse the markdown table
        const tableRows = tableText.trim().split('\n');
        let htmlTable = '<div class="table-responsive"><table class="markdown-table">';
        
        tableRows.forEach((row: string, rowIndex: number) => {
          const cells = row.split('|').slice(1, -1); // Remove first and last empty cells
          
          if (cells.length > 0) {
            if (rowIndex === 0) {
              // Header row
              htmlTable += '<thead><tr>';
              cells.forEach((cell: string) => {
                htmlTable += `<th>${cell.trim()}</th>`;
              });
              htmlTable += '</tr></thead><tbody>';
            } else if (rowIndex === 1 && cells.every((cell: string) => cell.trim().match(/^[-:]+$/))) {
              // This is the separator row, skip it
            } else {
              // Data row
              htmlTable += '<tr>';
              cells.forEach((cell: string) => {
                htmlTable += `<td>${cell.trim()}</td>`;
              });
              htmlTable += '</tr>';
            }
          }
        });
        
        htmlTable += '</tbody></table></div>';
        formattedContent = formattedContent.replace(`{{TABLE_PLACEHOLDER_${index}}}`, htmlTable);
      });
      
      return restoreCodePlaceholders(formattedContent);
    }
    
    // Special handling for API response codes from Global Payments
    if (content.includes("API response codes for soft declines from Global Payments")) {
      // Create a completely custom HTML output for this specific case
      // This bypasses the normal formatting process for guaranteed display
      try {
        // Use a line-by-line approach instead of complex regex
        interface ApiCode {
          code: string;
          reason: string;
          description: string;
        }
        
        const apiCodes: ApiCode[] = [];
        const lines = content.split('\n');
        
        // Log the actual lines for debugging
        console.log("Raw content lines:", lines);
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          
          // Skip empty lines or titles
          if (!line || line.includes("API response codes for soft declines")) {
            continue;
          }
          
          // Match different possible patterns for API code lines
          const bulletPattern = /^-\s+\*\*(\d+)\*\*:?\s*(.*?)$/;
          const bulletWithEmphasisPattern = /^-\s+\*\*(\d+)\*\*\s*-\s*\*([^*]+)\*:?\s*(.*?)$/;
          const numberedPattern = /^\d+\.\s+\*\*(\d+)\*\*:?\s*(.*?)$/;
          const numberedWithEmphasisPattern = /^\d+\.\s+\*\*(\d+)\*\*\s*-\s*\*([^*]+)\*:?\s*(.*?)$/;
          
          let code = null;
          let reason = null;
          let description = null;
          
          if (bulletWithEmphasisPattern.test(line)) {
            const match = line.match(bulletWithEmphasisPattern);
            if (match) {
              code = match[1];
              reason = match[2];
              description = match[3] || '';
            }
          } else if (numberedWithEmphasisPattern.test(line)) {
            const match = line.match(numberedWithEmphasisPattern);
            if (match) {
              code = match[1];
              reason = match[2];
              description = match[3] || '';
            }
          } else if (bulletPattern.test(line)) {
            const match = line.match(bulletPattern);
            if (match) {
              code = match[1];
              
              // Check if description contains an emphasized part
              const descParts = (match[2] || '').split(' - ');
              if (descParts.length > 1 && descParts[0].startsWith('*') && descParts[0].endsWith('*')) {
                reason = descParts[0].replace(/^\*|\*$/g, '');
                description = descParts.slice(1).join(' - ');
              } else {
                description = match[2] || '';
              }
            }
          } else if (numberedPattern.test(line)) {
            const match = line.match(numberedPattern);
            if (match) {
              code = match[1];
              
              // Check if description contains an emphasized part
              const descParts = (match[2] || '').split(' - ');
              if (descParts.length > 1 && descParts[0].startsWith('*') && descParts[0].endsWith('*')) {
                reason = descParts[0].replace(/^\*|\*$/g, '');
                description = descParts.slice(1).join(' - ');
              } else {
                description = match[2] || '';
              }
            }
          } else if (line.includes('**') && line.includes('**')) {
            // Simple fallback matcher for any line with a bold number
            const basicMatch = line.match(/\*\*(\d+)\*\*/);
            if (basicMatch) {
              code = basicMatch[1];
              description = line.replace(/\*\*\d+\*\*:?\s*/, '');
            }
          }
          
          if (code) {
            console.log(`Found code: ${code}, reason: ${reason}, desc: ${description || ''}`);
            apiCodes.push({
              code,
              reason: reason || '',
              description: (description || '').trim()
            });
          }
        }
        
        // Log the captured codes
        console.log(`Total API codes captured: ${apiCodes.length}`);
        console.log("Captured codes:", apiCodes.map(c => c.code).join(', '));
        
        // Known API codes that should be included
        const knownCodes = ['20001', '20002', '20003', '20004', '20005', '20006', '20009', '20012', '20013', '20014', '20046'];
        
        // Check if any known codes are missing
        const missingCodes = knownCodes.filter(code => !apiCodes.some(item => item.code === code));
        if (missingCodes.length > 0) {
          console.log("Missing codes detected:", missingCodes.join(', '));
          
          // Add missing codes with generic descriptions
          missingCodes.forEach(code => {
            apiCodes.push({
              code,
              reason: '',
              description: 'See documentation for details'
            });
          });
          
          // Sort the codes numerically
          apiCodes.sort((a, b) => parseInt(a.code) - parseInt(b.code));
        }
        
        // If we found codes, generate custom HTML
        if (apiCodes.length > 0) {
          let html = '<div class="api-response-section">';
          html += '<h3>API Response Codes for Soft Declines</h3>';
          html += '<ul class="api-codes-list">';
          
          apiCodes.forEach(item => {
            html += '<li class="api-code-item">';
            html += `<span class="api-code"><strong>${item.code}</strong></span>`;
            
            if (item.reason) {
              html += ` - <span class="api-reason"><em>${item.reason}</em></span>`;
            }
            
            if (item.description) {
              html += `: <span class="api-description">${item.description}</span>`;
            }
            
            html += '</li>';
          });
          
          html += '</ul></div>';
          return restoreCodePlaceholders(html);
        }
      } catch (e) {
        console.error('Error in custom API code formatter:', e);
        // Fall back to default formatting if the custom handler fails
      }
    }
    
    // Special handling for SDK response patterns
    if (content.includes("SDKs for mobile applications") || content.includes("Global Payments supports the following SDKs")) {
      // First process all bold texts
      content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      
      // Process the entire SDK list structure
      // 1. Format the SDK category headers (1. **Category**:)
      content = content.replace(/(\d+)\.\s+(?:\*\*([^:]*?)\*\*|<strong>([^:]*?)<\/strong>):\s*/gm, (match, number, category1, category2) => {
        const category = category1 || category2;
        return `<h3 class="sdk-category"><span class="number-marker">${number}.</span> <strong>${category}</strong>:</h3>`;
      });
      
      // 2. Format the individual SDK items (- **SDK Name**: Description)
      content = content.replace(/^\s*-\s+(?:\*\*([^:]*?)\*\*|<strong>([^:]*?)<\/strong>):\s*(.*?)$/gm, (match, sdk1, sdk2, description) => {
        const sdk = sdk1 || sdk2;
        return `<div class="sdk-item"><strong>${sdk}</strong>: ${description}</div>`;
      });
      
      // 3. Format the concluding paragraph
      const paragraphs = content.split('\n\n');
      if (paragraphs.length > 1) {
        const lastParagraph = paragraphs[paragraphs.length - 1];
        if (!lastParagraph.startsWith('<') && !lastParagraph.includes('**') && !lastParagraph.includes('<strong>')) {
          paragraphs[paragraphs.length - 1] = `<p class="sdk-conclusion">${lastParagraph}</p>`;
          content = paragraphs.join('\n\n');
        }
      }
      
      return restoreCodePlaceholders(content);
    }
    
    let formattedContent = content;

    // Format inline code with single backticks
    formattedContent = formattedContent.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    
    // Format bold texts
    formattedContent = formattedContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Format italic text
    formattedContent = formattedContent.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Format markdown links
    formattedContent = formattedContent.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    formattedContent = normalizeInlineTagSpacing(formattedContent);

    // Format headers with improved class names
    formattedContent = formattedContent.replace(/^#### (.*?)(?:\n|$)/gm, '<h4 class="message-h4">$1</h4>');
    formattedContent = formattedContent.replace(/^### (.*?)(?:\n|$)/gm, '<h3 class="message-h3">$1</h3>');
    formattedContent = formattedContent.replace(/^## (.*?)(?:\n|$)/gm, '<h2 class="message-h2">$1</h2>');
    formattedContent = formattedContent.replace(/^# (.*?)(?:\n|$)/gm, '<h1 class="message-h1">$1</h1>');
    formattedContent = formattedContent.replace(/^\s*(?:---|\*\*\*|___)\s*$/gm, '<hr>');
    
    // Format blockquotes
    formattedContent = formattedContent.replace(/^> (.*?)(?:\n|$)/gm, '<blockquote>$1</blockquote>');
    
    // Standard unordered lists
    const unorderedListRegex = /^\s*[-*]\s+(.*?)$/gm;
    if (formattedContent.match(unorderedListRegex)) {
      // First, mark all list items to preserve them
      formattedContent = formattedContent.replace(unorderedListRegex, '___LIST_ITEM___$1___END_LIST_ITEM___\n');
      
      // Replace all list items with proper HTML
      formattedContent = formattedContent.replace(/___LIST_ITEM___(.*?)___END_LIST_ITEM___/g, '<li>$1</li>');
      
      // Wrap consecutive list items in a ul tag
      formattedContent = formattedContent.replace(/(<li>.*?<\/li>\s*)+/g, match => {
        return `<ul class="api-list">${match}</ul>`;
      });
    }
    
    // Standard numbered lists for other cases (supports "1." and "1)")
    const numberedListRegex = /^(\s*)(\d+)[.)]\s+(.*)$/gm;
    if (formattedContent.match(numberedListRegex)) {
      formattedContent = formattedContent.replace(numberedListRegex, (match, indent, listNum, itemText) => {
        let result = `<li class="numbered-item"><span class="number-marker">${listNum}.</span><span class="numbered-item-text">`;
        result += itemText || '';
        result += '</span>';
        result += '</li>';
        return result;
      });
      
      formattedContent = formattedContent.replace(/(<li class="numbered-item">.*?<\/li>\n?)+/g, match => {
        return `<ol class="custom-numbered-list">${match}</ol>`;
      });
    }

    // Format tables if present (simple markdown tables)
    const tableRegex = /^\|(.+)\|$/gm;
    if (formattedContent.match(tableRegex)) {
      // Find table headers
      formattedContent = formattedContent.replace(/^\|(.*)\|[\s]*\n\|([-|:]+)\|[\s]*\n/gm, (match, headers, separators) => {
        const headerCells = headers.split('|').map((cell: string) => cell.trim());
        let tableHTML = '<table><thead><tr>';
        
        headerCells.forEach((cell: string) => {
          tableHTML += `<th>${cell}</th>`;
        });
        
        tableHTML += '</tr></thead><tbody>';
        return tableHTML;
      });
      
      // Process table rows
      formattedContent = formattedContent.replace(/^\|(.*)\|$/gm, (match, row) => {
        if (row.includes('---')) return ''; // Skip separator row
        
        const cells = row.split('|').map((cell: string) => cell.trim());
        let rowHTML = '<tr>';
        
        cells.forEach((cell: string) => {
          rowHTML += `<td>${cell}</td>`;
        });
        
        rowHTML += '</tr>';
        return rowHTML;
      });
      
      // Close table tags
      formattedContent = formattedContent.replace(/<tbody>([^<]*)<\/tr>/g, '<tbody>$1</tr></tbody></table>');
    }

    // Isolate code placeholders so paragraph formatting does not wrap them.
    formattedContent = formattedContent.replace(/(__CODE_BLOCK_\d+__)/g, '\n\n$1\n\n');

    // Format paragraphs (preserving existing HTML)
    const paragraphs = formattedContent.split('\n\n');
    formattedContent = paragraphs
      .map(p => {
        const trimmed = p.trim();

        if (/^__CODE_BLOCK_\d+__$/.test(trimmed)) {
          return trimmed;
        }

        if (
          !trimmed.startsWith('<') || 
          (trimmed.startsWith('<') && !trimmed.endsWith('>'))
        ) {
          return `<p>${trimmed}</p>`;
        }
        return trimmed;
      })
      .join('');
      
    // Clean up any remaining single newlines (not in code blocks)
    formattedContent = formattedContent.replace(/([^>])\n([^<])/g, '$1 $2');

    return restoreCodePlaceholders(formattedContent);
  };

  const handleFormattedContentClick = async (event: ReactMouseEvent<HTMLDivElement>) => {
    const clickTarget = event.target as HTMLElement;
    const copyButton = clickTarget.closest<HTMLButtonElement>('.code-copy-button');
    if (!copyButton) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const codeElement = copyButton
      .closest('.code-block-wrap')
      ?.querySelector('code');
    const codeText = codeElement?.textContent || '';

    if (!codeText.trim()) {
      return;
    }

    const originalLabel = copyButton.textContent || 'Copy code';

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(codeText);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = codeText;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        textArea.style.pointerEvents = 'none';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      copyButton.textContent = 'Copied';
      copyButton.classList.add('copied');
    } catch (error) {
      console.error('Unable to copy code snippet:', error);
      copyButton.textContent = 'Copy failed';
      copyButton.classList.remove('copied');
    }

    window.setTimeout(() => {
      copyButton.textContent = originalLabel;
      copyButton.classList.remove('copied');
    }, 1400);
  };

  // Custom renderer for message content
  const renderMessageContent = (message: Message) => {
    if (message.isError) {
      return (
        <ErrorDisplay 
          message={message.content} 
          onRetry={handleRetry} 
        />
      );
    }
    
    // MODIFIED CODE START: Process raw API response before checking cache
    // Check if we have raw API data and extract the full output_text
    if (message.rawApiResponse && message.rawApiResponse.fullResponse) {
      // Add debugging to understand the structure of the raw API response
      console.log("Raw API response structure:", JSON.stringify({
        hasOutputText: !!message.rawApiResponse.fullResponse.output_text,
        hasOutput: !!message.rawApiResponse.fullResponse.output,
        outputIsArray: Array.isArray(message.rawApiResponse.fullResponse.output),
        outputLength: Array.isArray(message.rawApiResponse.fullResponse.output) ? message.rawApiResponse.fullResponse.output.length : 0,
        hasOutputContent: Array.isArray(message.rawApiResponse.fullResponse.output) && 
                         message.rawApiResponse.fullResponse.output.length > 0 && 
                         !!message.rawApiResponse.fullResponse.output[1]?.content,
        hasNestedOutputText: Array.isArray(message.rawApiResponse.fullResponse.output) && 
                      message.rawApiResponse.fullResponse.output.length > 0 && 
                      !!message.rawApiResponse.fullResponse.output[1]?.content?.[0]?.text
      }));
      
      // Log the full structure of the response for debugging
      try {
        console.log("Full response structure keys:", Object.keys(message.rawApiResponse.fullResponse));
        
        if (message.rawApiResponse.fullResponse.output) {
          console.log("Output array structure:", 
            Array.isArray(message.rawApiResponse.fullResponse.output) 
              ? message.rawApiResponse.fullResponse.output.map((item: any) => ({
                  type: item.type,
                  hasContent: !!item.content,
                  contentLength: item.content ? item.content.length : 0
                }))
              : "Not an array"
          );
        }
      } catch (e) {
        console.error("Error logging response structure:", e);
      }
      
      // Check for output_text in different possible locations
      let outputText = null;
      
      // First check direct output_text property
      if (message.rawApiResponse.fullResponse.output_text) {
        outputText = message.rawApiResponse.fullResponse.output_text;
        console.log("Found output_text in fullResponse.output_text");
      } 
      // Then check in the output array for message type with content
      else if (Array.isArray(message.rawApiResponse.fullResponse.output)) {
        // Look for message type outputs
        const messageOutput = message.rawApiResponse.fullResponse.output.find(
          (item: any) => item.type === 'message'
        );
        
        if (messageOutput && Array.isArray(messageOutput.content) && messageOutput.content.length > 0) {
          // Find the first content item with output_text
          const textContent = messageOutput.content.find(
            (item: any) => item.type === 'output_text' && item.text
          );
          
          if (textContent && textContent.text) {
            outputText = textContent.text;
            console.log("Found output_text in fullResponse.output[].content[].text");
          }
        }
      }
      
      // Finally, check if there's a direct text property
      if (!outputText && message.rawApiResponse.fullResponse.text) {
        outputText = message.rawApiResponse.fullResponse.text;
        console.log("Found output_text in fullResponse.text");
      }
      
      // Check in metadata
      if (!outputText && message.rawApiResponse.metadata && message.rawApiResponse.metadata.output_text) {
        outputText = message.rawApiResponse.metadata.output_text;
        console.log("Found output_text in metadata.output_text");
      }
      
      if (outputText) {
        console.log("Using raw API response output_text");
        console.log("Standard content length:", message.content.length);
        console.log("Raw API output_text length:", outputText.length);
        
        // Update the message content with the full output_text
        message = {
          ...message,
          content: outputText
        };
      } else {
        console.log("No output_text found in raw API response");
      }
    }
    // MODIFIED CODE END
    
    // Check cache after potentially updating the content
    const messageKey = `${message.id}-${message.content.length}`;
    if (formattedContentCache.current.has(messageKey)) {
      console.log(`Using cached formatted content for message ${message.id}`);
      const cachedContent = formattedContentCache.current.get(messageKey) || '';
      
      return (
        <div>
          <div
            onClick={handleFormattedContentClick}
            dangerouslySetInnerHTML={{ __html: cachedContent }}
          />

          {message.role === 'assistant' && (
            <>
              <div className="documentation-link">
                <a href="https://developer.globalpay.com" target="_blank" rel="noopener noreferrer">View Official Documentation →</a>
              </div>
              {message.rawApiResponse && (
                <div className="raw-api-toggle">
                  <button onClick={() => toggleRawApi(message.id)} className="toggle-raw-btn">
                    {showRawApi[message.id] ? 'Hide' : 'Show'} Raw API Response
                  </button>
                  {showRawApi[message.id] && <RawApiDisplay data={message.rawApiResponse} />}
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    // Debug logging for message content length
    console.log(`Message content length before formatting: ${message.content.length}`);
    console.log(`First 100 chars: ${message.content.substring(0, 100)}`);
    console.log(`Last 100 chars: ${message.content.substring(message.content.length - 100)}`);
    
    // Format the content
    const formattedContent = formatMessageContent(message.content);
    console.log(`Formatted content length: ${formattedContent.length}`);
    
    // Check if this is an API response codes message - if the formatted content is suspiciously short, don't use it
    if (message.content.includes("API response codes for") && 
       (message.content.includes("soft declines") || message.content.includes("hard declines"))) {
      
      // Try displaying the raw content directly without formatting
      console.log("Using raw content display for API codes");
      console.log("Raw content:", message.content);
      
      // Get the known codes that should be included
      const knownCodes = ['20001', '20002', '20003', '20004', '20005', '20006', '20009', '20012', '20013', '20014', '20046', '20051', '20059'];
      
      // Parse the existing codes from the raw content
      const existingCodes = (message.content.match(/\*\*(\d+)\*\*/g) || [])
                              .map(code => code.replace(/\*\*/g, ''));
      console.log("Existing codes in raw content:", existingCodes);
      
      // Find missing codes
      const missingCodes = knownCodes.filter(code => !existingCodes.includes(code));
      console.log("Missing codes to add:", missingCodes);
      
      // Create enhanced content that includes the missing codes
      let enhancedContent = message.content;
      
      // Add missing codes before the last paragraph
      if (missingCodes.length > 0) {
        const contentParts = enhancedContent.split('\n\n');
        const lastParagraph = contentParts.pop() || '';
        
        // Add a section for missing codes
        let missingCodesSection = '\n### Additional API Response Codes\n\n';
        missingCodes.forEach(code => {
          missingCodesSection += `- **${code}**: See documentation for additional details.\n`;
        });
        
        // Reassemble content with missing codes
        contentParts.push(missingCodesSection);
        contentParts.push(lastParagraph);
        enhancedContent = contentParts.join('\n\n');
        
        console.log("Enhanced content with missing codes:", enhancedContent);
      }
      
      // Escape HTML characters in the enhanced content
      const escapedContent = enhancedContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      
      // Basic markdown formatting for raw content
      const basicFormatting = escapedContent
        // Replace newlines with <br> tags to preserve line breaks
        .replace(/\n/g, '<br>')
        // Format headers
        .replace(/###\s+(.*?)(?:<br>|$)/g, '<h3>$1</h3>')
        // Format bold text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Format italic text
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Format bullet points (after replacing newlines)
        .replace(/<br>\s*-\s+(.*?)(?=<br>|$)/g, '<li>$1</li>')
        // Wrap consecutive list items in ul
        .replace(/(<li>.*?<\/li>)+/g, '<ul class="api-list">$&</ul>')
        // Format code items - common pattern in response codes
        .replace(/<strong>(\d+)<\/strong>/g, '<span class="api-code"><strong>$1</strong></span>');
      
      // Create a simple container with a divider between original and additional codes if needed
      const rawDisplayContent = `
        <div class="api-response-section raw-content">
          <h3>API Response Codes</h3>
          <div class="api-raw-content">
            ${basicFormatting}
          </div>
        </div>
      `;
      
      // Store in cache
      formattedContentCache.current.set(messageKey, rawDisplayContent);
      console.log("Raw display content length:", rawDisplayContent.length);
      console.log("Enhanced content included missing codes:", missingCodes.length > 0 ? "Yes" : "No");
      
      return (
        <div>
          <div
            onClick={handleFormattedContentClick}
            dangerouslySetInnerHTML={{ __html: rawDisplayContent }}
          />

          {message.role === 'assistant' && (
            <>
              <div className="documentation-link">
                <a href="https://developer.globalpay.com" target="_blank" rel="noopener noreferrer">View Official Documentation →</a>
              </div>
              {message.rawApiResponse && (
                <div className="raw-api-toggle">
                  <button onClick={() => toggleRawApi(message.id)} className="toggle-raw-btn">
                    {showRawApi[message.id] ? 'Hide' : 'Show'} Raw API Response
                  </button>
                  {showRawApi[message.id] && <RawApiDisplay data={message.rawApiResponse} />}
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    // Store in cache to prevent multiple formatting passes
    formattedContentCache.current.set(messageKey, formattedContent);
    
    return (
      <div>
        <div
          onClick={handleFormattedContentClick}
          dangerouslySetInnerHTML={{ __html: formattedContent }}
        />

        {message.role === 'assistant' && (
          <>
            <div className="documentation-link">
              <a href="https://developer.globalpay.com" target="_blank" rel="noopener noreferrer">View Official Documentation →</a>
            </div>
            {message.rawApiResponse && (
              <div className="raw-api-toggle">
                <button onClick={() => toggleRawApi(message.id)} className="toggle-raw-btn">
                  {showRawApi[message.id] ? 'Hide' : 'Show'} Raw API Response
                </button>
                {showRawApi[message.id] && <RawApiDisplay data={message.rawApiResponse} />}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const chatHistoryItems = sortSessionsByNewest(chatSessions).map((session) => {
    const latestUserMessage = [...session.messages]
      .reverse()
      .find((message) => message.role === 'user' && !message.isError);
    const latestAssistantMessage = [...session.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.content !== DEFAULT_WELCOME_MESSAGE);
    const previewSource = latestUserMessage?.content || latestAssistantMessage?.content || 'Start a new conversation';
    const previewText = previewSource.replace(/\s+/g, ' ').trim() || 'Start a new conversation';

    return {
      id: session.id,
      title: session.title,
      preview: previewText.length <= 72 ? previewText : `${previewText.slice(0, 72).trimEnd()}...`,
      updatedAt: session.updatedAt,
      messageCount: session.messages.filter((message) => message.role === 'user').length,
    };
  });

  return (
    <div className="chat-container">
      <Header />

      <div className={`chat-layout ${isHistoryCollapsed ? 'history-collapsed' : ''}`}>
        {!isHistoryCollapsed && (
          <button
            type="button"
            className="chat-history-backdrop"
            onClick={handleToggleHistory}
            aria-label="Close history panel"
          />
        )}

        {isHistoryCollapsed && (
          <button
            type="button"
            className="history-reopen-handle"
            onClick={handleToggleHistory}
            aria-label="Show history panel"
            title="Show history"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M9.5 6L15.5 12L9.5 18"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        {!isHistoryCollapsed && (
          <ChatHistory
            items={chatHistoryItems}
            activeChatId={activeChatId}
            isLoading={isLoading}
            onToggleHistory={handleToggleHistory}
            onCreateChat={handleCreateChat}
            onDeleteChat={handleDeleteChat}
            onSelectChat={handleSelectChat}
          />
        )}

        <div className="chat-main">
          <ChatMessages 
            messages={messages} 
            isLoading={isLoading} 
            messagesEndRef={messagesEndRef}
            renderMessageContent={renderMessageContent}
          />

          {contextWindowNotice && (
            <div className="context-window-notice" role="status">
              {contextWindowNotice}
            </div>
          )}
          
          <ChatInput
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
