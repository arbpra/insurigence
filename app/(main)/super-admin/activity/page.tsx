'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '../layout';
import { Activity, ArrowLeft, Calendar, Filter, Building2, User } from 'lucide-react';

interface ActivityEvent {
  id: string;
  eventType: string;
  agencyId: string | null;
  agencyName: string | null;
  userId: string | null;
  userName: string | null;
  leadId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

interface Agency {
  id: string;
  name: string;
}

const eventTypeLabels: Record<string, { label: string; color: string }> = {
  INTAKE_SUBMITTED_INTERNAL: { label: 'Internal Intake', color: 'bg-blue-100 text-blue-700' },
  INTAKE_SUBMITTED_EXTERNAL: { label: 'External Intake', color: 'bg-purple-100 text-purple-700' },
  LEAD_EVALUATED: { label: 'Lead Evaluated', color: 'bg-green-100 text-green-700' },
  PROPOSAL_CREATED: { label: 'Proposal Created', color: 'bg-amber-100 text-amber-700' },
  PROPOSAL_SHARED: { label: 'Proposal Shared', color: 'bg-teal-100 text-teal-700' },
  PROPOSAL_VIEWED: { label: 'Proposal Viewed', color: 'bg-cyan-100 text-cyan-700' },
  USER_LOGIN: { label: 'User Login', color: 'bg-gray-100 text-gray-700' },
  USER_CREATED: { label: 'User Created', color: 'bg-indigo-100 text-indigo-700' },
  USER_UPDATED: { label: 'User Updated', color: 'bg-indigo-100 text-indigo-700' },
  USER_DEACTIVATED: { label: 'User Deactivated', color: 'bg-red-100 text-red-700' },
  AGENCY_CREATED: { label: 'Agency Created', color: 'bg-emerald-100 text-emerald-700' },
  AGENCY_UPDATED: { label: 'Agency Updated', color: 'bg-emerald-100 text-emerald-700' },
  AGENCY_PAUSED: { label: 'Agency Paused', color: 'bg-orange-100 text-orange-700' },
  CARRIER_CREATED: { label: 'Carrier Created', color: 'bg-sky-100 text-sky-700' },
  CARRIER_UPDATED: { label: 'Carrier Updated', color: 'bg-sky-100 text-sky-700' },
  APPETITE_RULE_CREATED: { label: 'Appetite Rule Created', color: 'bg-violet-100 text-violet-700' },
  APPETITE_RULE_UPDATED: { label: 'Appetite Rule Updated', color: 'bg-violet-100 text-violet-700' },
  INTAKE_FORM_CREATED: { label: 'Intake Form Created', color: 'bg-rose-100 text-rose-700' },
  INTAKE_FORM_PUBLIC_TOGGLED: { label: 'Intake Form Public Toggle', color: 'bg-rose-100 text-rose-700' },
};

export default function ActivityPage() {
  const { authFetch } = useAdminAuth();
  
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const [range, setRange] = useState('7d');
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');

  const fetchActivity = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ range });
      if (eventTypeFilter) params.set('eventType', eventTypeFilter);
      if (agencyFilter) params.set('agencyId', agencyFilter);
      
      const res = await authFetch(`/api/super-admin/activity?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events);
        setSummary(data.summary);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAgencies = async () => {
    const res = await authFetch('/api/super-admin/agencies');
    if (res.ok) {
      const data = await res.json();
      setAgencies(data.agencies);
    }
  };

  useEffect(() => {
    fetchActivity();
  }, [range, eventTypeFilter, agencyFilter]);

  useEffect(() => {
    fetchAgencies();
  }, []);

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const totalEvents = Object.values(summary).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F7FA' }}>
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/super-admin"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#0D2137' }}
            >
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#0D2137' }}>Activity Analytics</h1>
              <p className="text-sm text-gray-500">Platform-wide activity monitoring</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6" data-testid="event-summary">
          <h2 className="text-sm font-medium text-gray-500 mb-4">Event Summary ({range})</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg" data-testid="stat-total-events">
              <p className="text-2xl font-bold" style={{ color: '#0D2137' }}>{totalEvents}</p>
              <p className="text-xs text-gray-500">Total Events</p>
            </div>
            {Object.entries(summary).slice(0, 5).map(([type, count]) => (
              <div key={type} className="p-4 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold" style={{ color: '#00E6A7' }}>{count}</p>
                <p className="text-xs text-gray-500 truncate">
                  {eventTypeLabels[type]?.label || type.replace(/_/g, ' ')}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <select
                value={range}
                onChange={(e) => setRange(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                data-testid="select-range"
              >
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                data-testid="select-event-type"
              >
                <option value="">All Event Types</option>
                {Object.entries(eventTypeLabels).map(([value, { label }]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <select
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
              data-testid="select-agency-filter"
            >
              <option value="">All Agencies</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>{agency.name}</option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Event</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Agency</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">User</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Details</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading...</td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">No activity found</td>
                  </tr>
                ) : (
                  events.map((event) => {
                    const typeInfo = eventTypeLabels[event.eventType] || { label: event.eventType, color: 'bg-gray-100 text-gray-700' };
                    return (
                      <tr key={event.id} className="hover:bg-gray-50" data-testid={`row-event-${event.id}`}>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${typeInfo.color}`}>
                            {typeInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {event.agencyName ? (
                            <Link
                              href={`/super-admin/agencies/${event.agencyId}`}
                              className="text-sm text-gray-900 hover:underline flex items-center gap-1"
                            >
                              <Building2 className="w-3 h-3" />
                              {event.agencyName}
                            </Link>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {event.userName ? (
                            <span className="text-sm text-gray-900 flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {event.userName}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">System</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-500 max-w-xs truncate">
                          {event.metadata && (event.metadata as Record<string, unknown>).insuredName
                            ? String((event.metadata as Record<string, unknown>).insuredName)
                            : event.metadata && (event.metadata as Record<string, unknown>).email
                              ? String((event.metadata as Record<string, unknown>).email)
                              : event.leadId 
                                ? `Lead: ${event.leadId.slice(0, 8)}...` 
                                : '—'}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-500">
                          {formatDateTime(event.createdAt)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
