'use client';

interface StatsWidgetProps {
  id: string;
  title: string;
  value: number;
  color: 'blue' | 'yellow' | 'green' | 'purple';
  isDragging?: boolean;
}

const colorClasses = {
  blue: 'text-blue-600',
  yellow: 'text-yellow-600',
  green: 'text-green-600',
  purple: 'text-purple-600',
};

export function StatsWidget({ id, title, value, color, isDragging }: StatsWidgetProps) {
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 p-4 shadow-sm transition-all ${
        isDragging ? 'shadow-lg ring-2 ring-blue-400 opacity-90' : 'hover:shadow-md'
      }`}
      data-testid={`widget-stat-${id}`}
    >
      <p className="text-sm text-gray-600 mb-1">{title}</p>
      <p className={`text-3xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}
