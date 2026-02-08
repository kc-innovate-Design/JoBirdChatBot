import React, { useState } from 'react';

interface LoginProps {
    onLogin: (password: string) => boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (onLogin(password)) {
            setError(false);
        } else {
            setError(true);
            setPassword('');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <div className="max-w-md w-full bg-white shadow-2xl rounded-sm overflow-hidden border-t-4 border-jobird-yellow animate-in fade-in zoom-in duration-500">
                <div className="p-8 md:p-12">
                    {/* Logo/Brand Area */}
                    <div className="text-center mb-10">
                        <h1 className="text-4xl font-black text-jobird-navy uppercase tracking-tighter">
                            JoBird
                        </h1>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.3em] mt-2">
                            Selection Assistant
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label
                                htmlFor="password"
                                className="block text-[10px] font-black text-jobird-navy uppercase tracking-widest mb-3"
                            >
                                Access Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={`w-full px-5 py-4 bg-slate-50 border-2 ${error ? 'border-jobird-red' : 'border-slate-100'} focus:border-jobird-navy outline-none transition-all font-mono text-sm shadow-inner rounded-sm`}
                                placeholder="••••••••"
                                autoFocus
                            />
                            {error && (
                                <p className="text-jobird-red text-[10px] font-black uppercase tracking-widest mt-3 animate-bounce">
                                    Access Denied. Please try again.
                                </p>
                            )}
                        </div>

                        <button
                            type="submit"
                            className="w-full py-5 bg-jobird-navy text-white font-black uppercase text-xs tracking-[0.2em] hover:bg-slate-800 transition-all shadow-xl hover:shadow-jobird-navy/20 active:scale-[0.98]"
                        >
                            Enter Workspace
                        </button>
                    </form>
                </div>

                <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                        Protected Intelligence System &copy; {new Date().getFullYear()}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
