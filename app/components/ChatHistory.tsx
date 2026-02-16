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
  onDeleteChat: (chatId: string) => void;
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
  onDeleteChat,
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
          <div
            key={item.id}
            role="listitem"
            className="chat-history-item-wrap"
          >
            <button
              type="button"
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
            <button
              type="button"
              className="chat-history-delete"
              onClick={() => onDeleteChat(item.id)}
              disabled={isLoading}
              aria-label={`Delete chat ${item.title}`}
              title="Delete chat"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9 7V5.6C9 4.72 9.72 4 10.6 4H13.4C14.28 4 15 4.72 15 5.6V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M18 7L17.35 17.1C17.28 18.2 16.37 19.05 15.27 19.05H8.73C7.63 19.05 6.72 18.2 6.65 17.1L6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M10 11V15.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M14 11V15.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
