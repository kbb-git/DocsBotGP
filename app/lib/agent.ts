// Import OpenAI properly
const { OpenAI } = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Use the provided vector store info
const VECTOR_STORE_NAME = process.env.VECTOR_STORE_NAME || 'globalpaymentsdocs';
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || 'vs_69288aa80bf881918d805ebd82e191f9';
const FILE_ID = process.env.FILE_ID || '';

// Define type for vector store item
interface VectorStoreItem {
  id?: string;
  metadata?: {
    content?: string;
    source?: string;
    [key: string]: any;
  };
  score?: number;
}

// Define type for search results
interface SearchResult {
  content: string;
  source: string;
  score: number;
}

// Define type for documentation search response
interface DocumentationSearchResponse {
  results: SearchResult[];
  error?: {
    type: string;
    message: string;
  };
}

// Define types for OpenAI responses API
interface FileCitation {
  text?: string;
  file_id?: string;
  file_path?: string;
  file_name?: string;
  [key: string]: any;
}

interface ToolResponse {
  type: string;
  file_citations?: FileCitation[];
  [key: string]: any;
}

// Default model - GPT-5.1
const DEFAULT_MODEL = 'gpt-5.1-2025-11-13';
const DOCS_ONLY_NO_MATCH_MESSAGE =
  "I couldn't verify that in the Global Payments documentation. Please rephrase your question or contact Global Payments support.";
const DOCS_ONLY_UNAVAILABLE_MESSAGE =
  "I couldn't access the Global Payments documentation right now, so I can't provide a verified answer. Please try again in a moment.";
const FOLLOW_UP_INDICATOR_PATTERN =
  /^(?:and|also|what about|how about|is it|does it|can it|that|it|this)\b|\b(?:it|that|this|their|those|these)\b/i;
const MAX_RETRIEVAL_HISTORY_MESSAGES = 6;
const MAX_RETRIEVAL_QUERY_CHARS = 1200;
const MIN_CONTEXT_SCORE = 0.55;
const REALEX_PATTERN = /\brealex(?:\s*payments)?\b|realexpayments/i;
const GLOBAL_PAYMENTS_PATTERN = /\bglobal\s*payments\b|globalpayments|global[_\s-]?payments/i;
const DOCS_CONTEXT_ESCAPE_PATTERN =
  /(?:say so and i can switch|i can switch out of (?:the )?documentation context|switch out of (?:the )?documentation context|talk about that instead|general or fun\/abstract sense|not related to global payments)/i;
const COMPARISON_OR_TRADEOFF_PATTERN =
  /\b(?:compare|comparison|difference|different|vs\.?|versus|better|best|trade-?off|pros?\s+and\s+cons?|advantages?|disadvantages?)\b/i;
const MULTI_PART_PATTERN =
  /\?\s*[^?]+\?|\b(?:first|second|third|1[\).]|2[\).]|3[\).])\b/i;
const AMBIGUOUS_FOLLOW_UP_PRONOUN_PATTERN =
  /\b(?:it|this|that|they|them|their|those|these|one|ones)\b/i;

function enforceDocsOnlyBoundary(responseText: string): string {
  if (!responseText.trim()) {
    return DOCS_ONLY_NO_MATCH_MESSAGE;
  }

  if (DOCS_CONTEXT_ESCAPE_PATTERN.test(responseText)) {
    return DOCS_ONLY_NO_MATCH_MESSAGE;
  }

  return responseText;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function referencesRealex(text: string): boolean {
  return REALEX_PATTERN.test(text);
}

function classifyResultBrandAffinity(result: SearchResult) {
  const haystack = `${result.source}\n${result.content}`;
  return {
    mentionsRealex: REALEX_PATTERN.test(haystack),
    mentionsGlobalPayments: GLOBAL_PAYMENTS_PATTERN.test(haystack)
  };
}

type ReasoningEffort = 'low' | 'medium';
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

function buildConversationInput(input: string, history: ConversationMessage[]): string {
  const trimmedInput = input.trim();

  if (!Array.isArray(history) || history.length === 0) {
    return trimmedInput || input;
  }

  const normalizedHistory = history
    .filter((message) => {
      return (
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0
      );
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim()
    }));

  const lastMessage = normalizedHistory[normalizedHistory.length - 1];
  const latestAlreadyIncluded =
    !!lastMessage &&
    lastMessage.role === 'user' &&
    lastMessage.content === trimmedInput;

  if (!latestAlreadyIncluded && trimmedInput) {
    normalizedHistory.push({
      role: 'user',
      content: trimmedInput
    });
  }

  if (normalizedHistory.length === 0) {
    return trimmedInput || input;
  }

  const conversationTranscript = normalizedHistory
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');

  return `Conversation history (oldest to newest):
${conversationTranscript}

Current user question:
${trimmedInput || input}`;
}

