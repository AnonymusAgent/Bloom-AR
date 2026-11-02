'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge, RoleBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import {
  Search, Plus, Edit, UserCheck, UserX, Key, Shield, Mail, ChevronLeft,
  ChevronRight, MoreVertical, Users, CheckCircle, XCircle, AlertTriangle,
} from 'lucide-react';

interface UserRecord {
  id: string; email: string; firstName: string; lastName: string; role: string;
  isActive: boolean; teamLeadId: string | null; createdAt: string; lastLoginAt: string | null;
}

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior_lead', label: 'Senior Lead' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'ar_executive', label: 'AR Executive' },
  { value: 'billing_user', label: 'Billing User' },
];

const ASSIGNABLE_ROLES = [
  { value: 'administrator', label: 'Administrator' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior_lead', label: 'Senior Lead' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'ar_executive', label: 'AR Executive' },
  { value: 'billing_user', label: 'Billing User' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export default function UsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [teamLeads, setTeamLeads] = useState<UserRecord[]>([]);

  // Create / Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    email: '', password: '', confirmPassword: '', firstName: '', lastName: '',
    role: 'ar_executive', teamLeadId: '',
  });

  // Reset password modal
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetUser, setResetUser] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPw, setConfirmNewPw] = useState('');
  const [resetError, setResetError] = useState('');

  // Action menu
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0, admins: 0 });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('isActive', statusFilter);

      const res = await fetch(`/api/users?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users);
        setTeamLeads(data.users.filter((u: UserRecord) => ['team_lead', 'senior_lead'].includes(u.role) && u.isActive));

        // Calculate stats from full list (fetch without filters for stats)
        const allRes = await fetch('/api/users', { credentials: 'include' });
        const allData = await allRes.json();
        if (allRes.ok) {
          const all = allData.users as UserRecord[];
          setStats({
            total: all.length,
            active: all.filter(u => u.isActive).length,
            inactive: all.filter(u => !u.isActive).length,
            admins: all.filter(u => u.role === 'administrator').length,
          });
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openCreateModal = () => {
    setEditingUser(null);
    setForm({ email: '', password: '', confirmPassword: '', firstName: '', lastName: '', role: 'ar_executive', teamLeadId: '' });
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (user: UserRecord) => {
    setEditingUser(user);
    setForm({
      email: user.email, password: '', confirmPassword: '',
      firstName: user.firstName, lastName: user.lastName,
      role: user.role, teamLeadId: user.teamLeadId || '',
    });
    setFormError('');
    setShowModal(true);
  };

  const openResetPwModal = (user: UserRecord) => {
    setResetUser(user);
    setNewPassword('');
    setConfirmNewPw('');
    setResetError('');
    setShowResetPw(true);
    setOpenMenuId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.firstName || !form.lastName || !form.role) {
      setFormError('First name, last name, and role are required.'); return;
    }

    if (!editingUser) {
      if (!form.email || !form.password) { setFormError('Email and password are required for new users.'); return; }
      if (form.password.length < 6) { setFormError('Password must be at least 6 characters.'); return; }
      if (form.password !== form.confirmPassword) { setFormError('Passwords do not match.'); return; }
    }

    setSaving(true);
    try {
      if (editingUser) {
        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({
            firstName: form.firstName, lastName: form.lastName, role: form.role,
            teamLeadId: form.teamLeadId || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error || 'Failed to update user.'); return; }
      } else {
        const res = await fetch('/api/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({
            email: form.email, password: form.password,
            firstName: form.firstName, lastName: form.lastName,
            role: form.role, teamLeadId: form.teamLeadId || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error || 'Failed to create user.'); return; }
      }
      setShowModal(false);
      fetchUsers();
    } catch (e) { setFormError('An error occurred.'); }
    finally { setSaving(false); }
  };

  const handleResetPassword = async () => {
    setResetError('');
    if (!newPassword || newPassword.length < 6) { setResetError('Password must be at least 6 characters.'); return; }
    if (newPassword !== confirmNewPw) { setResetError('Passwords do not match.'); return; }
    if (!resetUser) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/users/${resetUser.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ password: newPassword }),
      });
      if (res.ok) { setShowResetPw(false); } else { const d = await res.json(); setResetError(d.error || 'Failed.'); }
    } catch { setResetError('An error occurred.'); }
    finally { setSaving(false); }
  };

  const handleToggleActive = async (user: UserRecord) => {
    const action = user.isActive ? 'deactivate' : 'activate';
    if (!confirm(`Are you sure you want to ${action} ${user.firstName} ${user.lastName}?`)) return;
    try {
      await fetch(`/api/users/${user.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      fetchUsers();
    } catch (e) { console.error(e); }
    setOpenMenuId(null);
  };

  const fmtDate = (d: string | null) => {
    if (!d) return 'Never';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; }
  };

  return (
    <AppLayout title="User Management">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Total Users', value: stats.total, icon: Users, color: 'bg-blue-50 text-[#2563EB]' },
          { label: 'Active', value: stats.active, icon: CheckCircle, color: 'bg-emerald-50 text-[#16A34A]' },
          { label: 'Inactive', value: stats.inactive, icon: XCircle, color: 'bg-red-50 text-[#DC2626]' },
          { label: 'Administrators', value: stats.admins, icon: Shield, color: 'bg-purple-50 text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#E5E7EB] p-4 flex items-center gap-4">
            <div className={`p-2.5 rounded-lg ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div><p className="text-2xl font-bold text-slate-900">{s.value}</p><p className="text-xs text-[#64748B]">{s.label}</p></div>
          </div>
        ))}
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
            <input type="text" placeholder="Search by name or email..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] placeholder:text-[#64748B]" />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20">
            {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20">
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Button onClick={openCreateModal}><Plus className="w-4 h-4 mr-1.5" />Add User</Button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#F1F5F9] border-b border-[#E5E7EB]">
                {['USER', 'EMAIL', 'ROLE', 'TEAM LEAD', 'STATUS', 'LAST LOGIN', 'CREATED', 'ACTIONS'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center">
                  <div className="flex items-center justify-center gap-2 text-[#64748B]">
                    <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />Loading...
                  </div>
                </td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[#64748B]">No users found</td></tr>
              ) : users.map(user => {
                const tl = teamLeads.find(t => t.id === user.teamLeadId);
                return (
                  <tr key={user.id} className="border-b border-[#E5E7EB] hover:bg-[#F8FAFC] transition-colors">
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold ${user.isActive ? 'bg-gradient-to-br from-blue-400 to-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                          {user.firstName[0]}{user.lastName[0]}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{user.firstName} {user.lastName}</p>
                          {user.role === 'administrator' && <span className="text-[10px] text-purple-600 font-medium">ADMIN</span>}
                        </div>
                      </div>
                    </td>
                    {/* Email */}
                    <td className="px-4 py-3 text-sm text-slate-700">{user.email}</td>
                    {/* Role */}
                    <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                    {/* Team Lead */}
                    <td className="px-4 py-3 text-sm text-[#64748B]">{tl ? `${tl.firstName} ${tl.lastName}` : '—'}</td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${user.isActive ? 'bg-emerald-50 text-[#16A34A]' : 'bg-red-50 text-[#DC2626]'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? 'bg-[#16A34A]' : 'bg-[#DC2626]'}`} />
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {/* Last Login */}
                    <td className="px-4 py-3 text-sm text-[#64748B]">{fmtDate(user.lastLoginAt)}</td>
                    {/* Created */}
                    <td className="px-4 py-3 text-sm text-[#64748B]">{fmtDate(user.createdAt)}</td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button onClick={() => setOpenMenuId(openMenuId === user.id ? null : user.id)}
                          className="p-1.5 rounded-md hover:bg-[#F1F5F9] text-[#64748B] hover:text-slate-900 transition-colors">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openMenuId === user.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-xl border border-[#E5E7EB] z-50 py-1 overflow-hidden">
                              <button onClick={() => { openEditModal(user); setOpenMenuId(null); }}
                                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 hover:bg-[#F5F7FA] transition-colors">
                                <Edit className="w-4 h-4 text-[#64748B]" />Edit Details
                              </button>
                              <button onClick={() => openResetPwModal(user)}
                                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 hover:bg-[#F5F7FA] transition-colors">
                                <Key className="w-4 h-4 text-[#64748B]" />Reset Password
                              </button>
                              <div className="border-t border-[#E5E7EB] my-1" />
                              <button onClick={() => handleToggleActive(user)}
                                className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors ${user.isActive ? 'text-[#DC2626] hover:bg-red-50' : 'text-[#16A34A] hover:bg-emerald-50'}`}>
                                {user.isActive ? <><UserX className="w-4 h-4" />Deactivate</> : <><UserCheck className="w-4 h-4" />Activate</>}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#E5E7EB] bg-[#FAFBFC]">
          <p className="text-sm text-[#64748B]">Showing <span className="font-medium text-slate-900">{users.length}</span> users</p>
        </div>
      </div>

      {/* ========== CREATE / EDIT USER MODAL ========== */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingUser ? 'Edit User' : 'Create New User'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-[#DC2626]">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />{formError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input label="First Name *" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} required placeholder="e.g. John" />
            <Input label="Last Name *" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} required placeholder="e.g. Smith" />
          </div>

          <Input label="Email Address *" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            required={!editingUser} disabled={!!editingUser} placeholder="teammate@organization.com"
            helperText={editingUser ? 'Email cannot be changed after creation.' : undefined} />

          {!editingUser && (
            <div className="grid grid-cols-2 gap-4">
              <Input label="Password *" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required placeholder="Min 6 characters" />
              <Input label="Confirm Password *" type="password" value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} required placeholder="Re-enter password" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role *</label>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]">
                {ASSIGNABLE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {['ar_executive', 'billing_user'].includes(form.role) && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Team Lead</label>
                <select value={form.teamLeadId} onChange={e => setForm({ ...form, teamLeadId: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]">
                  <option value="">No Team Lead</option>
                  {teamLeads.map(tl => <option key={tl.id} value={tl.id}>{tl.firstName} {tl.lastName}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E5E7EB]">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>{editingUser ? 'Save Changes' : 'Create User'}</Button>
          </div>
        </form>
      </Modal>

      {/* ========== RESET PASSWORD MODAL ========== */}
      <Modal isOpen={showResetPw} onClose={() => setShowResetPw(false)} title="Reset Password">
        {resetUser && (
          <div className="space-y-4">
            <div className="p-3 bg-[#F5F7FA] rounded-lg">
              <p className="text-sm text-[#64748B]">Resetting password for:</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5">{resetUser.firstName} {resetUser.lastName} ({resetUser.email})</p>
            </div>

            {resetError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-[#DC2626]">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />{resetError}
              </div>
            )}

            <Input label="New Password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" />
            <Input label="Confirm New Password" type="password" value={confirmNewPw} onChange={e => setConfirmNewPw(e.target.value)} placeholder="Re-enter password" />

            <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E5E7EB]">
              <Button variant="secondary" onClick={() => setShowResetPw(false)}>Cancel</Button>
              <Button onClick={handleResetPassword} loading={saving}>Reset Password</Button>
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
