import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/cn";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    to: "/tools",
    label: "Capabilities",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
      </svg>
    ),
  },
];

export function Layout() {
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex flex-col w-48 shrink-0 bg-[#0a0f1a] border-r border-slate-800/80">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-slate-800/80">
          <div className="w-6 h-6 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <rect x="3" y="3" width="8" height="8" rx="1" fill="#22d3ee" fillOpacity="0.8" />
              <rect x="13" y="3" width="8" height="8" rx="1" fill="#22d3ee" fillOpacity="0.4" />
              <rect x="3" y="13" width="8" height="8" rx="1" fill="#22d3ee" fillOpacity="0.4" />
              <rect x="13" y="13" width="8" height="8" rx="1" fill="#22d3ee" fillOpacity="0.2" />
            </svg>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-100 mono tracking-tight">
              shuvdex
            </div>
            <div className="text-[10px] text-slate-500 mono">capability gateway</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-[3px] text-xs font-medium transition-colors duration-100",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
                  isActive
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent",
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-800/80">
          <p className="text-[10px] mono text-slate-600">v0.0.0</p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
        {/* Top bar */}
        <header className="flex items-center gap-4 px-6 py-3 border-b border-slate-800/60 shrink-0">
          <div className="flex-1">
            {/* Breadcrumb placeholder — pages render their own title */}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs mono text-slate-500">
              {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
