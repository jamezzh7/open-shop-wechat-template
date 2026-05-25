import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { auth } from '../cloudbase';

const NAV = [
  { to: '/dashboard', label: '仪表板' },
  { to: '/orders',    label: '订单管理' },
  { to: '/products',  label: '商品管理' },
  { to: '/shipping',  label: '运费管理' },
];

const SHOP_NAME = import.meta.env.VITE_SHOP_NAME || 'Open Shop';

export default function Layout() {
  const navigate = useNavigate();

  async function handleSignOut() {
    await auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-52 bg-white border-r border-[#E5E5E5] flex flex-col shrink-0">
        <div className="px-6 py-5 border-b border-[#E5E5E5]">
          <span className="text-base font-semibold text-[#1A1A1A]">{SHOP_NAME}</span>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-0.5">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-primary-light text-primary font-medium'
                    : 'text-[#6B7280] hover:bg-[#F5F5F5] hover:text-[#1A1A1A]'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-[#E5E5E5]">
          <button
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2 rounded text-sm text-[#6B7280] hover:bg-[#F5F5F5] hover:text-[#1A1A1A] transition-colors"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
