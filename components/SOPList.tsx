
import React from 'react';
import { SOP } from '../types';

interface SOPListProps {
  sops: SOP[];
  onSelect: (sop: SOP) => void;
  activeId?: string;
}

const SOPList: React.FC<SOPListProps> = ({ sops, onSelect, activeId }) => {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-slate-700 uppercase text-xs tracking-wider flex items-center gap-2">
          <i className="fas fa-file-contract text-indigo-500"></i>
          Active SOP Library
        </h3>
        <span className="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 rounded-full font-bold">
          {sops.length} TOTAL
        </span>
      </div>
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {sops.map((sop) => (
          <button
            key={sop.id}
            onClick={() => onSelect(sop)}
            className={`w-full text-left p-3 rounded-xl border transition-all duration-200 ${
              activeId === sop.id
                ? 'bg-indigo-50 border-indigo-200 shadow-sm ring-1 ring-indigo-200'
                : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
            }`}
          >
            <div className="flex justify-between items-start mb-1">
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">
                {sop.id}
              </span>
              <span className="text-[10px] font-medium text-slate-400">
                {sop.lastUpdated}
              </span>
            </div>
            <h4 className="text-sm font-semibold text-slate-800 line-clamp-1">{sop.title}</h4>
            <p className="text-xs text-slate-500 mt-1 line-clamp-1 italic">{sop.category}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SOPList;
