
import React, { useState } from 'react';
import { SOP, ChangeRequest, AuditEntry, SalesFeedback } from '../types';

interface AdminPanelProps {
  onBack: () => void;
  activeSops: SOP[];
  draftSops: SOP[];
  auditLog: AuditEntry[];
  salesFeedback: SalesFeedback[];
  changeRequests: ChangeRequest[];
  onPropose: (sop: SOP) => void;
  onApprove: (id: string) => void;
  onDeprecate: (id: string, reason: string) => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ 
  onBack, activeSops, draftSops, auditLog, salesFeedback, changeRequests, 
  onPropose, onApprove, onDeprecate 
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingSop, setEditingSop] = useState<Partial<SOP> | null>(null);

  const handleStartPropose = (existing?: SOP) => {
    setEditingSop(existing ? {
      ...existing,
      id: `${existing.id}-REV`,
      version: `${existing.version}-draft`,
      status: 'Draft',
      replacesId: existing.id,
      proposedBy: 'admin_user',
      lastUpdated: new Date().toISOString().split('T')[0]
    } : {
      id: 'SOP-JB-',
      version: '1.0.0-draft',
      status: 'Draft',
      proposedBy: 'admin_user',
      lastUpdated: new Date().toISOString().split('T')[0]
    });
    setShowForm(true);
  };

  const formatDate = (ts: string) => {
    try {
      // Assuming ts is "YYYY-MM-DD HH:mm"
      const [datePart, timePart] = ts.split(' ');
      const [y, m, d] = datePart.split('-');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y} · ${timePart}`;
    } catch (e) {
      return ts;
    }
  };

  const getPriorityEmoji = (urgency: string) => {
    switch (urgency) {
      case 'High': return '🟥';
      case 'Medium': return '🟨';
      default: return '🟦';
    }
  };

  return (
    <div className="flex flex-col gap-10 max-w-7xl mx-auto w-full p-4 md:p-12 animate-in fade-in slide-in-from-bottom-8 duration-500">
      <div className="flex items-center justify-between bg-white p-8 border-b-4 border-jobird-yellow shadow-md rounded-sm">
        <div>
          <h2 className="text-4xl font-black text-jobird-navy uppercase tracking-tighter">Document management</h2>
          <p className="text-[12px] text-slate-500 font-bold uppercase tracking-[0.3em] mt-2">Document Control & Standard Operating Procedures</p>
        </div>
        <button 
          onClick={onBack}
          className="px-8 py-4 bg-jobird-navy text-white font-black uppercase text-xs tracking-widest hover:bg-slate-800 transition-all flex items-center gap-3 shadow-xl"
        >
          <i className="fas fa-chevron-left"></i> Selection Assistant
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Active SOPs */}
        <section className="bg-white xl:col-span-7 shadow-sm border border-slate-200 overflow-hidden rounded-sm">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <i className="fas fa-file-shield text-jobird-navy text-xl"></i>
              <h3 className="font-black text-jobird-navy text-[13px] uppercase tracking-widest">Standard Operating Procedures</h3>
            </div>
          </div>
          <div className="p-0 overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-black uppercase tracking-widest border-b border-slate-100">
                <tr>
                  <th className="px-8 py-5">SOP ID</th>
                  <th className="px-8 py-5">Revision</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {activeSops.filter(s => s.status === 'Active').map(sop => (
                  <tr key={sop.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-6 font-black text-jobird-navy">{sop.id}</td>
                    <td className="px-8 py-6 font-mono text-slate-500 font-bold">{sop.version}</td>
                    <td className="px-8 py-6">
                      <span className="bg-green-100 text-green-800 px-3 py-1 rounded-sm font-black text-[10px] uppercase tracking-widest">Active</span>
                    </td>
                    <td className="px-8 py-6 text-right flex justify-end gap-6">
                      <button onClick={() => handleStartPropose(sop)} className="text-jobird-navy font-black hover:text-jobird-red uppercase text-[10px] tracking-widest transition-colors">Update</button>
                      <button onClick={() => onDeprecate(sop.id, 'Administrative Decision')} className="text-slate-400 font-black hover:text-jobird-red transition-colors uppercase text-[10px] tracking-widest">Retire</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Sales Feedback */}
        <section className="bg-white xl:col-span-5 shadow-sm border border-slate-200 overflow-hidden flex flex-col rounded-sm">
          <div className="p-6 bg-jobird-navy border-b border-jobird-navy flex items-center gap-3">
            <i className="fas fa-tower-observation text-jobird-yellow text-xl"></i>
            <h3 className="font-black text-white text-[13px] uppercase tracking-widest">Feedback & Change Requests</h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto custom-scrollbar bg-white">
            {salesFeedback.length === 0 && changeRequests.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-slate-300">
                <i className="fas fa-clipboard-check text-5xl mb-4"></i>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">No pending reports</p>
              </div>
            )}
            {salesFeedback.map(fb => (
              <div key={fb.id} className="p-8 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0">
                <div className="mb-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Feedback Request</h4>
                  
                  <div className="space-y-5">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Reported Issue:</p>
                      <p className="text-sm font-bold text-slate-800">{fb.issue}</p>
                    </div>
                    
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Affected Item:</p>
                      <p className="text-sm font-bold text-slate-800">{fb.task}</p>
                    </div>

                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Reported by:</p>
                      <p className="text-sm font-bold text-slate-800">{fb.userId.replace('_', ' ')}</p>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5">{formatDate(fb.timestamp)}</p>
                    </div>

                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Priority:</p>
                      <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <span>{getPriorityEmoji(fb.urgency)}</span>
                        {fb.urgency} Priority
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Audit Log */}
        <section className="bg-white shadow-sm border border-slate-200 overflow-hidden xl:col-span-12 rounded-sm">
          <div className="p-6 bg-slate-900 border-b border-slate-800 flex items-center gap-3">
            <i className="fas fa-fingerprint text-white/50 text-xl"></i>
            <h3 className="font-black text-white text-[13px] uppercase tracking-widest">Document Change Log</h3>
          </div>
          <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
            {auditLog.map((log, idx) => (
              <div key={log.id} className={`p-6 flex items-center justify-between gap-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} border-b border-slate-100`}>
                <div className="flex items-center gap-12 flex-1 min-w-0">
                  <div className="w-32 flex-shrink-0">
                    <p className="font-black text-jobird-navy text-[11px] uppercase tracking-widest truncate">{log.user}</p>
                    <p className="text-[10px] text-slate-400 font-bold tracking-tighter uppercase mt-1">{log.timestamp}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-4 mb-2">
                      <span className="text-[10px] font-black bg-slate-200 text-slate-700 px-2.5 py-1 rounded uppercase tracking-widest whitespace-nowrap">{log.action}</span>
                      <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">{log.id}</span>
                    </div>
                    <p className="text-[13px] text-slate-700 font-bold truncate italic">"{log.changeDetail}"</p>
                  </div>
                </div>
                <div className="hidden md:block">
                  <i className="fas fa-check-circle text-green-500/40 text-2xl"></i>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminPanel;
