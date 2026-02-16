'use client';

interface ErrorDisplayProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorDisplay({ message, onRetry }: ErrorDisplayProps) {
  return (
    <div className="message bot-message error-display">
      <p className={onRetry ? 'error-display-message' : ''}>
        <strong>Error:</strong> {message}
      </p>
      
      {onRetry && (
        <button 
          onClick={onRetry}
          className="error-retry-button"
        >
          Try Again
        </button>
      )}
    </div>
  );
} 
