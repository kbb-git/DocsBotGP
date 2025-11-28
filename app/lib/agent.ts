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

/**
 * Run the Global Payments Docs agent to answer questions based on documentation
 * @param input - The user's question
 * @param model - The model to use (defaults to GPT-5.1)
 * @param thinking - Whether to enable extended thinking (true = "low", false = "none")
 */
export async function runGlobalPaymentsDocsAgent(input: string, model: string = DEFAULT_MODEL, thinking: boolean = true) {
  try {
    // Search OpenAI vector store
    const docSearchResponse = await searchDocumentation(input, model);

    // Prepare context from vector search results
    let context = '';
    let vectorSearchError = '';

    if (docSearchResponse.error) {
      vectorSearchError = `Note: ${docSearchResponse.error.message}`;
      console.warn(`Vector search error: ${docSearchResponse.error.type} - ${docSearchResponse.error.message}`);
    }

    if (Array.isArray(docSearchResponse.results) && docSearchResponse.results.length > 0) {
      // Re-rank results to prioritize Global Payments over Realex
      const rerankedResults = docSearchResponse.results
        .map(result => {
          // Determine source type and apply priority boost/penalty
          const sourceLower = result.source.toLowerCase();
          let adjustedScore = result.score;

          // Boost Global Payments documentation
          if (sourceLower.includes('globalpayments') || sourceLower.includes('global_payments')) {
            adjustedScore = result.score * 1.5;
          }
          // Penalize Realex documentation
          else if (sourceLower.includes('realex')) {
            adjustedScore = result.score * 0.5;
          }

          return {
            ...result,
            adjustedScore
          };
        })
        .sort((a, b) => b.adjustedScore - a.adjustedScore) // Sort by adjusted score
        .slice(0, 3) // Take top 3 after re-ranking
        .filter(result => result.score > 0.7) // Only use results above relevance threshold
        .map((result) => {
          // Truncate long content to reduce tokens
          const content = result.content.length > 5000
            ? result.content.substring(0, 5000) + "..."
            : result.content;

          return `Content: ${content}\nSource: ${result.source}\n---\n`;
        })
        .join('\n');

      context = rerankedResults || 'No highly relevant documentation found.';
    } else {
      context = 'No relevant documentation found.';
    }

    const systemPrompt = `You are a helpful AI assistant that answers questions about Global Payments Inc. documentation. Be concise.

When responding:
1. Base your answers on the documentation provided in the context.
2. If the answer is in the documentation, answer confidently.
3. If information is missing, acknowledge this and suggest contacting Global Payments support.
4. Don't make up information beyond what's in the context.
5. Keep responses brief but helpful.
${vectorSearchError ? `6. ${vectorSearchError}` : ''}

Context from documentation:
${context}`;

    // Use Responses API for GPT-5.1
    const reasoningEffort = thinking ? "low" : "none";
    console.log("Using Responses API for model:", model, "with reasoning effort:", reasoningEffort);
    const response = await openai.responses.create({
      model: model,
      instructions: systemPrompt,
      input: input,
      reasoning: { effort: reasoningEffort },
      text: { verbosity: "medium" }
    });

    let responseText = response.output_text || '';
    console.log("GPT-5.1 response output_text:", responseText);
    
    // If there was a vector search error, append a note to the response
    if (docSearchResponse.error && !responseText.includes(docSearchResponse.error.message)) {
      responseText += `\n\n(Note: ${docSearchResponse.error.message} I've provided an answer based on general knowledge instead.)`;
    }
    
    return {
      response: responseText,
      metadata: { 
        context: docSearchResponse.results,
        vectorSearchError: docSearchResponse.error
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
          // Fall back to the existing behavior for general knowledge
          console.log("No file citations but received output text from the model");
          return {
            results: [{
              content: outputText,
              source: "Model knowledge - no document citations",
              score: 0.8
            }],
            error: {
              type: "NoDocumentMatches",
              message: "The search didn't find relevant documents in the knowledge base."
            }
          };
        }
      }
      
      // No results found, fall back to general knowledge
      console.log("No results from file search, using fallback method");
      return {
        results: await fallbackSearchDocumentation(query, model),
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

      // All vector search methods failed, fall back to general knowledge
      console.error("All vector search methods failed:", error);
      return {
        results: await fallbackSearchDocumentation(query, model),
        error: {
          type: "VectorSearchError",
          message: "The information you requested could not be found in our knowledge base."
        }
      };
    }
  } catch (error) {
    console.error("Error searching documentation:", error);
    return {
      results: await fallbackSearchDocumentation(query, model),
      error: {
        type: "DocumentationSearchError",
        message: "The information you requested could not be found in our knowledge base."
      }
    };
  }
}

/**
 * Fallback search method using Responses API
 */
async function fallbackSearchDocumentation(query: string, model: string = DEFAULT_MODEL): Promise<SearchResult[]> {
  try {
    const systemPrompt = `You're helping retrieve information about Global Payments from their documentation.
The user is asking: "${query}".
Please provide a concise answer based on what you know about Global Payments' payment processing services,
APIs, and integration methods. Focus specifically on their documentation.`;

    // Use Responses API for GPT-5.1
    const retrievalResponse = await openai.responses.create({
      model: model,
      instructions: systemPrompt,
      input: query,
      reasoning: { effort: "none" }, // Fast response for fallback
      text: { verbosity: "low" }
    });

    const content = retrievalResponse.output_text || '';

    return [
      {
        content: content,
        source: "Global Payments general knowledge (fallback)",
        score: 0.95
      }
    ];
  } catch (error) {
    console.error("Error in fallback search:", error);
    return [
      {
        content: "I couldn't find specific information about that in the Global Payments documentation.",
        source: "Fallback response",
        score: 0.5
      }
    ];
  }
} 