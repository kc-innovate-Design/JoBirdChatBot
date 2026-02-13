
import React, { useState, useRef, useEffect } from 'react';
import { Message, CabinetModel, SOP, SalesFeedback, DatasheetReference } from '../types';
import { getSelectionResponse, getSelectionResponseStream, generateSelectionSpeech, getAI } from '../geminiService';
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

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  catalog, activeSops, onSubmitFeedback, selectedModel, onOpenAdmin,
  initialMessages, initialDatasheets, onSessionUpdate
}) => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState<number | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [referencedDatasheets, setReferencedDatasheets] = useState<DatasheetReference[]>(initialDatasheets);

  const [feedbackTask, setFeedbackTask] = useState('');
  const [feedbackIssue, setFeedbackIssue] = useState('');
  const [feedbackUrgency, setFeedbackUrgency] = useState<'Low' | 'Medium' | 'High'>('Medium');

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [sessionFiles, setSessionFiles] = useState<{ name: string, content: string }[]>([]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const newFile = { name: file.name, content };
      const updatedFiles = [...sessionFiles, newFile];
      setSessionFiles(updatedFiles);

      const assistantMsg: Message = {
        role: 'assistant',
        content: `I've received your document: **${file.name}**. I am now analyzing the requirements to find the best solutions...`,
        timestamp: new Date()
      };

      const newHistory = [...messages, assistantMsg];
      setMessages(newHistory);

      // Automatically trigger synthesis using the new file context
      // Use a clear, technical prompt to get the best results from the pinned context
      await processQuery("Please analyze the uploaded requirements and recommend the best JoBird cabinet solutions based on the specifications provided.", newHistory, updatedFiles);
    };
    reader.readAsText(file);
  };

  const processQuery = async (query: string, currentHistory: Message[], filesToUse = sessionFiles) => {
    if (isLoading) return;
    setIsLoading(true);

    // Add a placeholder message for streaming with loading text
    const placeholderMsg: Message = { role: 'assistant', content: 'Searching database...', timestamp: new Date() };
    const newHistory = [...currentHistory, placeholderMsg];
    setMessages(newHistory);

    try {
      // Store datasheets to set after response completes
      let pendingDatasheets: DatasheetReference[] = [];

      // Use streaming with callback to update message progressively
      await getSelectionResponseStream(query, currentHistory, (text, datasheets) => {
        // Update the last message (our placeholder) with new text
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            // Check for follow-up questions in the text
            const parts = text.split('[[FOLLOWUP]]');
            const cleanText = parts[0].trim();
            if (parts.length > 1) {
              const questions = parts[1].split('|').map(q => q.trim()).filter(Boolean);
              setFollowUpQuestions(questions);
            } else {
              setFollowUpQuestions([]);
            }
            updated[lastIdx] = { ...updated[lastIdx], content: cleanText || 'Generating response...' };
          }
          return updated;
        });
        // Store datasheets for later (after response completes)
        if (datasheets.length > 0) {
          pendingDatasheets = datasheets;
        }
      }, filesToUse);

      // Final local state sync for history
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          const finalHistory = updated;

          // Update referenced datasheets only after response is complete
          if (pendingDatasheets.length > 0) {
            setReferencedDatasheets(prevDs => {
              const merged = [...prevDs];
              pendingDatasheets.forEach(ds => {
                // Normalize for comparison: lowercase, trim, remove .pdf extension
                const normalizedNew = ds.filename.toLowerCase().trim().replace(/\.pdf$/i, '');
                const isDuplicate = merged.some(m =>
                  m.filename.toLowerCase().trim().replace(/\.pdf$/i, '') === normalizedNew
                );
                if (!isDuplicate) {
                  merged.push(ds);
                }
              });
              return merged;
            });
            onSessionUpdate(finalHistory, pendingDatasheets);
          } else {
            onSessionUpdate(finalHistory);
          }
        }
        return updated;
      });

    } catch (error: any) {
      console.error("Selection Error:", error);
      // Update the placeholder message with the error
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: `Service Error: ${error.message || "I am having difficulty processing that request. Please verify the API key."}`
          };
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { role: 'user', content: input, timestamp: new Date() };
    const queryText = input;

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');

    await processQuery(queryText, newHistory);
  };

  const handleDatasheetClick = (datasheet: DatasheetReference) => {
    setInput(`Tell me more about ${datasheet.displayName}`);
  };

  const handleViewPdf = (datasheet: DatasheetReference, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = datasheet.url || (datasheet.filename ? `/datasheets/${datasheet.filename}` : undefined);
    if (url) {
      window.open(url, '_blank');
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
    // Render markdown links [text](url) as clickable <a> elements
    const renderLinks = (text: string): React.ReactNode[] => {
      const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;
      while ((match = linkPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(text.substring(lastIndex, match.index));
        }
        parts.push(
          <a key={`link-${match.index}`} href={match[2]} target="_blank" rel="noopener noreferrer"
            style={{ color: '#D94637', textDecoration: 'underline', fontWeight: 600 }}>
            {match[1]}
          </a>
        );
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
      }
      return parts.length > 0 ? parts : [text];
    };

    // Highlight product codes in text (e.g., JB10.600LJ, JB02HR, RS550)
    const highlightProductCodes = (text: string) => {
      // Known non-product-code patterns to exclude (IP ratings, standards, etc.)
      const nonProductCodes = /^(IP\d+|EN\d+|ISO\d+|BS\d+|IEC\d+|UL\d+|CE\d+|ATEX\d+|MED\d+)$/i;
      // First render any markdown links, then highlight product codes in non-link parts
      const linkedParts = renderLinks(text);
      return linkedParts.flatMap((part, li) => {
        if (typeof part !== 'string') return [part]; // already a React element (link)
        const codeParts = part.split(/\b([A-Z]{2,3}[\d.]+[A-Z\d]*)\b/);
        return codeParts.map((cp, i) => {
          if (/^[A-Z]{2,3}[\d.]+[A-Z\d]*$/.test(cp) && !nonProductCodes.test(cp)) {
            return <strong key={`${li}-${i}`} style={{ color: '#D94637', fontWeight: 900 }}>{cp}</strong>;
          }
          return cp;
        });
      });
    };

    // Return segments of bolded or colored text based on markdown-like structure
    // First, split content into table blocks and non-table blocks
    const lines = content.split('\n');
    const blocks: { type: 'text' | 'table'; lines: string[] }[] = [];
    let currentBlock: { type: 'text' | 'table'; lines: string[] } = { type: 'text', lines: [] };

    for (const line of lines) {
      const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');
      if (isTableLine) {
        if (currentBlock.type !== 'table') {
          if (currentBlock.lines.length > 0) blocks.push(currentBlock);
          currentBlock = { type: 'table', lines: [] };
        }
        currentBlock.lines.push(line.trim());
      } else {
        if (currentBlock.type !== 'text') {
          if (currentBlock.lines.length > 0) blocks.push(currentBlock);
          currentBlock = { type: 'text', lines: [] };
        }
        currentBlock.lines.push(line);
      }
    }
    if (currentBlock.lines.length > 0) blocks.push(currentBlock);

    const renderTable = (tableLines: string[], blockIdx: number) => {
      // Filter out separator rows (|---|---|)
      const dataRows = tableLines.filter(l => !l.match(/^\|[\s\-:|]+\|$/));
      if (dataRows.length === 0) return null;

      const parseRow = (row: string) =>
        row.split('|').slice(1, -1).map(cell => cell.trim());

      const headerCells = parseRow(dataRows[0]);
      const bodyRows = dataRows.slice(1).map(parseRow);

      return (
        <div key={`table-${blockIdx}`} className="my-3 overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr>
                {headerCells.map((cell, ci) => (
                  <th key={ci} style={{
                    padding: '8px 12px',
                    backgroundColor: '#D94637',
                    color: 'white',
                    fontWeight: 700,
                    textAlign: 'left',
                    borderBottom: '2px solid #c03d30',
                    whiteSpace: 'nowrap'
                  }}>
                    {cell.replace(/\*\*/g, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} style={{ backgroundColor: ri % 2 === 0 ? '#fafafa' : 'white' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{
                      padding: '7px 12px',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#334155'
                    }}>
                      {cell.split(/(\*\*.*?\*\*)/).map((part, pi) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                          const inner = part.replace(/\*\*/g, '');
                          return <strong key={pi} style={{ color: '#D94637', fontWeight: 900 }}>{inner}</strong>;
                        }
                        return <React.Fragment key={pi}>{highlightProductCodes(part)}</React.Fragment>;
                      })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        {blocks.map((block, blockIdx) => {
          if (block.type === 'table') {
            return renderTable(block.lines, blockIdx);
          }
          // Render text lines
          return block.lines.map((line, lid) => {
            const key = `${blockIdx}-${lid}`;
            if (line.startsWith('**') && line.endsWith('**')) {
              return (
                <h4 key={key} className="text-[16px] font-black uppercase tracking-tight mt-4 first:mt-0" style={{ color: '#D94637' }}>
                  {line.replace(/\*\*/g, '')}
                </h4>
              );
            }
            if (line.trim().startsWith('-')) {
              return (
                <div key={key} className="flex gap-2 text-[15px] leading-relaxed text-slate-700 ml-2">
                  <span className="font-bold" style={{ color: '#D94637' }}>•</span>
                  <span>{highlightProductCodes(line.trim().substring(1).trim())}</span>
                </div>
              );
            }
            if (line.includes('*Source:')) {
              return (
                <div key={key} className="text-[12px] italic text-slate-400 mt-1">
                  {line.trim()}
                </div>
              );
            }
            return (
              <p key={key} className="text-[15px] leading-relaxed text-slate-800 font-medium">
                {line.split(/(\*\*.*?\*\*)/).map((part, i) => {
                  if (part.startsWith('**') && part.endsWith('**')) {
                    const inner = part.replace(/\*\*/g, '');
                    return <strong key={i} style={{ color: '#D94637', fontWeight: 900 }}>{inner}</strong>;
                  }
                  return <React.Fragment key={i}>{highlightProductCodes(part)}</React.Fragment>;
                })}
              </p>
            );
          });
        })}
      </div>
    );
  };

  return (
    <div className="flex gap-4 h-[638px]">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white border border-slate-200 shadow-2xl relative">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-white custom-scrollbar">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse text-right' : 'flex-row'}`}>
                <div className={`w-8 h-8 flex-shrink-0 flex items-center justify-center border-2 text-xs ${msg.role === 'user' ? 'bg-white border-slate-200 text-slate-400' : 'bg-jobird-red border-jobird-red text-white'
                  }`}>
                  <i className={`fas ${msg.role === 'user' ? 'fa-user-tie' : 'fa-robot'}`}></i>
                </div>
                <div className="relative group">
                  <div className={`py-2 px-4 border ${msg.role === 'user' ? 'bg-slate-50 border-slate-100 text-slate-600' : 'bg-white border-slate-200 shadow-sm text-slate-800'
                    }`}>
                    {msg.role === 'assistant' ? formatContent(msg.content) : <div className="text-[15px] font-bold">{msg.content}</div>}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Follow-up Questions Panel */}
          {followUpQuestions.length > 0 && !isLoading && (
            <div className="flex flex-col gap-2 mt-2 ml-11 items-start">
              <div className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-1">Suggested Follow-ups:</div>
              <div className="flex flex-wrap gap-2">
                {followUpQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      // Auto-submit the follow-up question immediately
                      const newMsg: Message = { role: 'user', content: q, timestamp: new Date() };
                      const newHistory = [...messages, newMsg];
                      setMessages(newHistory);
                      setFollowUpQuestions([]);
                      processQuery(q, newHistory);
                    }}
                    className="px-4 py-1.5 bg-white border border-slate-200 text-[13px] font-bold text-jobird-red hover:bg-jobird-red hover:text-white transition-all shadow-sm rounded-full"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>

        <div className="p-5 border-t border-slate-100 bg-jobird-lightGrey">
          <div className="flex gap-3 items-center">
            <label className="w-[48px] h-[48px] flex-shrink-0 flex items-center justify-center bg-white border border-slate-200 text-slate-400 hover:text-jobird-red cursor-pointer transition-all transition-all">
              <input type="file" className="hidden" onChange={handleFileUpload} accept=".txt,.pdf" />
              <i className="fas fa-paperclip text-lg"></i>
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask me anything..."
              className="flex-1 px-4 py-3 bg-white border border-slate-200 outline-none text-[15px] font-bold placeholder:text-slate-300 transition-all focus:border-jobird-red disabled:bg-slate-100 shadow-inner"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="bg-jobird-red text-white px-8 h-[48px] flex items-center justify-center font-black uppercase text-[11px] tracking-[0.2em] shadow-lg hover:bg-red-700 disabled:opacity-50 transition-all active:scale-95"
            >
              Submit
            </button>
          </div>
          <div className="flex justify-center gap-6 mt-4">
            <button
              onClick={handleExportChat}
              className="text-[9px] font-black text-slate-400 hover:text-jobird-red uppercase tracking-widest flex items-center gap-2 transition-all"
            >
              <i className="fas fa-file-export"></i>
              Export chat
            </button>
            <button
              onClick={() => setShowFeedbackModal(true)}
              className="text-[9px] font-black text-slate-400 hover:text-jobird-red uppercase tracking-widest flex items-center gap-2 transition-all"
            >
              <i className="fas fa-comment-dots"></i>
              Feedback
            </button>
            <button
              onClick={onOpenAdmin}
              className="text-[9px] font-black text-slate-400 hover:text-jobird-red uppercase tracking-widest flex items-center gap-2 transition-all"
            >
              <i className="fas fa-cog"></i>
              Admin
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

      {/* Datasheet Sidebar */}
      <div className="w-64 bg-white border border-slate-200 shadow-lg flex flex-col">
        <div className="p-4 bg-jobird-lightGrey border-b border-slate-200">
          <h3 className="font-black text-slate-700 uppercase tracking-widest text-[12px] flex items-center gap-2">
            <i className="fas fa-file-pdf text-jobird-red"></i>
            Referenced Datasheets
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {referencedDatasheets.length === 0 ? (
            <div className="text-[13px] text-slate-400 italic p-2">
              Datasheets mentioned in responses will appear here for quick reference.
            </div>
          ) : (
            referencedDatasheets.map((ds, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-50 border border-slate-100 transition-all"
              >
                <button
                  onClick={() => handleDatasheetClick(ds)}
                  className="w-full text-left hover:text-jobird-red transition-all group"
                >
                  <div className="flex items-start gap-2">
                    <i className="fas fa-file-alt text-slate-300 group-hover:text-jobird-red text-xs mt-0.5"></i>
                    <div className="text-[13px] font-bold text-slate-700 group-hover:text-jobird-red leading-tight">
                      {ds.displayName}
                    </div>
                  </div>
                </button>
                <div className="flex gap-2 mt-2 pl-5">
                  <button
                    onClick={() => handleDatasheetClick(ds)}
                    className="text-[11px] font-bold text-slate-400 hover:text-jobird-red uppercase tracking-wide"
                  >
                    Ask more
                  </button>
                  {ds.url && (
                    <button
                      onClick={(e) => handleViewPdf(ds, e)}
                      className="text-[11px] font-bold text-jobird-red hover:text-red-700 uppercase tracking-wide flex items-center gap-1"
                    >
                      <i className="fas fa-external-link-alt text-[8px]"></i>
                      View PDF
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        {referencedDatasheets.length > 0 && (
          <div className="p-3 border-t border-slate-100">
            <div className="text-[11px] text-slate-400 text-center">
              {referencedDatasheets.length} datasheet{referencedDatasheets.length !== 1 ? 's' : ''} found
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInterface;
