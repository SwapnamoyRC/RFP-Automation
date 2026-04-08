import { NavLink, useLocation } from 'react-router-dom';
import { Upload, ClipboardCheck, BarChart3, Layers, History, LogOut, BookOpen } from 'lucide-react';

const navItems = [
  { to: '/', icon: Upload, label: 'Upload' },
  { to: '/review', icon: ClipboardCheck, label: 'Review' },
  { to: '/summary', icon: BarChart3, label: 'Summary' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/catalog', icon: BookOpen, label: 'Catalog' },
];

export default function Layout({ children, historyCount = 0, user, onLogout }) {
  const location = useLocation();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col fixed h-full z-20">
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-gray-100">
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">RFP Automation</h1>
            <p className="text-[10px] text-gray-400 leading-tight">Product Matching Dashboard</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to ||
              (to !== '/' && location.pathname.startsWith(to));

            return (
              <NavLink
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-primary-600' : ''}`} />
                <span className="flex-1">{label}</span>
                {label === 'History' && historyCount > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold flex items-center justify-center">
                    {historyCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User & Logout */}
        <div className="px-3 py-3 border-t border-gray-100">
          {user && (
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center shrink-0">
                {(user.name || user.email || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate">{user.name || user.email}</p>
                {user.name && <p className="text-[10px] text-gray-400 truncate">{user.email}</p>}
              </div>
              <button
                onClick={() => onLogout()}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-64">
        <div className="max-w-6xl mx-auto px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
