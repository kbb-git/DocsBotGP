'use client';

import { useState, FormEvent, KeyboardEvent } from 'react';
import LoadingSpinner from './LoadingSpinner';

export type ThinkingStrength = 'none' | 'low' | 'medium' | 'high';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  thinkingStrength: ThinkingStrength;
  onThinkingStrengthChange: (strength: ThinkingStrength) => void;
}

const strengthLabels: Record<ThinkingStrength, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'Fastest responses' },
  low: { label: 'Low', hint: 'Quick with light reasoning' },
  medium: { label: 'Medium', hint: 'Balanced speed and depth' },
  high: { label: 'High', hint: 'Most thorough responses' },
};

export default function ChatInput({ onSendMessage, isLoading, thinkingStrength, onThinkingStrengthChange }: ChatInputProps) {
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
      <div className="thinking-strength-container">
        <label className="thinking-strength-label">Thinking:</label>
        <select
          className="thinking-strength-select"
          value={thinkingStrength}
          onChange={(e) => onThinkingStrengthChange(e.target.value as ThinkingStrength)}
          disabled={isLoading}
        >
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <span className="thinking-strength-hint">
          {strengthLabels[thinkingStrength].hint}
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
