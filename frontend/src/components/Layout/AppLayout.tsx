import React from 'react';
import Sidebar from './Sidebar';

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <div className="relative flex h-screen w-full flex-row overflow-hidden bg-background-light dark:bg-background-dark transition-colors duration-300">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full overflow-y-auto relative scroll-smooth text-slate-900 dark:text-white">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-background-dark/50 backdrop-blur-md sticky top-0 z-20 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-lg">auto_awesome</span>
            </div>
            <span className="font-bold text-slate-900 dark:text-white">流光 PrismFlowAgent</span>
          </div>
          <button className="text-slate-600 dark:text-white p-2">
            <span className="material-symbols-outlined">menu</span>
          </button>
        </div>

        <div className="flex-1 px-4 md:px-8 py-8 w-full max-w-[1400px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
