
import React from 'react';

const Header: React.FC = () => {
  return (
    <div className="w-full">
      {/* Red Banner Header with Bird Logo Only */}
      <header className="bg-jobird-red text-white h-[60px] flex items-center px-6 lg:px-12 relative shadow-md">
        <div className="flex items-center h-full">
          {/* Bird Logo Icon */}
          <div className="flex items-center group cursor-pointer">
            <div className="w-12 h-12 flex items-center justify-center">
              {/* Stylized bird icon to match the brand identity */}
              <svg 
                viewBox="0 0 100 100" 
                className="w-10 h-10 fill-current"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M10,60 Q40,55 55,35 Q65,20 85,30 Q70,40 60,65 Q50,85 35,65 Q25,55 10,60" />
              </svg>
            </div>
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
