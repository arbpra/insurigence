'use client';

import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableWidget } from './SortableWidget';
import { StatsWidget } from './StatsWidget';
import { LeadsTableWidget } from './LeadsTableWidget';
import { QuickActionsWidget } from './QuickActionsWidget';

interface Lead {
  id: string;
  insuredName: string;
  primaryContactEmail: string | null;
  lob: string;
  status: string;
  marketClassification: string | null;
  marketConfidence: number | null;
  createdAt: string;
  carrierFits?: Array<{
    carrierId: string;
    carrier: { name: string };
    tier: string;
    score: number;
  }>;
}

interface Stats {
  totalLeads: number;
  pendingReview: number;
  converted: number;
  thisMonth: number;
}

interface DashboardGridProps {
  leads: Lead[];
  stats: Stats;
  onEvaluate: (id: string) => void;
  evaluatingLeadId: string | null;
}

type WidgetType = 'stats-total' | 'stats-pending' | 'stats-converted' | 'stats-month' | 'quick-actions' | 'leads-table';

const DEFAULT_WIDGET_ORDER: WidgetType[] = [
  'stats-total',
  'stats-pending',
  'stats-converted',
  'stats-month',
  'quick-actions',
  'leads-table',
];

const STORAGE_KEY = 'dashboard-widget-order';

export function DashboardGrid({ leads, stats, onEvaluate, evaluatingLeadId }: DashboardGridProps) {
  const [widgetOrder, setWidgetOrder] = useState<WidgetType[]>(DEFAULT_WIDGET_ORDER);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === DEFAULT_WIDGET_ORDER.length) {
          setWidgetOrder(parsed);
        }
      } catch {
        // Use default order
      }
    }
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setWidgetOrder((items) => {
        const oldIndex = items.indexOf(active.id as WidgetType);
        const newIndex = items.indexOf(over.id as WidgetType);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrder));
        return newOrder;
      });
    }
  };

  const resetLayout = () => {
    setWidgetOrder(DEFAULT_WIDGET_ORDER);
    localStorage.removeItem(STORAGE_KEY);
  };

  const renderWidget = (id: WidgetType) => {
    switch (id) {
      case 'stats-total':
        return <StatsWidget id="total" title="Total Leads" value={stats.totalLeads} color="blue" />;
      case 'stats-pending':
        return <StatsWidget id="pending" title="Pending Review" value={stats.pendingReview} color="yellow" />;
      case 'stats-converted':
        return <StatsWidget id="converted" title="Converted" value={stats.converted} color="green" />;
      case 'stats-month':
        return <StatsWidget id="month" title="This Month" value={stats.thisMonth} color="purple" />;
      case 'quick-actions':
        return <QuickActionsWidget />;
      case 'leads-table':
        return <LeadsTableWidget leads={leads} onEvaluate={onEvaluate} evaluatingLeadId={evaluatingLeadId} />;
      default:
        return null;
    }
  };

  const statsWidgets = widgetOrder.filter(w => w.startsWith('stats-'));
  const otherWidgets = widgetOrder.filter(w => !w.startsWith('stats-'));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className={`text-sm px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              isEditing
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            data-testid="button-toggle-edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {isEditing ? 'Done Editing' : 'Customize Layout'}
          </button>
          {isEditing && (
            <button
              onClick={resetLayout}
              className="text-sm px-3 py-1.5 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              data-testid="button-reset-layout"
            >
              Reset to Default
            </button>
          )}
        </div>
        {isEditing && (
          <p className="text-sm text-gray-500">Drag widgets to rearrange</p>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={widgetOrder} strategy={rectSortingStrategy}>
          <div className={`grid grid-cols-2 lg:grid-cols-4 gap-4 ${isEditing ? 'ring-2 ring-blue-100 ring-offset-2 rounded-lg p-2 -m-2' : ''}`}>
            {statsWidgets.map((id) => (
              <SortableWidget key={id} id={id} isEditing={isEditing}>
                {renderWidget(id)}
              </SortableWidget>
            ))}
          </div>

          <div className={`grid grid-cols-1 lg:grid-cols-4 gap-4 mt-4 ${isEditing ? 'ring-2 ring-blue-100 ring-offset-2 rounded-lg p-2 -m-2' : ''}`}>
            {otherWidgets.map((id) => (
              <div key={id} className={id === 'leads-table' ? 'lg:col-span-3' : ''}>
                <SortableWidget id={id} isEditing={isEditing}>
                  {renderWidget(id)}
                </SortableWidget>
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
