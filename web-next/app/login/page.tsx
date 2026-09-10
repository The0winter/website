'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { leaveLogin } from '@/lib/login-navigation';
import './login.css';

export default function Login() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isEmailLogin, setIsEmailLogin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const result = await signIn(account.trim(), password);
      if (result.error) throw result.error;
      leaveLogin(router);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '登录失败，请重试');
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <button type="button" className="login-back" onClick={() => leaveLogin(router)}>
        <ArrowLeft aria-hidden="true" size={18} /> 返回
      </button>
      <section className="login-card" aria-label="登录九天小说">
        <Link href="/" className="login-brand" aria-label="九天小说首页">
          <Image src="/icon.png" alt="" width={36} height={36} priority />
          <h1>九天小说</h1>
        </Link>
        <div className="login-methods" role="group" aria-label="登录方式">
          {[false, true].map(email => (
            <button key={String(email)} type="button" aria-pressed={isEmailLogin === email}
              onClick={() => { setIsEmailLogin(email); setError(''); }}>
              {email ? '邮箱登录' : '用户名登录'}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} aria-busy={loading}>
          <div className="login-field">
            <label htmlFor="account">{isEmailLogin ? '邮箱地址' : '用户名'}</label>
            <input id="account" name="username" type={isEmailLogin ? 'email' : 'text'}
              autoComplete="username" autoCapitalize="none" spellCheck={false} required
              value={account} onChange={event => setAccount(event.target.value)}
              placeholder={isEmailLogin ? '请输入邮箱' : '请输入用户名'} />
          </div>
          <div className="login-field">
            <label htmlFor="password">密码</label>
            <div className="login-password">
              <input id="password" name="password" type={showPassword ? 'text' : 'password'}
                autoComplete="current-password" required value={password}
                onChange={event => setPassword(event.target.value)} placeholder="请输入密码" />
              <button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? '登录中…' : '立即登录'}
          </button>
        </form>
        <p className="login-register">还没有账号？<Link href="/register">注册账号</Link></p>
      </section>
    </div>
  );
}
