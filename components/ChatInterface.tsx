
import React, { useState, useRef, useEffect } from 'react';
import { Message, CabinetModel, SOP, SalesFeedback } from '../types';
import { getSelectionResponse, generateSelectionSpeech, getAI } from '../geminiService';
import { SYSTEM_INSTRUCTION } from '../constants';
import { Modality, LiveServerMessage, Blob } from '@google/genai';

// Manually implement base64 encoding/decoding as per requirements
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

interface ChatInterfaceProps {
  catalog: CabinetModel[];
  activeSops: SOP[];
  onSubmitFeedback: (feedback: SalesFeedback) => void;
  selectedModel: CabinetModel | null;
  onOpenAdmin: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ catalog, activeSops, onSubmitFeedback, selectedModel, onOpenAdmin }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Let me help you work out which cabinet fits your equipment. To begin, please provide as much information as possible, such as the equipment type, quantity, and dimensions or manufacturer/model info.",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState<number | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);

  const [feedbackTask, setFeedbackTask] = useState('');
  const [feedbackIssue, setFeedbackIssue] = useState('');
  const [feedbackUrgency, setFeedbackUrgency] = useState<'Low' | 'Medium' | 'High'>('Medium');

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const stopLiveMode = () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    for (const source of audioSourcesRef.current) {
      try { source.stop(); } catch (e) { }
    }
    audioSourcesRef.current.clear();
    setIsLiveMode(false);
  };

  const startLiveMode = async () => {
    if (isLiveMode) {
      stopLiveMode();
      return;
    }

    try {
      const liveAi = getAI();
      if (!liveAi) {
        setMessages(prev => [...prev, { role: 'assistant', content: "Voice mode is unavailable because the API key is not configured.", timestamp: new Date() }]);
        setIsLiveMode(false);
        return;
      }

      setIsLiveMode(true);

      // Ensure AudioContext is created/resumed on user gesture
      if (!inputAudioContextRef.current) {
        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const inputCtx = inputAudioContextRef.current;
      const outputCtx = audioContextRef.current;

      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const enhancedInstruction = `${SYSTEM_INSTRUCTION}
      
DETERMINISTIC CATALOG DATA:
${JSON.stringify(catalog)}

VOICE MODE SPECIFIC:
1. You are in a real-time voice conversation.
2. Keep your spoken responses concise and natural.
3. However, ensure the transcriptions you generate follow the mandatory section labels (RECOMMENDED CABINET:, INITIAL ASSESSMENT:, etc.) so the UI can format them.
4. If you suggest a cabinet, say its name clearly.`;

      const aiInstance = getAI();
      const sessionPromise = (aiInstance as any).live.connect({
        model: 'gemini-2.0-flash-exp', // Standard model for Live API
        callbacks: {
          onopen: () => {
            console.log("Live session connected");
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              const currentAi = getAI();
              if (currentAi) {
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            } else if (message.serverContent?.inputTranscription) {
              currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = currentInputTranscriptionRef.current.trim();
              const botText = currentOutputTranscriptionRef.current.trim();
              if (userText) {
                setMessages(prev => [...prev, { role: 'user', content: userText, timestamp: new Date() }]);
              }
              if (botText) {
                setMessages(prev => [...prev, { role: 'assistant', content: botText, timestamp: new Date() }]);
              }
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
            }

            const base64 = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputCtx.destination);
              source.addEventListener('ended', () => {
                audioSourcesRef.current.delete(source);
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              audioSourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              for (const source of audioSourcesRef.current) {
                try { source.stop(); } catch (e) { }
              }
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => console.error('Live Error:', e),
          onclose: () => setIsLiveMode(false),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: enhancedInstruction
        },
      });

      const sessionAi = getAI();
      if (!sessionAi) throw new Error("AI not initialized");
      liveSessionRef.current = await sessionPromise;
    } catch (err) {
      console.error('Failed to start live mode:', err);
      setIsLiveMode(false);
    }
  };

  const handlePlayAudio = async (text: string, msgIndex: number) => {
    if (isSpeaking !== null) return;
    setIsSpeaking(msgIndex);
    try {
      const base64 = await generateSelectionSpeech(text);
      if (!base64) throw new Error("Audio generation failed");
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const ctx = audioContextRef.current;
      const audioBuffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      src.onended = () => setIsSpeaking(null);
      src.start();
    } catch (e) {
      console.error(e);
      setIsSpeaking(null);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { role: 'user', content: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    try {
      const sendAi = getAI();
      if (!sendAi) throw new Error("Gemini AI client not initialized");
      const response = await getSelectionResponse(input, messages, catalog);
      const botMsg: Message = { role: 'assistant', content: response, timestamp: new Date() };
      setMessages(prev => [...prev, botMsg]);
    } catch (error: any) {
      console.error("Selection Error:", error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Service Error: ${error.message || "I am having difficulty processing that request. Please verify the API key."}`,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const feedback: SalesFeedback = {
      id: `FB-${Math.floor(Math.random() * 9000) + 1000}`,
      userId: 'Sales_User',
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      context: { cabinetId: selectedModel?.id || 'GLOBAL' },
      task: feedbackTask,
      issue: feedbackIssue,
      urgency: feedbackUrgency
    };
    onSubmitFeedback(feedback);
    setShowFeedbackModal(false);
    setMessages(prev => [...prev, { role: 'assistant', content: "Thank you. Feedback has been received and will be reviewed", timestamp: new Date() }]);
  };

  const handleExportChat = () => {
    const header = `JoBird Cabinet Selection Export\nGenerated: ${new Date().toLocaleString()}\n\n`;
    const separator = "\n--------------------------------------------------\n";

    const content = messages.map(msg => {
      const timestamp = msg.timestamp.toLocaleString();
      const role = msg.role.toUpperCase();
      // Remove internal highlight tags for export
      const cleanContent = msg.content.replace(/\[\[HIGHLIGHT\]\]/g, '').replace(/\[\[\/HIGHLIGHT\]\]/g, '');
      return `[${timestamp}] ${role}:\n${cleanContent}`;
    }).join(separator);

    const blob = new window.Blob([header + content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `jobird_chat_export_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatContent = (content: string) => {
    let formatted = content.replace(/[*#]/g, '');
    const headers = [
      "INITIAL ASSESSMENT", "CLARIFYING QUESTIONS", "RECOMMENDED CABINET",
      "WHY THIS WAS SELECTED", "INTERNAL LAYOUT", "ASSUMPTIONS", "NEXT STEPS"
    ];
    const regex = new RegExp(`(?=${headers.join(':|')}:)`, 'i');
    const sections = formatted.split(regex);

    return (
      <div className="space-y-3">
        {sections.map((section, idx) => {
          const headerMatch = section.match(new RegExp(`^(${headers.join('|')}):`, 'i'));
          const header = headerMatch ? headerMatch[1] : "";
          const body = section.replace(headerMatch ? headerMatch[0] : "", "").trim();
          if (!header && !body) return null;
          const highlightRegex = /\[\[HIGHLIGHT\]\](.*?)\[\[\/HIGHLIGHT\]\]/g;
          const isMainAction = header.toUpperCase() === 'RECOMMENDED CABINET' || header.toUpperCase() === 'INITIAL ASSESSMENT';
          return (
            <div key={idx} className={isMainAction ? 'p-3 bg-jobird-red/5 border-l-2 border-jobird-red' : ''}>
              {header && (
                <h5 className="text-[10px] font-black text-jobird-red mb-1 uppercase tracking-widest">
                  {header}
                </h5>
              )}
              <div className="text-[12px] leading-relaxed whitespace-pre-wrap font-medium text-slate-800">
                {body.split(highlightRegex).map((part, i) => {
                  if (i % 2 === 1) return <span key={i} className="text-jobird-red font-black px-1 uppercase">{part}</span>;
                  return part;
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[638px] bg-white border border-slate-200 shadow-2xl relative">
      {/* Live Mode Pulse Bar */}
      {isLiveMode && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-jobird-red z-20 overflow-hidden">
          <div className="h-full bg-white/40 animate-[shimmer_2s_infinite_linear]" style={{ width: '40%' }}></div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-white custom-scrollbar">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse text-right' : 'flex-row'}`}>
              <div className={`w-8 h-8 flex-shrink-0 flex items-center justify-center border-2 text-xs ${msg.role === 'user' ? 'bg-white border-slate-200 text-slate-400' : 'bg-jobird-red border-jobird-red text-white'
                }`}>
                <i className={`fas ${msg.role === 'user' ? 'fa-user-tie' : 'fa-robot'}`}></i>
              </div>
              <div className="relative group">
                <div className={`p-4 border ${msg.role === 'user' ? 'bg-slate-50 border-slate-100 text-slate-600' : 'bg-white border-slate-200 shadow-sm text-slate-800'
                  }`}>
                  {msg.role === 'assistant' ? formatContent(msg.content) : <div className="text-[13px] font-bold">{msg.content}</div>}
                </div>
                {msg.role === 'assistant' && !isLiveMode && (msg.content.includes('RECOMMENDED CABINET') || msg.content.includes('INITIAL ASSESSMENT')) && (
                  <button
                    onClick={() => handlePlayAudio(msg.content, idx)}
                    className={`mt-2 w-full bg-slate-100 py-1.5 text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-jobird-red hover:text-white transition-all ${isSpeaking === idx ? 'bg-jobird-red text-white animate-pulse' : ''
                      }`}
                  >
                    <i className={`fas ${isSpeaking === idx ? 'fa-volume-high' : 'fa-volume-low'}`}></i>
                    Listen to Recommendation
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && !isLiveMode && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-jobird-red flex items-center justify-center text-white text-xs">
                <i className="fas fa-gear animate-spin"></i>
              </div>
              <div className="bg-slate-50 border border-slate-100 p-4 flex items-center gap-4">
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">Evaluating selection...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-5 border-t border-slate-100 bg-jobird-lightGrey">
        <div className="flex gap-3 items-center">
          <button
            onClick={startLiveMode}
            className={`w-[48px] h-[48px] flex-shrink-0 flex items-center justify-center transition-all ${isLiveMode
              ? 'bg-jobird-red text-white animate-pulse shadow-[0_0_15px_rgba(217,60,35,0.4)]'
              : 'bg-white border border-slate-200 text-slate-400 hover:text-jobird-red'
              }`}
            title={isLiveMode ? "Stop Voice Mode" : "Start Voice Mode"}
          >
            <i className={`fas ${isLiveMode ? 'fa-microphone' : 'fa-microphone-slash'} text-lg`}></i>
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isLiveMode}
            placeholder={isLiveMode ? "Listening..." : "please describe your requirements"}
            className="flex-1 px-4 py-3 bg-white border border-slate-200 outline-none text-[13px] font-bold placeholder:text-slate-300 transition-all focus:border-jobird-red disabled:bg-slate-100 shadow-inner"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading || isLiveMode}
            className="bg-jobird-red text-white px-8 h-[48px] flex items-center justify-center font-black uppercase text-[11px] tracking-[0.2em] shadow-lg hover:bg-red-700 disabled:opacity-50 transition-all active:scale-95"
          >
            Submit
          </button>
        </div>
        <div className="flex justify-center gap-6 mt-4">
          <button
            onClick={onOpenAdmin}
            className="text-[9px] font-black text-slate-400 hover:text-jobird-red uppercase tracking-widest flex items-center gap-2 transition-all"
          >
            <i className="fas fa-lock"></i>
            Admin panel
          </button>
          <button
            onClick={() => setShowFeedbackModal(true)}
            className="text-[9px] font-black text-slate-400 hover:text-jobird-red uppercase tracking-widest flex items-center gap-2 transition-all"
          >
            <i className="fas fa-flag"></i>
            Feedback
          </button>
          <button
            onClick={handleExportChat}
            className="text-[9px] font-black text-slate-400 hover:text-jobird-red uppercase tracking-widest flex items-center gap-2 transition-all"
          >
            <i className="fas fa-file-export"></i>
            Export chat
          </button>
        </div>
      </div>

      {showFeedbackModal && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-300 border-t-4 border-jobird-red">
            <form onSubmit={handleFeedbackSubmit}>
              <div className="p-4 bg-jobird-lightGrey border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-black text-slate-900 uppercase tracking-widest text-[10px]">Feedback form</h3>
                <button type="button" onClick={() => setShowFeedbackModal(false)} className="text-slate-400 hover:text-jobird-red"><i className="fas fa-times"></i></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest">Document / SOP Reference</label>
                  <input required value={feedbackTask} onChange={e => setFeedbackTask(e.target.value)} placeholder="e.g. JB08 clearance" className="w-full p-2.5 bg-jobird-lightGrey border border-slate-200 font-bold text-xs outline-none focus:border-jobird-red" />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest">Details of Issue</label>
                  <textarea required value={feedbackIssue} onChange={e => setFeedbackIssue(e.target.value)} rows={3} placeholder="Describe issue..." className="w-full p-2.5 bg-jobird-lightGrey border border-slate-200 text-xs font-medium outline-none focus:border-jobird-red" />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest">Priority</label>
                  <div className="flex gap-2">
                    {(['Low', 'Medium', 'High'] as const).map(u => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setFeedbackUrgency(u)}
                        className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest transition-all ${feedbackUrgency === u ? 'bg-jobird-red text-white' : 'bg-jobird-lightGrey text-slate-400 border border-slate-200'
                          }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-4 bg-jobird-lightGrey border-t border-slate-200 flex justify-end gap-4">
                <button type="button" onClick={() => setShowFeedbackModal(false)} className="px-3 py-2 font-black text-slate-400 uppercase text-[9px] tracking-widest">Cancel</button>
                <button type="submit" className="px-6 py-2.5 bg-jobird-red text-white font-black uppercase text-[9px] tracking-widest shadow-xl">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;
