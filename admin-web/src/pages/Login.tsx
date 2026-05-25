import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../cloudbase';

const SHOP_NAME = import.meta.env.VITE_SHOP_NAME || 'Open Shop';

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: authError } = await auth.signInWithPassword({ username, password });
    setLoading(false);
    if (authError) {
      setError('用户名或密码错误');
      return;
    }
    navigate('/dashboard', { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
      <div className="bg-white rounded-lg border border-[#E5E5E5] p-10 w-[380px]">
        <h1 className="text-xl font-semibold text-[#1A1A1A] mb-1">{SHOP_NAME}</h1>
        <p className="text-sm text-[#6B7280] mb-8">管理后台</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-[#E5E5E5] rounded px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
              placeholder="输入用户名"
              required
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-[#E5E5E5] rounded px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
              placeholder="输入密码"
              required
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-hover text-white rounded py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
