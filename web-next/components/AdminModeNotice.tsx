'use client';

import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function AdminModeNotice() {
  const { adminMode } = useAuth();
  if (!adminMode) return null;
  return <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" data-admin-mode="true">
    <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true"/>
    <div><p className="font-semibold">管理员模式 <span className="ml-1 text-xs font-normal">已开启</span></p><p className="mt-1 text-xs opacity-70">阅读免广告，管理员登录后自动生效</p></div>
  </div>;
}
