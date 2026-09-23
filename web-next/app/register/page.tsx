'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { safeFetch as fetch } from '@/lib/request';
import { useAuth } from '@/contexts/AuthContext';
import { leaveRegistration, registrationLogin } from '@/lib/register-navigation';
import './register.css';

export default function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async () => {
    if (sending || countdown > 0 || loading) return;
    const recipient = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    setError('');
    setSentEmail('');
    setSending(true);
    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recipient }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || '验证码发送失败，请重试');
      setCountdown(60);
      setSentEmail(recipient);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '验证码发送失败，请重试');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || sending) return;
    if (!username.trim()) return setError('请输入用户名');
    if (password !== confirmPassword) return setError('两次输入的密码不一致');
    setError('');
    setLoading(true);
    try {
      const result = await register(username.trim(), email.trim(), password, code.trim());
      if (result.error) throw result.error;
      router.replace('/');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '注册失败，请重试');
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <button type="button" className="register-back" onClick={() => leaveRegistration(router)}>
        <ArrowLeft size={18} aria-hidden="true" /> 返回
      </button>
      <section className="register-card" aria-labelledby="register-title">
        <header className="register-heading">
          <Link href="/" className="register-brand" aria-label="九天小说首页">
            <Image src="/icon.png" alt="" width={32} height={32} priority />
            <span>九天小说</span>
          </Link>
          <h1 id="register-title">注册账号</h1>
          <p>收藏喜欢的小说，随时接着读。</p>
        </header>
        <form onSubmit={handleSubmit} aria-busy={loading}>
          <div className="register-field">
            <label htmlFor="username">用户名</label>
            <input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none"
              maxLength={40} spellCheck={false} required placeholder="取一个喜欢的名字"
              value={username} onChange={event => setUsername(event.target.value)} />
          </div>
          <div className="register-field">
            <label htmlFor="email">邮箱地址</label>
            <input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none"
              spellCheck={false} required placeholder="用于接收注册验证码"
              value={email} onChange={event => setEmail(event.target.value)} />
          </div>
          <div className="register-field">
            <label htmlFor="code">邮箱验证码</label>
            <div className="register-code-row">
              <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
                maxLength={6} pattern="[0-9]{6}" required placeholder="6 位验证码" aria-describedby="register-code-hint"
                value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
              <button type="button" className="register-send" onClick={handleSendCode}
                disabled={sending || countdown > 0 || loading} aria-busy={sending}>
                {sending ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
              </button>
            </div>
            <p className="register-hint" id="register-code-hint">验证码有效期为 5 分钟</p>
            {sentEmail === email.trim() && sentEmail && <p className="register-success" role="status">
              <CheckCircle2 size={15} aria-hidden="true" /> 验证码已发送，请查收邮箱
            </p>}
          </div>
          <div className="register-field">
            <label htmlFor="password">密码</label>
            <div className="register-password">
              <input id="password" name="password" type={showPassword ? 'text' : 'password'}
                autoComplete="new-password" minLength={8} required placeholder="至少 8 个字符"
                value={password} onChange={event => setPassword(event.target.value)} />
              <button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className="register-field">
            <label htmlFor="confirm-password">确认密码</label>
            <input id="confirm-password" name="confirm-password" type={showPassword ? 'text' : 'password'}
              autoComplete="new-password" minLength={8} required placeholder="再次输入密码"
              value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
          </div>
          {error && <p className="register-error" role="alert">{error}</p>}
          <button type="submit" className="register-submit" disabled={loading || sending}>
            {loading ? '注册中…' : '注册账号'}
          </button>
        </form>
        <p className="register-login">已有账号？<button type="button" onClick={() => registrationLogin(router)}>立即登录</button></p>
      </section>
    </div>
  );
}
