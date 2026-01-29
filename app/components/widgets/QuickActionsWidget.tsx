'use client';

import Link from 'next/link';

interface QuickActionsWidgetProps {
  isDragging?: boolean;
}

export function QuickActionsWidget({ isDragging }: QuickActionsWidgetProps) {
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 p-4 shadow-sm transition-all ${
        isDragging ? 'shadow-lg ring-2 ring-blue-400 opacity-90' : 'hover:shadow-md'
      }`}
      data-testid="widget-quick-actions"
    >
      <h3 className="text-sm font-medium text-gray-700 mb-3">Quick Actions</h3>
      <div className="space-y-2">
        <Link
          href="/intake/commercial-gl"
          className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 text-sm text-gray-700 transition-colors"
          data-testid="link-new-intake"
        >
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Commercial GL Intake
        </Link>
        <button
          className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 text-sm text-gray-700 transition-colors w-full text-left"
          data-testid="button-export"
        >
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Leads
        </button>
        <button
          className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 text-sm text-gray-700 transition-colors w-full text-left"
          data-testid="button-refresh"
        >
          <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh Data
        </button>
      </div>
    </div>
  );
}
