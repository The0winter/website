'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
// 👇 引入 Eye (睁眼) 和 EyeOff (闭眼) 图标
import { BookOpen, Mail, User, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // 👇 新增状态：控制密码是否显示
  const [showPassword, setShowPassword] = useState(false);
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isEmailLogin, setIsEmailLogin] = useState(true);
  
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
         router.push('/');
      }
    } catch (err: any) {
      setError(err.message || '登录失败');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        
        <div className="text-center">
          <Link href="/" className="inline-flex items-center justify-center space-x-2">
            <BookOpen className="h-10 w-10 text-blue-600" />
            <span className="text-2xl font-bold text-gray-900">九天小说</span>
          </Link>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">欢迎回来</h2>
          <p className="mt-2 text-gray-600">登录你的账户</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-5"> {/* 稍微加大一点间距 space-y-4 -> space-y-5 */}
            
            {/* 账号/邮箱输入框 */}
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
                  // 👇 修改点：text-gray-900 (深色) font-medium (加粗)
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-medium placeholder-gray-400"
                  placeholder={isEmailLogin ? '请输入邮箱' : '请输入用户名'}
                />
              </div>
              <div className="mt-1 text-right">
                <button
                  type="button"
                  onClick={() => setIsEmailLogin(!isEmailLogin)}
                  className="text-sm text-blue-600 hover:text-blue-500 font-medium"
                >
                  {isEmailLogin ? '使用用户名登录' : '使用邮箱登录'}
                </button>
              </div>
            </div>

            {/* 密码输入框 (带显隐切换) */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                密码
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  // 👇 关键：根据状态切换 text 或 password
                  type={showPassword ? 'text' : 'password'} 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  // 👇 修改点：text-gray-900 font-medium, 并且加了 pr-10 给右边图标留位置
                  className="block w-full pl-3 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-medium placeholder-gray-400"
                  placeholder="请输入密码"
                />
                
                {/* 👇 右侧的小眼睛按钮 */}
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
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '登录中...' : '登录'}
          </button>

          <div className="text-center text-sm">
            <span className="text-gray-600">还没有账号？ </span>
            <Link href="/register" className="font-medium text-blue-600 hover:text-blue-500">
              去注册
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}