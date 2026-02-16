'use client';

interface ChatHistoryItem {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
}

interface ChatHistoryProps {
  items: ChatHistoryItem[];
  activeChatId: string;
  isLoading: boolean;
  onToggleHistory: () => void;
  onCreateChat: () => void;
  onSelectChat: (chatId: string) => void;
}

function formatHistoryTimestamp(timestamp: string): string {
  const parsedDate = new Date(timestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return 'Recent';
  }

  const now = new Date();
  const isSameDay =
    now.getFullYear() === parsedDate.getFullYear() &&
    now.getMonth() === parsedDate.getMonth() &&
    now.getDate() === parsedDate.getDate();

  if (isSameDay) {
    return parsedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return parsedDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatHistory({
  items,
  activeChatId,
  isLoading,
  onToggleHistory,
  onCreateChat,
  onSelectChat
}: ChatHistoryProps) {
  return (
    <aside className="chat-history" aria-label="Saved chats">
      <div className="chat-history-header">
        <div className="chat-history-header-left">
          <h2>History</h2>
          <button
            type="button"
            className="history-panel-toggle"
            onClick={onToggleHistory}
            aria-label="Hide history panel"
            title="Hide history"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M14.5 6L8.5 12L14.5 18"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="new-chat-button"
          onClick={onCreateChat}
          disabled={isLoading}
        >
          New chat
        </button>
      </div>

      <div className="chat-history-list" role="list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="listitem"
            className={`chat-history-item ${item.id === activeChatId ? 'active' : ''}`}
            onClick={() => onSelectChat(item.id)}
            disabled={isLoading}
          >
            <span className="chat-history-title">{item.title}</span>
            <span className="chat-history-preview">{item.preview}</span>
            <span className="chat-history-meta">
              {item.messageCount} msgs • {formatHistoryTimestamp(item.updatedAt)}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
