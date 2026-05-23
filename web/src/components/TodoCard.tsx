import type { SessionEvent } from '../protocol';

type ToolUseEvent = Extract<SessionEvent, { kind: 'tool_use' }>;

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

/** Inline checklist rendering of Claude's TodoWrite tool. Replaces the
 *  generic JSON permission prompt so progress is visible in the chat. */
export function TodoCard({ event }: { event: ToolUseEvent }) {
  const input = (event.input as { todos?: TodoItem[] } | null) ?? {};
  const todos = Array.isArray(input.todos) ? input.todos : [];
  if (todos.length === 0) return null;

  const done = todos.filter((t) => t.status === 'completed').length;

  return (
    <div className="ev ev-todo">
      <div className="todo-head">
        <span className="todo-badge">Tasks</span>
        <span className="todo-count">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="todo-list">
        {todos.map((t, i) => (
          <li key={i} className={`todo-item todo-${t.status}`}>
            <span className="todo-mark">
              {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'}
            </span>
            <span className="todo-content">
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
