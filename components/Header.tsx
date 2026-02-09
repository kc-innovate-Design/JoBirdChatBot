
import React from 'react';

const Header: React.FC = () => {
  return (
    <div className="w-full">
      {/* Red Banner Header with Bird Logo Only */}
      <header className="bg-jobird-red text-white h-[60px] flex items-center px-6 lg:px-12 relative shadow-md">
        <div className="flex items-center h-full">
          {/* Bird Logo Icon */}
          <div className="flex items-center group cursor-pointer h-full">
            <img
              src="/logo.png"
              alt="JoBird Logo"
              className="h-10 w-auto object-contain"
            />
          </div>
        </div>
      </header>

      {/* Sub-header Title Bar - Navigation links removed as requested */}
      <div className="bg-white border-b border-slate-100 py-3 px-6 lg:px-12 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] uppercase font-black text-slate-400 tracking-widest">
          <span className="text-jobird-red">Cabinet Selection Assistant</span>
        </div>
        <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
          Internal Training & Sales Tool v2.1
        </div>
      </div>
    </div>
  );
};

export default Header;
