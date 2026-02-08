'use client'; 

import { useState, useEffect } from 'react'; // ✅ 引入 useEffect
import { useRouter } from 'next/navigation'; 
import { useAuth } from '@/contexts/AuthContext'; 

export default function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // ✅ 新增状态
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // 1. 取出 register 和 signIn
  const { register, signIn } = useAuth();
  const router = useRouter(); 

  // ✅ 新增：倒计时逻辑
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // ✅ 新增：发送验证码函数
  const handleSendCode = async () => {
    if (!email || !email.includes('@')) {
      setError('请输入有效的邮箱地址');
      return;
    }
    
    try {
      setError('');
      // 注意：确保这个 URL 是你后端的地址
      const res = await fetch('http://localhost:5000/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '发送失败');
      
      setCountdown(60); // 开始60秒倒计时
      alert('验证码已发送，请查收邮件！');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      return setError('两次输入的密码不一致');
    }
    if (!code) { // ✅ 检查验证码
      return setError('请输入验证码');
    }

    try {
      setError('');
      setLoading(true);

      // ✅ 2. 传入 code 给 register
      await register(username, email, password, code);
      
      // 注册成功后自动登录
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
         {/* 标题部分省略，保持原样即可 */}
         <div className="text-center">
            <h2 className="text-3xl font-bold">注册账户</h2>
         </div>
         
         <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
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
                  className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="邮箱地址"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {/* ✅ 新增：验证码输入框 + 按钮 */}
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
                  className="whitespace-nowrap px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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