'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '../../../layout';

interface IntakeForm {
  id: string;
  name: string;
  lob: string;
  version: string;
  definition: object;
  isActive: boolean;
  isPublic: boolean;
  publicToken: string | null;
  createdAt: string;
}

interface PublicSettings {
  formId: string;
  formName: string;
  isPublic: boolean;
  hasToken: boolean;
  publicUrl: string | null;
  embedCode: string | null;
  presentationMode: 'STANDARD' | 'FLASH' | 'BOTH';
  allowModeToggle: boolean;
}

export default function IntakeFormsPage() {
  const params = useParams();
  const agencyId = params.id as string;
  const { authFetch } = useAdminAuth();

  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newForm, setNewForm] = useState({ lob: 'COMMERCIAL_GL', version: '1.0', name: 'Commercial GL Intake', definition: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [parseError, setParseError] = useState('');
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  const [isLoadingPublic, setIsLoadingPublic] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchForms();
  }, [agencyId]);

  const fetchForms = async () => {
    try {
      const res = await authFetch(`/api/super-admin/agencies/${agencyId}/intake-forms`);
      if (res.ok) {
        const data = await res.json();
        setForms(data.forms);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const createForm = async () => {
    if (!newForm.definition.trim()) return;
    setParseError('');
    
    let parsedDef;
    try {
      parsedDef = JSON.parse(newForm.definition);
    } catch {
      setParseError('Invalid JSON');
      return;
    }

    setIsCreating(true);
    try {
      const res = await authFetch(`/api/super-admin/agencies/${agencyId}/intake-forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newForm.name,
          lob: newForm.lob,
          version: newForm.version,
          definition: parsedDef,
        }),
      });
      if (res.ok) {
        setNewForm({ lob: 'COMMERCIAL_GL', version: '1.0', name: 'Commercial GL Intake', definition: '' });
        setShowCreate(false);
        fetchForms();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const toggleActive = async (formId: string, isActive: boolean) => {
    await authFetch(`/api/super-admin/agencies/${agencyId}/intake-forms/${formId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchForms();
  };

  const deleteForm = async (formId: string) => {
    if (!confirm('Are you sure you want to delete this form?')) return;
    await authFetch(`/api/super-admin/agencies/${agencyId}/intake-forms/${formId}`, {
      method: 'DELETE',
    });
    fetchForms();
  };

  const fetchPublicSettings = async (formId: string) => {
    setIsLoadingPublic(true);
    setSelectedFormId(formId);
    try {
      const res = await authFetch(`/api/intake-forms/${formId}/public-settings`);
      if (res.ok) {
        const data = await res.json();
        setPublicSettings(data);
      }
    } finally {
      setIsLoadingPublic(false);
    }
  };

  const togglePublicAccess = async (isPublic: boolean) => {
    if (!selectedFormId) return;
    setIsLoadingPublic(true);
    try {
      const res = await authFetch(`/api/intake-forms/${selectedFormId}/public-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic }),
      });
      if (res.ok) {
        const data = await res.json();
        setPublicSettings(data);
        fetchForms();
      }
    } finally {
      setIsLoadingPublic(false);
    }
  };

  const regenerateToken = async () => {
    if (!selectedFormId) return;
    if (!confirm('This will invalidate the current public link. Continue?')) return;
    setIsLoadingPublic(true);
    try {
      const res = await authFetch(`/api/intake-forms/${selectedFormId}/public-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerateToken: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setPublicSettings(data);
      }
    } finally {
      setIsLoadingPublic(false);
    }
  };

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch {
      alert('Failed to copy to clipboard');
    }
  };

  const updatePresentationMode = async (mode: 'STANDARD' | 'FLASH' | 'BOTH') => {
    if (!selectedFormId) return;
    setIsLoadingPublic(true);
    try {
      const res = await authFetch(`/api/intake-forms/${selectedFormId}/public-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presentationMode: mode }),
      });
      if (res.ok) {
        const data = await res.json();
        setPublicSettings(data);
      }
    } finally {
      setIsLoadingPublic(false);
    }
  };

  const updateAllowModeToggle = async (allow: boolean) => {
    if (!selectedFormId) return;
    setIsLoadingPublic(true);
    try {
      const res = await authFetch(`/api/intake-forms/${selectedFormId}/public-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowModeToggle: allow }),
      });
      if (res.ok) {
        const data = await res.json();
        setPublicSettings(data);
      }
    } finally {
      setIsLoadingPublic(false);
    }
  };

  const closePublicSettings = () => {
    setSelectedFormId(null);
    setPublicSettings(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const sampleDefinition = JSON.stringify({
    title: "Commercial GL Application",
    sections: [
      {
        id: "business_info",
        title: "Business Information",
        fields: [
          { id: "company_name", type: "text", label: "Company Name", required: true },
          { id: "years_in_business", type: "number", label: "Years in Business", required: true },
          { id: "industry", type: "select", label: "Industry", options: ["retail", "office", "manufacturing"] }
        ]
      }
    ]
  }, null, 2);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href={`/super-admin/agencies/${agencyId}`} className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block" data-testid="link-back">
              Back to Agency
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">Intake Forms</h1>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            data-testid="button-create"
          >
            Add Form
          </button>
        </div>

        {showCreate && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <h3 className="text-sm font-medium text-gray-900 mb-3">New Intake Form</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Form Name</label>
                <input
                  type="text"
                  value={newForm.name}
                  onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                  placeholder="e.g., Commercial GL Intake"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  data-testid="input-name"
                />
              </div>
              <div className="flex gap-3">
                <select
                  value={newForm.lob}
                  onChange={(e) => setNewForm({ ...newForm, lob: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  data-testid="select-lob"
                >
                  <option value="COMMERCIAL_GL">Commercial GL</option>
                </select>
                <input
                  type="text"
                  value={newForm.version}
                  onChange={(e) => setNewForm({ ...newForm, version: e.target.value })}
                  placeholder="Version (e.g., 1.0)"
                  className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  data-testid="input-version"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Definition JSON</label>
                <textarea
                  value={newForm.definition}
                  onChange={(e) => { setNewForm({ ...newForm, definition: e.target.value }); setParseError(''); }}
                  placeholder={sampleDefinition}
                  rows={10}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  data-testid="input-definition"
                />
                {parseError && <p className="text-xs text-red-600 mt-1">{parseError}</p>}
              </div>
              <button
                onClick={createForm}
                disabled={isCreating || !newForm.definition.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
                data-testid="button-save"
              >
                {isCreating ? 'Adding...' : 'Add Form'}
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name / LOB</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Public</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {forms.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No intake forms yet. Add your first form above.
                  </td>
                </tr>
              ) : (
                forms.map((form) => (
                  <tr key={form.id} className="hover:bg-gray-50" data-testid={`row-form-${form.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{form.name || 'Unnamed Form'}</div>
                      <div className="text-xs text-gray-500">{form.lob}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{form.version}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActive(form.id, form.isActive)}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          form.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}
                        data-testid={`button-toggle-${form.id}`}
                      >
                        {form.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => fetchPublicSettings(form.id)}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          form.isPublic ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
                        }`}
                        data-testid={`button-public-${form.id}`}
                      >
                        {form.isPublic ? 'Public' : 'Private'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(form.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => fetchPublicSettings(form.id)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800"
                        data-testid={`button-settings-${form.id}`}
                      >
                        Settings
                      </button>
                      <button
                        onClick={() => deleteForm(form.id)}
                        className="text-xs font-medium text-red-600 hover:text-red-800"
                        data-testid={`button-delete-${form.id}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Public Settings Modal */}
        {selectedFormId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Public Access Settings</h3>
                <button
                  onClick={closePublicSettings}
                  className="text-gray-400 hover:text-gray-600"
                  data-testid="button-close-modal"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="px-6 py-4">
                {isLoadingPublic ? (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : publicSettings ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-gray-900">Allow Public Submissions</h4>
                        <p className="text-sm text-gray-500">Enable external users to submit this form via a secure link</p>
                      </div>
                      <button
                        onClick={() => togglePublicAccess(!publicSettings.isPublic)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          publicSettings.isPublic ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                        data-testid="toggle-public-access"
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            publicSettings.isPublic ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Presentation Mode Section */}
                    <div className="border-t border-gray-200 pt-6">
                      <h4 className="font-medium text-gray-900 mb-3">Presentation Mode</h4>
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <button
                          onClick={() => updatePresentationMode('STANDARD')}
                          className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors ${
                            publicSettings.presentationMode === 'STANDARD'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                          data-testid="button-mode-standard"
                        >
                          Standard
                        </button>
                        <button
                          onClick={() => updatePresentationMode('FLASH')}
                          className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors ${
                            publicSettings.presentationMode === 'FLASH'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                          data-testid="button-mode-flash"
                        >
                          Flash
                        </button>
                        <button
                          onClick={() => updatePresentationMode('BOTH')}
                          className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors ${
                            publicSettings.presentationMode === 'BOTH'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                          data-testid="button-mode-both"
                        >
                          Both
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mb-4">
                        {publicSettings.presentationMode === 'STANDARD' && 'Show all questions on one page'}
                        {publicSettings.presentationMode === 'FLASH' && 'Show one question at a time (flash-card style)'}
                        {publicSettings.presentationMode === 'BOTH' && 'Allow user to choose between modes'}
                      </p>

                      {(publicSettings.presentationMode === 'BOTH' || publicSettings.allowModeToggle) && (
                        <div className="flex items-center justify-between py-3 px-3 bg-gray-50 rounded-md">
                          <div>
                            <span className="text-sm font-medium text-gray-700">Allow Mode Toggle</span>
                            <p className="text-xs text-gray-500">Let users switch between modes</p>
                          </div>
                          <button
                            onClick={() => updateAllowModeToggle(!publicSettings.allowModeToggle)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              publicSettings.allowModeToggle ? 'bg-blue-600' : 'bg-gray-200'
                            }`}
                            data-testid="toggle-allow-mode-toggle"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                publicSettings.allowModeToggle ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      )}
                    </div>

                    {publicSettings.isPublic && publicSettings.publicUrl && (
                      <>
                        <div className="border-t border-gray-200 pt-6">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Public Link</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              readOnly
                              value={publicSettings.publicUrl}
                              className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-md"
                              data-testid="input-public-url"
                            />
                            <button
                              onClick={() => copyToClipboard(publicSettings.publicUrl!, 'url')}
                              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                              data-testid="button-copy-url"
                            >
                              {copySuccess === 'url' ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Embed Code</label>
                          <div className="flex gap-2">
                            <textarea
                              readOnly
                              value={publicSettings.embedCode || ''}
                              rows={2}
                              className="flex-1 px-3 py-2 text-xs font-mono bg-gray-50 border border-gray-300 rounded-md resize-none"
                              data-testid="input-embed-code"
                            />
                            <button
                              onClick={() => copyToClipboard(publicSettings.embedCode!, 'embed')}
                              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                              data-testid="button-copy-embed"
                            >
                              {copySuccess === 'embed' ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-gray-200">
                          <button
                            onClick={regenerateToken}
                            className="text-sm font-medium text-orange-600 hover:text-orange-800"
                            data-testid="button-regenerate-token"
                          >
                            Regenerate Link (invalidates current link)
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">Failed to load settings</div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
                <button
                  onClick={closePublicSettings}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  data-testid="button-done"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
