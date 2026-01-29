'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableWidgetProps {
  id: string;
  children: React.ReactNode;
  isEditing?: boolean;
}

export function SortableWidget({ id, children, isEditing = false }: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style} {...(isEditing ? attributes : {})}>
      <div className={`relative ${isEditing ? 'group' : ''}`}>
        {isEditing && (
          <div
            {...listeners}
            className="absolute -top-1 -left-1 -right-1 h-6 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center"
            data-testid={`drag-handle-${id}`}
          >
            <div className="bg-blue-100 border border-blue-200 rounded-full px-2 py-0.5 flex items-center gap-1">
              <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
              </svg>
              <span className="text-xs text-blue-600">Drag</span>
            </div>
          </div>
        )}
        {isDragging && (
          <div className="absolute inset-0 bg-blue-50 border-2 border-dashed border-blue-300 rounded-lg pointer-events-none" />
        )}
        {children}
      </div>
    </div>
  );
}
