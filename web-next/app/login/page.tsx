'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
// 引入图标
import { BookOpen, Mail, User, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // ✅ 修改点 1：默认改为 false，即默认显示 "用户名" 登录
  const [isEmailLogin, setIsEmailLogin] = useState(false);
  
  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn(email, password);
      
      if (result && result.error) {
         setError(result.error.message || '登录失败');
         setLoading(false);
      } else {
         // 登录成功逻辑保持不变
         if (result && result.token) {
             localStorage.setItem('token', result.token);
             if (result.user) {
                localStorage.setItem('user', JSON.stringify(result.user));
             }
         }
         router.push('/');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '登录异常');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-lg"> {/* 加大圆角和阴影 */}
        
        {/* 顶部 Logo 区 */}
        <div className="text-center">
          <Link href="/" className="inline-flex items-center justify-center space-x-2">
            <BookOpen className="h-10 w-10 text-blue-600" />
            <span className="text-2xl font-bold text-gray-900">九天小说站站</span>
          </Link>
          <h2 className="mt-6 text-2xl font-bold text-gray-900">欢迎回来</h2>
        </div>

        {/* ✅ 修改点 2：美化后的切换 Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => setIsEmailLogin(false)}
            className={`flex-1 pb-4 text-sm font-medium text-center transition-colors relative ${
              !isEmailLogin 
                ? 'text-blue-600 border-b-2 border-blue-600' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center justify-center space-x-2">
              <User className="w-4 h-4" />
              <span>用户名登录</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setIsEmailLogin(true)}
            className={`flex-1 pb-4 text-sm font-medium text-center transition-colors relative ${
              isEmailLogin 
                ? 'text-blue-600 border-b-2 border-blue-600' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center justify-center space-x-2">
              <Mail className="w-4 h-4" />
              <span>邮箱登录</span>
            </div>
          </button>
        </div>

        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            
            {/* 账号/邮箱 输入框 (根据 Tab 状态自动变) */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                {isEmailLogin ? '邮箱地址' : '用户名'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  {isEmailLogin ? (
                    <Mail className="h-5 w-5 text-gray-400" />
                  ) : (
                    <User className="h-5 w-5 text-gray-400" />
                  )}
                </div>
                <input
                  id="email"
                  name="email"
                  type={isEmailLogin ? 'email' : 'text'}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-900 placeholder-gray-400 transition-all"
                  placeholder={isEmailLogin ? '请输入邮箱' : '请输入用户名'}
                />
              </div>
            </div>

            {/* 密码输入框 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  密码
                </label>
                {/* 如果你有忘记密码页面，可以在这里加 Link */}
                <Link href="#" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                  忘记密码?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-3 pr-10 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-900 placeholder-gray-400 transition-all"
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-70 disabled:cursor-not-allowed transition-all"
          >
            {loading ? '登录中...' : '立即登录'}
          </button>

          <div className="text-center text-sm">
            <span className="text-gray-600">还没有账号？ </span>
            <Link href="/register" className="font-bold text-blue-600 hover:text-blue-500 hover:underline">
              现在注册！
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}