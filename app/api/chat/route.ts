import { NextRequest, NextResponse } from 'next/server';
import { runGlobalPaymentsDocsAgent } from '../../lib/agent';
import type { ConversationMessage } from '../../lib/agent';

// Simple in-memory cache for responses
// In a production app, you might use Redis or another solution
const responseCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour in milliseconds
const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 8000;
const APPROX_CHARS_PER_TOKEN = 4;
const CONTEXT_WINDOW_EXPIRED_MESSAGE =
  'The chat context window has expired. Older messages are no longer included in context. Start a new chat or refresh the page to clear chat history.';

interface ContextWindowSummary {
  truncated: boolean;
  message: string | null;
  keptMessages: number;
  totalMessages: number;
  maxMessages: number;
  maxChars: number;
  approxTokens: number;
}

interface ContextWindowResult {
  messages: ConversationMessage[];
  totalMessages: number;
  totalChars: number;
  truncated: boolean;
}

// Define error interface for TypeScript
interface OpenAIError {
  code?: string;
  message?: string;
}

function normalizeConversationMessages(messages: unknown): ConversationMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message: any): ConversationMessage | null => {
      if (!message || typeof message !== 'object') {
        return null;
      }

      const role = message.role;
      const content = message.content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
        return null;
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return null;
      }

      return {
        role,
        content: trimmedContent
      };
    })
    .filter((message): message is ConversationMessage => message !== null);
}

function buildContextWindow(history: ConversationMessage[], latestUserMessage: string): ContextWindowResult {
  const conversation = [...history];
  const trimmedLatestMessage = latestUserMessage.trim();

  const lastMessage = conversation[conversation.length - 1];
  const latestAlreadyIncluded =
    !!lastMessage &&
    lastMessage.role === 'user' &&
    lastMessage.content === trimmedLatestMessage;

  if (!latestAlreadyIncluded && trimmedLatestMessage) {
    conversation.push({
      role: 'user',
      content: trimmedLatestMessage
    });
  }

  const selectedMessages: ConversationMessage[] = [];
  let totalChars = 0;

  for (let i = conversation.length - 1; i >= 0; i--) {
    const currentMessage = conversation[i];
    const currentMessageChars = currentMessage.content.length;
    const reachedMessageLimit = selectedMessages.length >= MAX_CONTEXT_MESSAGES;
    const wouldExceedCharLimit =
      selectedMessages.length > 0 && (totalChars + currentMessageChars > MAX_CONTEXT_CHARS);

    if (reachedMessageLimit || wouldExceedCharLimit) {
      break;
    }

    selectedMessages.push(currentMessage);
    totalChars += currentMessageChars;
  }

  if (selectedMessages.length === 0 && trimmedLatestMessage) {
    selectedMessages.push({
      role: 'user',
      content: trimmedLatestMessage
    });
    totalChars = trimmedLatestMessage.length;
  }

  selectedMessages.reverse();

  return {
    messages: selectedMessages,
    totalMessages: conversation.length,
    totalChars,
    truncated: selectedMessages.length < conversation.length
  };
}

export async function POST(req: NextRequest) {
  try {
    // Get the message and conversation history from the request body
    const { message, messages = [] } = await req.json();

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'Invalid message format' },
        { status: 400 }
      );
    }

    const normalizedMessage = message.trim();
    const normalizedHistory = normalizeConversationMessages(messages);
    const contextWindow = buildContextWindow(normalizedHistory, normalizedMessage);
    const contextWindowSummary: ContextWindowSummary = {
      truncated: contextWindow.truncated,
      message: contextWindow.truncated ? CONTEXT_WINDOW_EXPIRED_MESSAGE : null,
      keptMessages: contextWindow.messages.length,
      totalMessages: contextWindow.totalMessages,
      maxMessages: MAX_CONTEXT_MESSAGES,
      maxChars: MAX_CONTEXT_CHARS,
      approxTokens: Math.ceil(contextWindow.totalChars / APPROX_CHARS_PER_TOKEN)
    };

    // Generate a cache key from the bounded chat window.
    // Reasoning effort is selected internally in the agent.
    const cacheKey = JSON.stringify({
      contextMessages: contextWindow.messages
    });
    
    // Check if we have a cached response
    if (responseCache.has(cacheKey)) {
      const cachedData = responseCache.get(cacheKey);
      // Check if cache is still valid
      if (Date.now() - cachedData.timestamp < CACHE_TTL) {
        console.log('Using cached response');
        return NextResponse.json({ 
          response: cachedData.response,
          metadata: cachedData.metadata,
          cached: true,
          vectorStoreError: cachedData.vectorStoreError,
          contextWindow: cachedData.contextWindow || contextWindowSummary
        });
      } else {
        // Cache expired, remove it
        responseCache.delete(cacheKey);
      }
    }

    // Run the agent with the user's message and bounded conversation history
    const agentResponse = await runGlobalPaymentsDocsAgent(
      normalizedMessage,
      undefined,
      contextWindow.messages
    );

    // Cache the response if successful
    if (agentResponse.response && !agentResponse.error) {
      responseCache.set(cacheKey, {
        ...agentResponse,
        contextWindow: contextWindowSummary,
        timestamp: Date.now()
      });
    }

    // Return the response with vector store error info if present
    return NextResponse.json({ 
      response: agentResponse.response,
      metadata: agentResponse.metadata,
      vectorStoreError: agentResponse.metadata?.vectorSearchError || null,
      contextWindow: contextWindowSummary,
      raw_api_response: {
        fullResponse: agentResponse.fullResponse,
        metadata: agentResponse.metadata
      }  // Add the raw API response for debugging
    });
  } catch (error: unknown) {
    console.error('Error processing chat request:', error);
    
    // Type guard for OpenAI errors
    const openAIError = error as OpenAIError;
    
    // Check for rate limit errors and handle them gracefully
    if (openAIError.code === 'rate_limit_exceeded') {
      return NextResponse.json(
        { 
          error: 'OpenAI rate limit exceeded',
          message: 'The service is experiencing high demand. Please try again in a moment.',
          response: "I'm sorry, but I'm currently handling too many requests. Please try asking a simpler question or try again in a few moments."
        },
        { status: 429 }
      );
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to process request', 
        message: error instanceof Error ? error.message : 'Unknown error',
        response: "I'm sorry, I encountered an error while processing your request. The knowledge base might be temporarily unavailable."
      },
      { status: 500 }
    );
  }
}
