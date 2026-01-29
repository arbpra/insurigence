'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '../layout';
import { 
  Users, ArrowLeft, Plus, Search, X, Check, 
  Building2, Shield, User as UserIcon, MoreVertical
} from 'lucide-react';

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'AGENT';
  isActive: boolean;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  agency: { id: string; name: string } | null;
  _count: { leads: number };
}

interface Agency {
  id: string;
  name: string;
}

interface Stats {
  totalUsers: number;
  activeUsers: number;
  superAdmins: number;
  admins: number;
  agents: number;
}

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Agency Admin',
  AGENT: 'Agent',
};

const roleColors: Record<string, { bg: string; text: string }> = {
  SUPER_ADMIN: { bg: 'bg-purple-100', text: 'text-purple-700' },
  ADMIN: { bg: 'bg-blue-100', text: 'text-blue-700' },
  AGENT: { bg: 'bg-gray-100', text: 'text-gray-700' },
};

export default function UsersPage() {
  const searchParams = useSearchParams();
  const showCreate = searchParams.get('create') === 'true';
  const { authFetch } = useAdminAuth();
  
  const [users, setUsers] = useState<User[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  
  const [showCreateModal, setShowCreateModal] = useState(showCreate);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdUserInfo, setCreatedUserInfo] = useState<{ email: string; tempPassword: string } | null>(null);
  const [newUser, setNewUser] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'AGENT' as 'SUPER_ADMIN' | 'ADMIN' | 'AGENT',
    agencyId: '',
  });

  const fetchUsers = async () => {
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (agencyFilter) params.set('agencyId', agencyFilter);
      
      const res = await authFetch(`/api/super-admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setStats(data.stats);
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
    fetchUsers();
    fetchAgencies();
  }, [searchTerm, roleFilter, statusFilter, agencyFilter]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError('');

    try {
      const res = await authFetch('/api/super-admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });

      const data = await res.json();
      
      if (res.ok) {
        setShowCreateModal(false);
        setCreatedUserInfo({ email: data.user.email, tempPassword: data.tempPassword });
        setNewUser({ email: '', firstName: '', lastName: '', role: 'AGENT', agencyId: '' });
        fetchUsers();
      } else {
        setCreateError(data.error || 'Failed to create user');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleStatus = async (userId: string, currentStatus: boolean) => {
    const res = await authFetch(`/api/super-admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !currentStatus }),
    });

    if (res.ok) {
      fetchUsers();
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString();
  };

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
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#0D2137' }}>User Management</h1>
              <p className="text-sm text-gray-500">Manage users across all agencies</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="stat-total-users">
              <p className="text-xs text-gray-500">Total Users</p>
              <p className="text-2xl font-bold" style={{ color: '#0D2137' }}>{stats.totalUsers}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="stat-active-users">
              <p className="text-xs text-gray-500">Active Users</p>
              <p className="text-2xl font-bold" style={{ color: '#00E6A7' }}>{stats.activeUsers}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="stat-super-admins">
              <p className="text-xs text-gray-500">Super Admins</p>
              <p className="text-2xl font-bold text-purple-600">{stats.superAdmins}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="stat-agency-admins">
              <p className="text-xs text-gray-500">Agency Admins</p>
              <p className="text-2xl font-bold text-blue-600">{stats.admins}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="stat-agents">
              <p className="text-xs text-gray-500">Agents</p>
              <p className="text-2xl font-bold text-gray-600">{stats.agents}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                data-testid="input-search-users"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
              data-testid="select-role-filter"
            >
              <option value="">All Roles</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="ADMIN">Agency Admin</option>
              <option value="AGENT">Agent</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
              data-testid="select-status-filter"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
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
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: '#00E6A7' }}
              data-testid="button-create-user"
            >
              <Plus className="w-4 h-4" />
              Add User
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">User</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Role</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Agency</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Last Login</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Created</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">Loading...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">No users found</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50" data-testid={`row-user-${user.id}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: '#0D213715' }}>
                            <UserIcon className="w-4 h-4" style={{ color: '#0D2137' }} />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">
                              {user.firstName || user.lastName
                                ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                                : 'Unnamed User'}
                            </p>
                            <p className="text-xs text-gray-500">{user.email || 'No email'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${roleColors[user.role]?.bg} ${roleColors[user.role]?.text}`}>
                          {user.role === 'SUPER_ADMIN' && <Shield className="w-3 h-3" />}
                          {roleLabels[user.role] || user.role}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {user.agency ? (
                          <Link
                            href={`/super-admin/agencies/${user.agency.id}`}
                            className="text-sm text-gray-900 hover:underline flex items-center gap-1"
                          >
                            <Building2 className="w-3 h-3" />
                            {user.agency.name}
                          </Link>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500">
                        {formatDate(user.lastLoginAt)}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <button
                          onClick={() => handleToggleStatus(user.id, user.isActive)}
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded text-xs font-medium ${
                            user.isActive 
                              ? 'bg-red-50 text-red-600 hover:bg-red-100' 
                              : 'bg-green-50 text-green-600 hover:bg-green-100'
                          }`}
                          data-testid={`button-toggle-status-${user.id}`}
                        >
                          {user.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Add New User</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              {createError && (
                <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">{createError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="input-user-email"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                  <input
                    type="text"
                    value={newUser.firstName}
                    onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                    data-testid="input-user-firstname"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={newUser.lastName}
                    onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                    data-testid="input-user-lastname"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as 'SUPER_ADMIN' | 'ADMIN' | 'AGENT' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="select-user-role"
                >
                  <option value="AGENT">Agent</option>
                  <option value="ADMIN">Agency Admin</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
              </div>
              {newUser.role !== 'SUPER_ADMIN' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agency *</label>
                  <select
                    value={newUser.agencyId}
                    onChange={(e) => setNewUser({ ...newUser, agencyId: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                    data-testid="select-user-agency"
                  >
                    <option value="">Select an agency</option>
                    {agencies.map((agency) => (
                      <option key={agency.id} value={agency.id}>{agency.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                  style={{ backgroundColor: '#00E6A7' }}
                  data-testid="button-submit-user"
                >
                  {isCreating ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createdUserInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">User Created Successfully</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 mb-2">
                  The user account has been created. Please share these credentials securely with the user:
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-green-700">Email:</span>
                    <code className="px-2 py-1 bg-green-100 rounded text-sm font-mono" data-testid="text-created-email">
                      {createdUserInfo.email}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-green-700">Temporary Password:</span>
                    <code className="px-2 py-1 bg-green-100 rounded text-sm font-mono" data-testid="text-temp-password">
                      {createdUserInfo.tempPassword}
                    </code>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                The user will be required to change their password upon first login.
              </p>
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setCreatedUserInfo(null)}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg"
                  style={{ backgroundColor: '#00E6A7' }}
                  data-testid="button-close-password-modal"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
