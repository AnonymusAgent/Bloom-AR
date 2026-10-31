'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from '@/components/ui/BrandMark';
import {
  LayoutDashboard, FileText, Users, Upload, Bell, ClipboardList, FileSearch,
  History, LogOut, ChevronLeft, ChevronRight, Building2, CheckSquare,
  ClipboardCheck, BarChart3, Briefcase, ShieldCheck, Code, MessageCircle,
  TrendingUp, PieChart, PenTool, ScanLine, Brain, Globe, Key,
  UserCircle, CreditCard, FileDown,
} from 'lucide-react';

interface User { id: string; email: string; firstName: string; lastName: string; role: string; isPlatformAdmin?: boolean; }
interface SidebarProps { user: User; collapsed: boolean; onToggle: () => void; onLogout: () => void; }

const ALL_ROLES = ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead', 'ar_executive', 'billing_user'];
const LEAD_ROLES = ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'];
const ADMIN_ROLES = ['administrator', 'supervisor', 'manager'];

const navigationItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
  { href: '/supervisor', icon: BarChart3, label: 'Supervisor Panel', roles: ADMIN_ROLES },
  { href: '/claims', icon: FileText, label: 'Workable AR', roles: ALL_ROLES },
  { href: '/authorizations', icon: ShieldCheck, label: 'Authorizations', roles: ALL_ROLES },
  { href: '/coding', icon: Code, label: 'Coding Queue', roles: ALL_ROLES },
  { href: '/tasks', icon: CheckSquare, label: 'Billing Tasks', roles: ALL_ROLES },
  { href: '/chat', icon: MessageCircle, label: 'Team Chat', roles: ALL_ROLES },
  { href: '/practices', icon: Building2, label: 'Practices', roles: ADMIN_ROLES },
  { href: '/signoffs', icon: ClipboardCheck, label: 'Sign-offs', roles: ALL_ROLES },
  { href: '/productivity', icon: TrendingUp, label: 'Productivity', roles: ADMIN_ROLES },
  { href: '/reports', icon: PieChart, label: 'Reports & Export', roles: ADMIN_ROLES },
  { href: '/ai-analysis', icon: Brain, label: 'AI Denial Analysis', roles: ALL_ROLES },
  { href: '/ocr', icon: ScanLine, label: 'OCR Scanner', roles: ALL_ROLES },
  { href: '/e-signatures', icon: PenTool, label: 'E-Signatures', roles: ALL_ROLES },
  { href: '/payer-portals', icon: Globe, label: 'Payer Portals', roles: ADMIN_ROLES },
  { href: '/patients', icon: UserCircle, label: 'Patients', roles: ALL_ROLES },
  { href: '/payments', icon: CreditCard, label: 'Payments', roles: ALL_ROLES },
  { href: '/era', icon: FileDown, label: 'ERA Processing', roles: ADMIN_ROLES },
  { href: '/upload', icon: Upload, label: 'Upload Files', roles: [...ADMIN_ROLES, 'senior_lead'] },
  { href: '/work-queue', icon: ClipboardList, label: 'Work Queue', roles: ['ar_executive', 'billing_user'] },
  { href: '/review', icon: FileSearch, label: 'Review', roles: LEAD_ROLES },
  { href: '/users', icon: Users, label: 'Users', roles: ['administrator'] },
  { href: '/denial-codes', icon: Briefcase, label: 'Denial Codes', roles: ALL_ROLES },
  { href: '/audit-logs', icon: History, label: 'Audit Logs', roles: ADMIN_ROLES },
  { href: '/notifications', icon: Bell, label: 'Notifications', roles: ALL_ROLES },
  { href: '/profile', icon: UserCircle, label: 'My Profile & Settings', roles: ALL_ROLES },
  { href: '/settings/account', icon: UserCircle, label: 'Account Settings', roles: ALL_ROLES },
  { href: '/settings/organization', icon: Building2, label: 'Organization Settings', roles: ALL_ROLES },
  { href: '/settings/billing', icon: CreditCard, label: 'Billing & Plan', roles: ALL_ROLES },
  { href: '/admin/platform', icon: Globe, label: 'Website & Platform Admin', roles: ALL_ROLES, platformAdminOnly: true },
];

export function Sidebar({ user, collapsed, onToggle, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const filteredNav = navigationItems.filter(item => item.roles.includes(user.role) && (!(item as {platformAdminOnly?: boolean}).platformAdminOnly || user.isPlatformAdmin));

  return (
    <aside className={`fixed left-0 top-0 h-full bg-[#0F2D52] text-white transition-all duration-300 z-40 ${collapsed ? 'w-[60px]' : 'w-[240px]'}`}>
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center justify-between h-14 px-3 border-b border-white/10">
          {!collapsed && (
            <div className="flex items-center gap-2.5">
              <BrandMark size="sm" />
              <span className="font-bold text-sm tracking-tight">BloomAR Manager</span>
            </div>
          )}
          <button onClick={onToggle} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto scrollbar-thin">
          <ul className="space-y-0.5 px-2">
            {filteredNav.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link href={item.href}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150 ${
                      isActive
                        ? 'bg-[#2563EB] text-white font-semibold shadow-sm'
                        : 'text-white/60 hover:bg-white/8 hover:text-white'
                    }`}
                    title={collapsed ? item.label : undefined}>
                    <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Logout */}
        <div className="border-t border-white/10 p-2">
          <button onClick={onLogout}
            className={`flex items-center gap-2.5 px-2.5 py-2 w-full rounded-lg text-white/50 hover:bg-white/8 hover:text-white transition-colors text-[13px] ${collapsed ? 'justify-center' : ''}`}>
            <LogOut className="w-[18px] h-[18px]" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
