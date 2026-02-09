'use client'; 

import { useState, useEffect } from 'react'; 
import { useRouter } from 'next/navigation'; 
import { useAuth } from '@/contexts/AuthContext'; 

export default function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  
  const [error, setError] = useState('');
  // ✅ 新增：成功提示状态
  const [success, setSuccess] = useState(''); 
  const [loading, setLoading] = useState(false);
  
  const { register, signIn } = useAuth();
  const router = useRouter(); 

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async () => {
    if (!email || !email.includes('@')) {
      setError('请输入有效的邮箱地址');
      return;
    }
    
    try {
      setError('');
      setSuccess(''); // 发送前清空之前的提示
      
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '发送失败');
      
      setCountdown(60); 
      
      // ✅ 修改：不再弹 alert，而是设置页面内的成功状态
      setSuccess('验证码已发送至您的邮箱，请查收！');
      
      // 3秒后自动关闭提示，体验更好
      setTimeout(() => setSuccess(''), 3000);

    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      return setError('两次输入的密码不一致');
    }
    if (!code) { 
      return setError('请输入验证码');
    }

    try {
      setError('');
      setLoading(true);

      await register(username, email, password, code);
      await signIn(email, password);

      router.push('/'); 
    } catch (err: any) { 
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
       <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-lg shadow-md">
         <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900">注册账户</h2>
         </div>
         
         <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            
            {/* ✅ 新增：成功提示框 (仅在 success 有值时显示) */}
            {success && (
              <div className="rounded-md bg-green-50 p-4 border border-green-200 animate-fade-in-down">
                <div className="flex">
                  <div className="flex-shrink-0">
                    {/* 一个绿色的小勾图标 */}
                    <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-green-800">
                      {success}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {/* 用户名 */}
              <div>
                <label htmlFor="username" className="sr-only">用户名</label>
                <input
                  id="username"
                  type="text"
                  required
                  className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              {/* 邮箱 */}
              <div>
                <label htmlFor="email" className="sr-only">邮箱地址</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="off"
                  className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="邮箱地址"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {/* 验证码输入框 + 按钮 */}
              <div className="flex gap-2">
                <div className="relative flex-grow">
                  <label htmlFor="code" className="sr-only">验证码</label>
                  <input
                    id="code"
                    type="text"
                    required
                    className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                    placeholder="邮箱验证码"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={countdown > 0}
                  className="whitespace-nowrap px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                </button>
              </div>

              {/* 密码 */}
              <div>
                <label htmlFor="password" className="sr-only">密码</label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="off"
                  className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {/* 确认密码 */}
              <div>
                <label htmlFor="confirm-password" className="sr-only">确认密码</label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="确认密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>

            {error && <div className="text-red-500 text-sm text-center">{error}</div>}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? '注册中...' : '注册'}
              </button>
            </div>
         </form>
       </div>
    </div>
  );
}