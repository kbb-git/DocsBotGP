'use client';

import { useState, FormEvent, KeyboardEvent } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  thinkingEnabled: boolean;
  onThinkingToggle: (enabled: boolean) => void;
}

export default function ChatInput({ onSendMessage, isLoading, thinkingEnabled, onThinkingToggle }: ChatInputProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isLoading) return;
    
    onSendMessage(message);
    setMessage('');
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-input-wrapper">
      <div className="thinking-toggle-container">
        <label className="thinking-toggle">
          <input
            type="checkbox"
            checked={thinkingEnabled}
            onChange={(e) => onThinkingToggle(e.target.checked)}
            disabled={isLoading}
          />
          <span className="toggle-slider"></span>
          <span className="toggle-label">
            {thinkingEnabled ? 'Thinking: On' : 'Thinking: Off'}
          </span>
        </label>
        <span className="toggle-hint">
          {thinkingEnabled ? 'More thorough responses' : 'Faster responses'}
        </span>
      </div>
      <form className="chat-input-container" onSubmit={handleSubmit}>
        <textarea
          className="chat-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Ask about Global Payments documentation..."
          disabled={isLoading}
          rows={2}
        />
        <button
          type="submit"
          className="send-button"
          disabled={!message.trim() || isLoading}
        >
          {isLoading ? (
            <LoadingSpinner size="small" color="white" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M22 2L11 13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M22 2L15 22L11 13L2 9L22 2Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
} 