function buildRetrievalQuery(input: string, history: ConversationMessage[]): string {
  const trimmedInput = input.trim();
  const baseQuery = trimmedInput || input;

  const normalizedHistory = Array.isArray(history)
    ? history
        .filter((message) => {
          return (
            (message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string' &&
            message.content.trim().length > 0
          );
        })
        .map((message) => ({
          role: message.role,
          content: message.content.trim()
        }))
    : [];

  if (normalizedHistory.length === 0) {
    return baseQuery;
  }

  const recentMessages = normalizedHistory.slice(-MAX_RETRIEVAL_HISTORY_MESSAGES);
  const looksLikeFollowUp =
    baseQuery.length <= 40 ||
    FOLLOW_UP_INDICATOR_PATTERN.test(baseQuery);

  if (!looksLikeFollowUp) {
    return baseQuery;
  }

  const recentUserContext = recentMessages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join(' | ');
  const recentAssistantContext = recentMessages
    .filter((message) => message.role === 'assistant')
    .slice(-1)
    .map((message) => message.content)
    .join(' ');

  const retrievalQuery = `Current question: ${baseQuery}
Recent user context: ${truncateText(recentUserContext, 450)}
Recent assistant context: ${truncateText(recentAssistantContext, 450)}`;

  return truncateText(retrievalQuery, MAX_RETRIEVAL_QUERY_CHARS);
}

function determineReasoningEffort(input: string, history: ConversationMessage[]) {
  const trimmedInput = input.trim();
  const reasons: string[] = [];

  if (!trimmedInput) {
    return {
      primaryEffort: 'low' as ReasoningEffort,
      retryEfforts: ['low', 'medium'] as ReasoningEffort[],
      reasons
    };
  }

  if (COMPARISON_OR_TRADEOFF_PATTERN.test(trimmedInput)) {
    reasons.push('comparison_or_tradeoff');
  }

  if (MULTI_PART_PATTERN.test(trimmedInput)) {
    reasons.push('multi_part_question');
  }

  const looksLikeFollowUp =
    trimmedInput.length <= 40 ||
    FOLLOW_UP_INDICATOR_PATTERN.test(trimmedInput);
  const recentUserTurns = history.filter((message) => message.role === 'user').slice(-4);

  if (
    looksLikeFollowUp &&
    AMBIGUOUS_FOLLOW_UP_PRONOUN_PATTERN.test(trimmedInput) &&
    recentUserTurns.length >= 2
  ) {
    reasons.push('follow_up_ambiguity');
  }

  if (reasons.length > 0) {
    return {
      primaryEffort: 'medium' as ReasoningEffort,
      retryEfforts: ['medium'] as ReasoningEffort[],
      reasons
    };
  }

  return {
    primaryEffort: 'low' as ReasoningEffort,
    retryEfforts: ['low', 'medium'] as ReasoningEffort[],
    reasons
  };
}

/**
 * Run the Global Payments Docs agent to answer questions based on documentation
 * @param input - The user's question
 * @param model - The model to use (defaults to GPT-5.1)
 * @param conversationHistory - Bounded conversation context
 */
export async function runGlobalPaymentsDocsAgent(
  input: string,
  model: string = DEFAULT_MODEL,
  conversationHistory: ConversationMessage[] = []
) {
  try {
    // Search OpenAI vector store
    const retrievalQuery = buildRetrievalQuery(input, conversationHistory);
    const docSearchResponse = await searchDocumentation(retrievalQuery, model);

    // Prepare context from vector search results
    let context = '';
    let vectorSearchError = '';
    let highConfidenceResults: SearchResult[] = [];
    const userAskedForRealex = referencesRealex(input);

    if (docSearchResponse.error) {
      vectorSearchError = `Note: ${docSearchResponse.error.message}`;
      console.warn(`Vector search error: ${docSearchResponse.error.type} - ${docSearchResponse.error.message}`);
    }

    if (Array.isArray(docSearchResponse.results) && docSearchResponse.results.length > 0) {
      // Re-rank results to prioritize Global Payments over Realex
      const rankedCandidates = docSearchResponse.results
        .map(result => {
          const { mentionsRealex, mentionsGlobalPayments } = classifyResultBrandAffinity(result);
          let adjustedScore = result.score;

          // Strongly boost explicit Global Payments content.
          if (mentionsGlobalPayments) {
            adjustedScore = result.score * 2.2;
          }

          // Strongly down-rank legacy Realex content when it is not also tagged as Global Payments.
          if (mentionsRealex && !mentionsGlobalPayments) {
            adjustedScore = adjustedScore * 0.15;
          }

          // Mild penalty when a chunk mentions both terms (often migration/legacy references).
          if (mentionsRealex && mentionsGlobalPayments) {
            adjustedScore = adjustedScore * 0.8;
          }

          return {
            ...result,
            adjustedScore,
            mentionsRealex,
            mentionsGlobalPayments
          };
        })
        .sort((a, b) => b.adjustedScore - a.adjustedScore) // Sort by adjusted score
        .filter(result => result.adjustedScore > MIN_CONTEXT_SCORE); // Use a moderate threshold so follow-up queries can still ground to docs

      // Exclude Realex-only chunks unless the user explicitly asked about Realex.
      const preferredCandidates = rankedCandidates.filter((result) => {
        if (userAskedForRealex) {
          return true;
        }

        return !result.mentionsRealex || result.mentionsGlobalPayments;
      });

      const selectedCandidates = (
        preferredCandidates.length > 0
          ? preferredCandidates
          : userAskedForRealex
            ? rankedCandidates
            : []
      ).slice(0, 3);

      highConfidenceResults = selectedCandidates.map(({ content, source, score }) => ({
        content,
        source,
        score
      }));

      context = highConfidenceResults
        .map((result) => {
          // Truncate long content to reduce tokens
          const content = result.content.length > 5000
            ? result.content.substring(0, 5000) + "..."
            : result.content;

          return `Content: ${content}\nSource: ${result.source}\n---\n`;
        })
        .join('\n');
    } else {
      context = 'No relevant documentation found.';
    }

    if (highConfidenceResults.length === 0) {
      const response =
        docSearchResponse.error?.type === "VectorSearchError"
          ? DOCS_ONLY_UNAVAILABLE_MESSAGE
          : DOCS_ONLY_NO_MATCH_MESSAGE;

      return {
        response,
        metadata: {
          context: [],
          vectorSearchError: docSearchResponse.error
        },
        fullResponse: null
      };
    }

    const systemPrompt = `You are a documentation-only AI assistant for Global Payments Inc. Be concise.

When responding:
1. Base your answers on the documentation provided in the context.
2. If the answer is in the documentation, answer confidently.
3. Prioritize Global Payments-branded documentation and terminology over legacy Realex/Realex Payments references, unless the user explicitly asks about Realex.
4. Resolve follow-up references from prior turns when possible (for example, "it" should map to the most recent clear topic).
5. For "best option" questions, if the docs do not define an objective best choice, state that clearly and summarize trade-offs from the documentation context.
6. If information is missing from the documentation context, respond exactly with: "${DOCS_ONLY_NO_MATCH_MESSAGE}"
7. Don't make up information beyond what's in the context.
8. Never answer from general knowledge.
9. Never offer to switch out of documentation mode or discuss non-documentation topics.
10. Keep responses brief but helpful.
${vectorSearchError ? `11. ${vectorSearchError}` : ''}

Context from documentation:
${context}`;

    const modelInput = buildConversationInput(input, conversationHistory);
    const { primaryEffort, retryEfforts, reasons } = determineReasoningEffort(input, conversationHistory);
    let response = null;
    let responseText = '';
    let usedReasoningEffort: ReasoningEffort = primaryEffort;
    let lastModelError: any = null;

    for (let attemptIndex = 0; attemptIndex < retryEfforts.length; attemptIndex++) {
      const reasoningEffort = retryEfforts[attemptIndex];
      usedReasoningEffort = reasoningEffort;

      console.log(
        "Using Responses API for model:",
        model,
        "with reasoning effort:",
        reasoningEffort,
        "attempt:",
        `${attemptIndex + 1}/${retryEfforts.length}`,
        reasons.length > 0 ? `reasons: ${reasons.join(',')}` : "reasons: default_low"
      );

      try {
        const attemptResponse = await openai.responses.create({
          model: model,
          instructions: systemPrompt,
          input: modelInput,
          reasoning: { effort: reasoningEffort },
          text: { verbosity: "medium" }
        });

        const attemptText = enforceDocsOnlyBoundary(attemptResponse.output_text || '');
        const shouldRetryWithMedium =
          attemptIndex === 0 &&
          reasoningEffort === 'low' &&
          attemptText === DOCS_ONLY_NO_MATCH_MESSAGE &&
          highConfidenceResults.length > 0;

        if (shouldRetryWithMedium) {
          console.log("Retrying with medium reasoning after low effort returned no-match despite available context.");
          continue;
        }

        response = attemptResponse;
        responseText = attemptText;
        break;
      } catch (error: any) {
        lastModelError = error;
        const canRetryWithMedium =
          attemptIndex === 0 &&
          reasoningEffort === 'low' &&
          retryEfforts.length > 1;

        if (canRetryWithMedium) {
          console.warn("Low-effort generation failed; retrying once with medium effort.");
          continue;
        }

        throw error;
      }
    }

    if (!response) {
      throw lastModelError || new Error("Model response was empty after retries.");
    }

    console.log("GPT-5.1 response output_text:", responseText);
    
    // If there was a vector search error, append a note to the response
    if (docSearchResponse.error && !responseText.includes(docSearchResponse.error.message)) {
      responseText += `\n\n(Note: ${docSearchResponse.error.message})`;
    }
    
    return {
      response: responseText,
      metadata: { 
        context: docSearchResponse.results,
        vectorSearchError: docSearchResponse.error,
        reasoningEffort: usedReasoningEffort,
        reasoningReason: reasons.length > 0 ? reasons.join(',') : 'default_low'
      },
      fullResponse: response // Include the full response object
    };
  } catch (error: any) {
    console.error("Error running agent:", error);
    console.error("Error details:", JSON.stringify({
      message: error?.message,
      status: error?.status,
      code: error?.code,
      type: error?.type,
      model: model
    }, null, 2));
    return {
      response: "I'm sorry, I encountered an error while processing your request. Please try again.",
      error: error
    };
  }
}

/**
 * Search Global Payments documentation
 */
async function searchDocumentation(query: string, model: string = DEFAULT_MODEL): Promise<DocumentationSearchResponse> {
  try {
    console.log("Searching documentation with query:", query);
    console.log("Using vector store ID:", VECTOR_STORE_ID);
    
    try {
      // Format exactly as shown in the example
      const requestPayload = {
        model: model,
        input: query,
        instructions: "You are a helpful assistant that searches Global Payments documentation",
        tools: [
          {
            type: "file_search",
            vector_store_ids: [VECTOR_STORE_ID],
            max_num_results: 20 // Request more results for better re-ranking
          }
        ]
      };
      
      console.log("Request payload for vector search:", JSON.stringify(requestPayload, null, 2));
      
      const response = await openai.responses.create(requestPayload);
      
      console.log("Response from vector search:", JSON.stringify(response, null, 2));
      
      // Define interfaces for the OpenAI response structure
      interface FileSearchOutput {
        type: string;
        file_citations?: FileCitation[];
        [key: string]: any;
      }
      
      // Process the response
      if (response.output && Array.isArray(response.output)) {
        // Look for message type outputs
        const messageOutputs = response.output.filter((item: any) => item.type === "message");
        
        for (const messageOutput of messageOutputs) {
          if (messageOutput.content && Array.isArray(messageOutput.content)) {
            for (const contentItem of messageOutput.content) {
              if (contentItem.annotations && Array.isArray(contentItem.annotations)) {
                const fileCitations = contentItem.annotations.filter(
                  (annotation: any) => annotation.type === "file_citation"
                );
                
                if (fileCitations && fileCitations.length > 0) {
                  console.log("File citations found in annotations:", fileCitations.length);
                  
                  // Combine file citations with their text from the output
                  const results: SearchResult[] = fileCitations.map((citation: any) => ({
                    content: contentItem.text || '',
                    source: citation.filename || citation.file_id || 'Global Payments documentation',
                    score: 0.95 // Default score
                  }));
                  
                  return { results };
                }
              }
            }
          }
        }
      }
      
      // Legacy handling for the old format
      if (response.tool_use_outputs && response.tool_use_outputs.length > 0) {
        // Find the file search output
        const fileSearchOutput = response.tool_use_outputs.find(
          (output: FileSearchOutput) => output.type === 'file_search'
        );
        
        if (fileSearchOutput && fileSearchOutput.file_citations && fileSearchOutput.file_citations.length > 0) {
          console.log("File citations found in tool_use_outputs:", fileSearchOutput.file_citations.length);
          // Map file citations to search results
          const results: SearchResult[] = fileSearchOutput.file_citations.map((citation: FileCitation) => ({
            content: citation.text || '',
            source: citation.file_path || citation.file_name || citation.file_id || 'Global Payments documentation',
            score: 0.95 // We don't have actual scores from the API, so use a high default
          }));
          
          return { results };
        } else {
          console.log("No file citations found in tool_use_outputs");
        }
      }
      
      if (response.output_text && response.output_text.trim() !== '') {
        // If there are no file citations but we have output text,
        // Check if the response appears to contain documentation content
        const outputText = response.output_text.trim();
        const hasDocIndicators = 
          // Check for text that suggests documentation references
          outputText.includes("documentation excerpt") || 
          outputText.includes("This is supported in the documentation") ||
          // Check for response code patterns that match your documentation format
          /\"\d{5}\s[A-Z][a-z]+\s[a-z]+\s-\s[a-z\s]+\"/.test(outputText) ||
          // Check for multiple formatted error codes (likely from docs)
          (outputText.match(/\d{5}/g) || []).length >= 2;
        
        if (hasDocIndicators) {
          // Likely found info from docs despite missing citations
          console.log("Output appears to contain documentation despite missing citations");
          return {
            results: [{
              content: outputText,
              source: "Global Payments documentation", // No specific citation
              score: 0.9
            }]
          };
        } else {
          console.log("No file citations and no documentation indicators found");
          return {
            results: [],
            error: {
              type: "NoDocumentMatches",
              message: "The search didn't find relevant documents in the knowledge base."
            }
          };
        }
      }
      
      // No results found in the vector search
      console.log("No results from file search");
      return {
        results: [],
        error: {
          type: "NoResultsError",
          message: "The information you requested could not be found in our knowledge base."
        }
      };
    } catch (error: any) {
      console.error("File search error:", error);
      console.error("File search error details:", JSON.stringify({
        message: error?.message,
        status: error?.status,
        code: error?.code,
        type: error?.type,
        model: model
      }, null, 2));

      // All vector search methods failed
      console.error("All vector search methods failed:", error);
      return {
        results: [],
        error: {
          type: "VectorSearchError",
          message: "The information you requested could not be found in our knowledge base."
        }
      };
    }
  } catch (error) {
    console.error("Error searching documentation:", error);
    return {
      results: [],
      error: {
        type: "VectorSearchError",
        message: "The information you requested could not be found in our knowledge base."
      }
    };
  }
}
