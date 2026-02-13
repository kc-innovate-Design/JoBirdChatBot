
import React from 'react';
import { Message, DatasheetReference } from '../types';

interface ChatSession {
    id: string;
    title: string;
    messages: Message[];
    datasheets: DatasheetReference[];
    timestamp: Date;
}

interface SidebarProps {
    sessions: ChatSession[];
    activeSessionId: string;
    onSelectSession: (id: string) => void;
    onNewChat: () => void;
    onDeleteSession: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ sessions, activeSessionId, onSelectSession, onNewChat, onDeleteSession }) => {
    return (
        <div className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col h-full shadow-inner">
            <div className="p-4 border-b border-slate-200 bg-white">
                <button
                    onClick={onNewChat}
                    className="w-full py-3 bg-jobird-red text-white font-black uppercase text-[13px] tracking-widest shadow-md hover:bg-red-700 transition-all flex items-center justify-center gap-2"
                >
                    <i className="fas fa-plus"></i>
                    New Chat
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                <div className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-3 px-2">History</div>
                {sessions.map((session) => (
                    <div
                        key={session.id}
                        className={`group relative p-3 rounded-sm border cursor-pointer transition-all ${activeSessionId === session.id
                            ? 'bg-white border-jobird-red shadow-sm'
                            : 'bg-transparent border-transparent hover:bg-slate-200/50'
                            }`}
                        onClick={() => onSelectSession(session.id)}
                    >
                        <div className={`text-[14px] font-bold truncate pr-6 ${activeSessionId === session.id ? 'text-jobird-red' : 'text-slate-600'
                            }`}>
                            {session.title}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                            {new Date(session.timestamp).toLocaleDateString()}
                        </div>

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSession(session.id);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-jobird-red p-1 transition-all"
                        >
                            <i className="fas fa-trash-alt text-[12px]"></i>
                        </button>
                    </div>
                ))}
                {sessions.length === 0 && (
                    <div className="text-[13px] text-slate-400 italic px-2 py-4">No recent chats</div>
                )}
            </div>


        </div>
    );
};

export default Sidebar;
