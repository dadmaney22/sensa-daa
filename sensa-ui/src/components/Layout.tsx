import { Menu, Home, BarChart2, Folder, CheckSquare, Flag, Users, LifeBuoy, Settings } from 'lucide-react';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-gray-50 font-sans text-gray-900">
      
      {/* SIDEBAR (Hidden on mobile, 64 units wide on desktop) */}
      <aside className="hidden w-64 flex-col border-r border-gray-200 bg-white px-4 py-6 md:flex">
        {/* Logo Area */}
        <div className="mb-6 flex items-center gap-2 px-2 font-semibold text-gray-900 text-lg">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
            <div className="h-3 w-3 rounded-full bg-white shadow-sm"></div>
          </div>
          Untitled UI
        </div>

        {/* Search Placeholder */}
        <div className="mb-6 px-2">
          <div className="flex h-10 items-center rounded-lg border border-gray-300 px-3 text-gray-500 shadow-sm">
            <span className="text-sm">Search</span>
          </div>
        </div>

        {/* Navigation Skeleton */}
        <nav className="flex-1 space-y-1">
          <NavItem icon={<Home className="h-5 w-5" />} label="Home" />
          <NavItem icon={<BarChart2 className="h-5 w-5" />} label="Dashboard" active />
          <NavItem icon={<Folder className="h-5 w-5" />} label="Projects" />
          <NavItem icon={<CheckSquare className="h-5 w-5" />} label="Tasks" />
          <NavItem icon={<Flag className="h-5 w-5" />} label="Reporting" />
          <NavItem icon={<Users className="h-5 w-5" />} label="Users" />
        </nav>

        {/* Bottom Actions */}
        <div className="mt-auto space-y-1 pt-4">
          <NavItem icon={<LifeBuoy className="h-5 w-5" />} label="Support" />
          <NavItem icon={<Settings className="h-5 w-5" />} label="Settings" />
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex flex-1 flex-col overflow-hidden">
        
        {/* MOBILE HEADER (Visible only on small screens) */}
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 md:hidden">
          <div className="flex items-center gap-2 font-semibold text-gray-900">
            <div className="h-6 w-6 rounded-md bg-violet-600"></div>
            Untitled UI
          </div>
          <button className="text-gray-500 hover:text-gray-900">
            <Menu className="h-6 w-6" />
          </button>
        </header>

        {/* DYNAMIC PAGE CONTENT */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

// A small helper component to keep the Sidebar code clean
function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <a
      href="#"
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active 
          ? 'bg-gray-50 text-gray-900' 
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
    >
      {icon}
      {label}
    </a>
  );
}