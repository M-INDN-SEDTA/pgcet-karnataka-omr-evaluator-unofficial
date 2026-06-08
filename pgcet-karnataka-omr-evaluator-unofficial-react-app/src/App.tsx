import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { FileUp, BookOpen, AlertCircle, CheckCircle2, XCircle, MinusCircle, Search, RefreshCw, FileText, UploadCloud, MapPin, Building, Hash, FileImage, MousePointerClick, CheckSquare, Download } from 'lucide-react';
import { districtList, examCenters } from './data/districts';
import { defaultAnswerKeys } from './data/answerKey';
import { ScoreResult, SummaryData, PageLookupResult } from './types';
import { processOMR } from './utils/omrProcessor';
import * as pdfjsLib from 'pdfjs-dist';

function PdfPageViewer({ url, pageNo }: { url: string, pageNo: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const renderPage = async () => {
      if (!canvasRef.current) return;
      try {
        setLoading(true);
        const loadingTask = pdfjsLib.getDocument({ url });
        const pdf = await loadingTask.promise;
        if (!active) return;
        const page = await pdf.getPage(pageNo);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Ensure white background
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // @ts-ignore
        await page.render({ canvasContext: context, viewport }).promise;
      } catch (err: any) {
        console.error("Failed to render PDF page:", err);
      } finally {
        if (active) setLoading(false);
      }
    };
    renderPage();
    return () => { active = false; };
  }, [url, pageNo]);

  return (
    <div className="relative md:absolute md:inset-0 bg-slate-100 md:overflow-auto custom-scrollbar p-2 md:p-6 w-full h-auto md:h-full">
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10"><div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div></div>}
      <canvas ref={canvasRef} className="block mx-auto max-w-full shadow-xl" />
    </div>
  );
}

export default function App() {
  const [district, setDistrict] = useState('');
  const [centerId, setCenterId] = useState('');
  const [ansSheetNo, setAnsSheetNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Workflow States: INPUT -> PAGE_FOUND -> EXTRACTED -> RESULT
  const [workflowStep, setWorkflowStep] = useState<'INPUT' | 'PAGE_FOUND' | 'EXTRACTED' | 'RESULT'>('INPUT');
  const [pageNo, setPageNo] = useState<number | null>(null);
  const [isMockData, setIsMockData] = useState(false);
  
  const [result, setResult] = useState<ScoreResult | null>(null);
  
  // The editable answer key state that the user can modify based on KEA updates
  const [editableKey, setEditableKey] = useState<string[]>([]);
  // The editable student answers in case the OMR extraction makes a mistake
  const [editableStudentAnswers, setEditableStudentAnswers] = useState<string[]>([]);
  const [editableVersionCode, setEditableVersionCode] = useState<string>('');
  
  // Debug mode visibility
  const [showDebug, setShowDebug] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [scoreSynced, setScoreSynced] = useState(false);
  
  // Whenever identifying inputs change, reset workflow to INPUT to hide previous OMRs
  useEffect(() => {
    setWorkflowStep('INPUT');
    setResult(null);
    setPageNo(null);
    setScoreSynced(false);
  }, [district, centerId, ansSheetNo]);
  
  const handleFindPage = async () => {
    setError('');
    if (!district || !centerId || !ansSheetNo) {
      setError('Please select district, center, and enter answer sheet number.');
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch('/api/lookup-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centerId, answerSheetNo: ansSheetNo })
      });
      
      const data: PageLookupResult = await response.json();
      if (data.success && data.pageNo) {
        setPageNo(data.pageNo);
        setIsMockData(data.isMock || false);
        setWorkflowStep('PAGE_FOUND');
      } else {
        setError(data.message || 'Could not find page in the CSV index.');
      }
    } catch (err) {
      setError('Failed to connect to the server.');
    } finally {
      setLoading(false);
    }
  };

  const handleExtractBubbles = async () => {
    setError('');
    setLoading(true);
    
    try {
      const pdfUrl = `/pdf/${centerId}.pdf`;
      const data = await processOMR(pdfUrl, pageNo || 1);
      
      if (data.success) {
        // Build the result object
        const scoreResult: ScoreResult = {
          success: true,
          versionCode: data.versionCode,
          studentAnswers: data.studentAnswers,
          message: data.message || '',
          debugImageUrl: data.debugImageUrl,
          debugParts: data.debugParts
        };
        
        setResult(scoreResult);
        const vCode = defaultAnswerKeys[data.versionCode] ? data.versionCode : 'A1';
        setEditableVersionCode(vCode);
        const defaultKey = defaultAnswerKeys[vCode] || Array(100).fill('1');
        setEditableKey([...defaultKey]);
        setEditableStudentAnswers([...data.studentAnswers]);
        setWorkflowStep('EXTRACTED');
        setScoreSynced(false);
      } else {
        setError(data.message || 'Extraction failed.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to process OMR on client side.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckResult = () => {
    setWorkflowStep('RESULT');
  };

  const handleSyncScore = () => {
    setScoreSynced(true);
    // Provide a visual acknowledgement that syncing works
    alert("Score successfully synced with the Manual Key! Visual stats are updated.");
  }

  const handleDownloadReport = async () => {
    try {
      setDownloading(true);
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      
      // Page 1: OMR Image
      let imgData: string | null = null;
      if (result && result.debugImageUrl) {
        imgData = result.debugImageUrl;
      } else {
         const omrContainer = document.getElementById('omr-preview-container');
         const customCanvas = omrContainer?.querySelector('canvas');
         if (customCanvas) {
           imgData = customCanvas.toDataURL('image/jpeg', 0.8);
         }
      }
      
      if (imgData) {
        const imgProps = pdf.getImageProperties(imgData);
        const margin = 10;
        const availWidth = pageWidth - 2 * margin;
        const pageHeight = pdf.internal.pageSize.getHeight();
        const availHeight = pageHeight - 35; // 35 accounts for top margin and header
        
        const ratio = imgProps.width / imgProps.height;
        let finalWidth = availWidth;
        let finalHeight = availWidth / ratio;
        
        if (finalHeight > availHeight) {
          finalHeight = availHeight;
          finalWidth = availHeight * ratio;
        }
        
        // Center horizontally if shrunk
        const xOffset = margin + (availWidth - finalWidth) / 2;
        
        pdf.setFontSize(16);
        pdf.text('OMR Scan Result', pageWidth / 2, 15, { align: 'center' });
        pdf.addImage(imgData, 'JPEG', xOffset, 25, finalWidth, finalHeight);
      } else {
        pdf.setFontSize(16);
        pdf.text('OMR Scan Result Image Unavailable', pageWidth / 2, 50, { align: 'center' });
      }
      
      // Page 2: Verification Panel (Score & Table)
      if (stats) {
        pdf.addPage();
        pdf.setFontSize(18);
        pdf.text('OMR Score Report', pageWidth / 2, 20, { align: 'center' });
        
        pdf.setFontSize(12);
        pdf.text(`Form / Ref Code: ${ansSheetNo}`, 15, 35);
        pdf.text(`Version Code: ${editableVersionCode}`, 15, 45);
        pdf.text(`Total Score: ${stats.score} / ${editableStudentAnswers.length}`, 15, 55);
        pdf.text(`Correct: ${stats.totalCorrect} | Wrong: ${stats.totalWrong} | Blank: ${stats.totalBlank}`, 15, 65);
        
        const tableData = editableStudentAnswers.map((ans, idx) => {
          let isBlank = ans.toLowerCase().includes('blank') || !ans;
          let isMultiple = ans.toLowerCase().includes('multiple');
          let isCorrect = !isBlank && !isMultiple && ans === editableKey[idx];
          return [
            (idx + 1).toString().padStart(2, '0'),
            ans,
            editableKey[idx],
            isCorrect ? 'Correct' : 'Wrong'
          ];
        });

        autoTable(pdf, {
          startY: 75,
          head: [['Q#', 'Scanned Default', 'Key', 'Status']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [59, 130, 246] }, // blue-500
          didParseCell: (data: any) => {
             if (data.section === 'body' && data.column.index === 3) {
                 if (data.cell.raw === 'Wrong') {
                     data.cell.styles.textColor = [239, 68, 68]; // red-500
                 } else {
                     data.cell.styles.textColor = [34, 197, 94]; // green-500
                 }
             }
          }
        });
      }
      
      pdf.save(`OMR_Report_${ansSheetNo}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Failed to generate report PDF');
    } finally {
      setDownloading(false);
    }
  };

  const updateStudentAnswer = (idx: number, val: string) => {
    const updated = [...editableStudentAnswers];
    updated[idx] = val;
    setEditableStudentAnswers(updated);
  };

  const updateKey = (idx: number, val: string) => {
    const updated = [...editableKey];
    updated[idx] = val;
    setEditableKey(updated);
  };
  
  const handleVersionCodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCode = e.target.value;
    setEditableVersionCode(newCode);
    if (defaultAnswerKeys[newCode]) {
        setEditableKey([...defaultAnswerKeys[newCode]]);
    } else {
        setEditableKey(Array(100).fill('1'));
    }
  };
  
  const renderVersionDropdown = () => (
    <select 
      value={editableVersionCode} 
      onChange={handleVersionCodeChange}
      className="bg-white border border-slate-300 rounded px-2 py-1 text-sm font-bold text-blue-700 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
    >
      {Object.keys(defaultAnswerKeys).map(k => (
        <option key={k} value={k}>Version {k}</option>
      ))}
    </select>
  );
  
  // Compute Stats based on the latest editable key and the student's evaluated answers
  const stats = useMemo(() => {
    if (!result || !editableKey.length || !editableStudentAnswers.length) return null;
    
    let totalCorrect = 0, totalWrong = 0, totalBlank = 0, totalMultiple = 0;
    
    editableStudentAnswers.forEach((ans, idx) => {
      const isBlank = ans.toLowerCase().includes('blank') || !ans;
      const isMultiple = ans.toLowerCase().includes('multiple');
      
      if (isBlank) totalBlank++;
      else if (isMultiple) { totalMultiple++; totalWrong++; }
      else if (ans === editableKey[idx]) totalCorrect++;
      else totalWrong++;
    });
    
    return {
      totalCorrect,
      totalWrong,
      totalBlank,
      totalMultiple,
      score: totalCorrect // 1 mark per correct answer assumed
    };
  }, [result, editableKey, editableStudentAnswers]);

  return (
    <div className="flex flex-col md:h-screen min-h-screen w-full bg-slate-50 text-slate-900 font-sans md:overflow-hidden">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0 shadow-lg" style={{ zIndex: 50 }}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-amber-500 rounded-md flex items-center justify-center font-bold text-slate-900">
            DMA 
          </div>
          <div>
            <h1 className="text-base md:text-lg font-bold leading-none tracking-tight">PGCET 2026</h1>
            <p className="text-[10px] md:text-xs text-slate-400 mt-1 truncate max-w-[200px] md:max-w-none">⚠️ Unofficial OMR Verification Portal — For Technical and Educational Purposes Only</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="bg-slate-800 px-3 py-1.5 rounded text-xs font-mono border border-slate-700 hidden sm:block">
            <span className="text-slate-500">SESSION:</span> CS_MORNING
          </div>
          <div className="bg-blue-600 px-3 py-1.5 rounded text-xs font-semibold">ADMIN PANEL</div>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row md:overflow-hidden">
        {/* Sidebar */}
        <aside className="w-full md:w-80 bg-white md:border-r border-b border-slate-200 flex flex-col p-4 md:p-6 shrink-0 md:overflow-y-auto">
          <div className="mb-4 md:mb-8 shrink-0">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">01. Exam District</label>
            <select 
              className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              value={district}
              onChange={e => {
                setDistrict(e.target.value);
                setCenterId('');
              }}
            >
              <option value="">Select district...</option>
              {districtList.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="mb-8 min-h-0 shrink-0">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">02. Exam Center</label>
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
              {district ? examCenters[district as keyof typeof examCenters]?.map(c => (
                <button 
                  key={c.code}
                  type="button"
                  onClick={() => setCenterId(c.code)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    centerId === c.code 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className={`text-xs font-bold ${centerId === c.code ? 'text-blue-700' : 'text-slate-500'}`}>
                    CODE {c.code}
                  </div>
                  <div className="text-sm font-medium pr-1 line-clamp-2 leading-snug mt-1">{c.name}</div>
                </button>
              )) : (
                <div className="text-xs text-slate-400 p-2 text-center border border-dashed border-slate-200 rounded">
                  Select a district first
                </div>
              )}
            </div>
          </div>

          <div className="mb-8 shrink-0">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">03. Answer Sheet Identity</label>
            <input 
              type="text" 
              placeholder="Enter No. (e.g. 206049)" 
              value={ansSheetNo} 
              onChange={e => {
                setAnsSheetNo(e.target.value);
                setWorkflowStep('INPUT'); // Reset flow if changed
              }}
              className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" 
            />
            {centerId && <p className="text-[10px] text-slate-500 mt-2 italic">Looking in /public/pdf/{centerId}_answersheet_pages_indexed.csv</p>}
          </div>

          {error && (
            <div className="mb-4 text-xs font-bold text-red-600 bg-red-50 p-2 rounded border border-red-200 shrink-0">
              {error}
            </div>
          )}

          <div className="shrink-0 space-y-3">
            <button 
              onClick={handleFindPage}
              disabled={loading || !district || !centerId || !ansSheetNo || workflowStep !== 'INPUT'}
              className={`w-full font-bold py-2.5 rounded-md transition-colors flex items-center justify-center gap-2 border ${
                workflowStep === 'INPUT' 
                  ? 'bg-slate-900 text-white hover:bg-black border-transparent' 
                  : 'bg-white text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
            >
              <Search className="w-4 h-4" />
              <span>FIND OMR SHEET</span>
            </button>

            <button 
              onClick={handleExtractBubbles}
              disabled={loading || workflowStep !== 'PAGE_FOUND'}
              className={`w-full font-bold py-2.5 rounded-md transition-colors flex items-center justify-center gap-2 border ${
                workflowStep === 'PAGE_FOUND' 
                  ? 'bg-blue-600 text-white hover:bg-blue-700 border-transparent shadow-sm' 
                  : 'bg-white text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
            >
              <MousePointerClick className="w-4 h-4" />
              <span>EXTRACT BUBBLES</span>
              {loading && workflowStep === 'PAGE_FOUND' && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
            </button>

            <button 
              onClick={handleCheckResult}
              disabled={loading || workflowStep !== 'EXTRACTED'}
              className={`w-full font-bold py-2.5 rounded-md transition-colors flex items-center justify-center gap-2 border ${
                workflowStep === 'EXTRACTED' 
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 border-transparent shadow-sm' 
                  : 'bg-white text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>CHECK RESULT</span>
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200 shrink-0">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
              <h4 className="text-[10px] font-bold text-amber-800 uppercase mb-2 flex items-center"><UploadCloud className="w-3 h-3 mr-1" /> File Upload Setup</h4>
              <p className="text-[10px] text-amber-700 mb-2">To process real OMR sheets locally, upload them to the <code className="bg-amber-100 px-1 rounded">public/pdf/</code> directory:</p>
              <ul className="text-[10px] space-y-1 font-mono text-amber-900 mb-2">
                <li>/public/pdf/106.pdf</li>
                <li>/public/pdf/106_answersheet_pages_indexed.csv</li>
              </ul>
              <p className="text-[10px] text-amber-700 leading-tight">Extraction runs natively in the browser via Canvas API!</p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <section className="flex-[2] p-4 md:p-6 flex flex-col gap-6 overflow-x-hidden md:overflow-hidden bg-slate-50">

          {!result && workflowStep === 'INPUT' ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 border border-slate-200 rounded-2xl bg-white shadow-sm">
               <FileImage className="w-16 h-16 mb-4 text-slate-300" />
               <h3 className="text-lg font-bold text-slate-600 mb-1 uppercase tracking-tight">System Idle</h3>
               <p className="text-sm text-center max-w-sm">Enter the answer sheet number and click "Find OMR Sheet" to locate the specific page.</p>
            </div>
          ) : (
            <>
              {/* Top Stats Row (Only show when RESULT is active) */}
              {workflowStep === 'RESULT' && (
                <motion.div initial={{opacity:0, y:-10}} animate={{opacity:1, y:0}} className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Total Correct</div>
                    <div className="text-3xl font-bold text-green-600 mt-auto">{stats?.totalCorrect}<span className="text-sm text-slate-300 font-normal ml-1">/100</span></div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Detected Layout</div>
                    <div className="mt-auto">{renderVersionDropdown()}</div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Blanks</div>
                    <div className="text-3xl font-bold text-slate-400 mt-auto">{stats?.totalBlank?.toString().padStart(2, '0')}</div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Wrong/Multi</div>
                    <div className="text-3xl font-bold text-red-500 mt-auto">{stats?.totalWrong?.toString().padStart(2, '0')}</div>
                  </div>
                </motion.div>
              )}

              {/* View Area */}
              <div className="flex-1 flex flex-col lg:flex-row gap-6 md:min-h-0">
                
                {/* PDF Preview (Always visible after PAGE_FOUND) */}
                <div id="omr-preview-container" className={`flex-[1.2] bg-slate-200 rounded-xl border border-slate-300 relative lg:overflow-hidden group flex items-center justify-center ${workflowStep === 'PAGE_FOUND' ? 'flex-1' : ''}`}>
                  
                  {isMockData ? (
                    <div className="w-[300px] h-[400px] md:w-[400px] md:h-[550px] bg-white shadow-2xl transform rotate-1 border border-slate-300 p-4 md:p-8 flex flex-col relative">
                      <div className="absolute inset-0 bg-amber-500/10 flex flex-col items-center justify-center p-8 text-center z-10 backdrop-blur-[1px]">
                         <FileImage className="w-12 h-12 text-amber-500 opacity-50 mb-4" />
                         <span className="text-amber-800 font-bold mb-2 uppercase text-sm tracking-widest">Simulation Mode</span>
                         <span className="text-amber-700/80 text-xs font-medium">Please upload <code className="bg-white/50 px-1 rounded">{centerId}.pdf</code> inside <code className="bg-white/50 px-1 rounded">public/pdf/</code> to view the real document.</span>
                      </div>
                      <div className="flex justify-between items-start mb-4 md:mb-6 border-b pb-3 md:pb-4 shrink-0 opacity-30">
                        <div className="text-[8px] font-mono font-bold text-slate-500">FORM-PGCET-{centerId}</div>
                        <div className="text-[8px] font-bold text-slate-600">Ref Code: {ansSheetNo}</div>
                      </div>
                      <div className="opacity-10 pointer-events-none">
                         <div className="space-y-4">
                           <div className="h-4 w-64 bg-slate-800 rounded"></div>
                           <div className="h-12 w-full bg-slate-800 rounded"></div>
                           <div className="h-4 w-48 bg-slate-800 rounded"></div>
                         </div>
                      </div>
                    </div>
                  ) : result?.debugImageUrl ? (
                    <div className="relative md:absolute md:inset-0 bg-slate-100 md:overflow-auto custom-scrollbar p-2 md:p-6 w-full h-auto md:h-full">
                      <img src={result.debugImageUrl} alt="OMR Debug" className="block mx-auto max-w-full shadow-xl" />
                    </div>
                  ) : (
                    <PdfPageViewer url={`/pdf/${centerId}.pdf`} pageNo={pageNo || 1} />
                  )}

                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/80 text-white text-[10px] px-3 py-1 rounded-full backdrop-blur-sm shadow-sm whitespace-nowrap z-20">
                    Source: {centerId}.pdf | Page: {pageNo}
                  </div>
                </div>

                {/* Extracted Bubbles Preview (EXTRACTED step) */}
                {workflowStep === 'EXTRACTED' && result && (
                  <motion.div initial={{opacity:0, x:10}} animate={{opacity:1, x:0}} className="flex-1 bg-white rounded-xl border border-blue-200 shadow-sm flex flex-col md:overflow-hidden">
                     <div className="p-4 border-b border-blue-100 flex items-center justify-between bg-blue-50 shrink-0">
                       <div className="flex items-center">
                         <CheckCircle2 className="w-5 h-5 text-blue-600 mr-2" />
                         <div>
                           <h3 className="text-sm font-bold text-blue-900">Extraction Complete</h3>
                           <p className="text-[10px] text-blue-600/80 uppercase tracking-widest font-bold">Review and edit any misread bubbles, then click Check Result.</p>
                         </div>
                       </div>
                       <button onClick={() => setShowDebug(!showDebug)} className="bg-white border flex items-center gap-1 border-blue-200 px-3 py-1.5 rounded-md text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors">
                          <Search className="w-3 h-3" /> DEBUG OMR
                       </button>
                    </div>
                    
                    {showDebug && result.debugParts ? (
                       <div className="flex-1 md:overflow-y-auto custom-scrollbar p-4 bg-slate-900 space-y-4">
                          {/* Version code full width */}
                          {result.debugParts.filter(p => p.name === "Version Code").map((part, i) => (
                              <div key={'vc-'+i} className="flex flex-col bg-slate-800 rounded-md overflow-hidden border border-slate-700 max-w-sm mx-auto w-full">
                                    <div className="bg-slate-950 p-2 text-center text-xs font-bold text-blue-400 border-b border-slate-700 flex justify-between items-center">
                                       <span>{part.name}</span>
                                       <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-blue-300">Raw: {result.versionCode}</span>
                                    </div>
                                    <div className="flex flex-col bg-slate-900 p-4 items-center">
                                          <img src={part.dataUrl} className="w-full max-w-[200px] h-auto object-contain border border-slate-600 rounded mb-4" alt={part.name} />
                                          <div className="flex items-center gap-2 text-sm font-bold bg-slate-800 px-4 py-2 rounded-md shadow-sm border border-slate-700 w-full justify-center">
                                             <span className="text-green-400">Apply Key:</span>
                                             {renderVersionDropdown()}
                                          </div>
                                    </div>
                                </div>
                          ))}

                         <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {result.debugParts.filter(p => p.name !== "Version Code").map((part, i) => (
                               <div key={i} className="flex flex-col bg-slate-800 rounded-md overflow-hidden border border-slate-700">
                                   <div className="bg-slate-950 p-2 text-center text-[10px] font-bold text-blue-400">
                                      {part.name}
                                   </div>
                                   <div className="flex bg-slate-100">
                                      <div className="w-1/2 border-r border-slate-300">
                                         <img src={part.dataUrl} className="w-full h-auto object-contain" alt={part.name} />
                                      </div>
                                      <div className="w-1/2 bg-slate-900 p-2 overflow-y-auto max-h-[400px] custom-scrollbar">
                                         {part.extractedAnswers.map((ans, j) => (
                                             <div key={j} className="text-[9px] font-mono border-b border-slate-800 py-1 text-slate-300 flex justify-between">
                                                <span>{ans.split(':')[0]}</span>
                                                <span className={`${ans.includes('Blank') ? 'text-slate-600' : ans.includes('Multiple') ? 'text-orange-500' : 'text-green-400 font-bold'}`}>{ans.split(':')[1]}</span>
                                             </div>
                                         ))}
                                      </div>
                                   </div>
                               </div>
                            ))}
                         </div>
                       </div>
                    ) : (
                       <div className="flex-1 md:overflow-y-auto custom-scrollbar p-4 bg-slate-50 relative">
                          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                             <MousePointerClick className="w-48 h-48" />
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 gap-2 relative z-10">
                             {editableStudentAnswers.map((ans, idx) => (
                                <div key={idx} className="bg-white border border-slate-200 rounded p-2 text-center flex flex-col items-center shadow-sm hover:border-blue-300 transition-colors">
                                   <span className="text-[9px] text-slate-400 font-mono mb-1 w-full border-b border-slate-100 pb-1">Q{idx + 1}</span>
                                   <input 
                                     value={ans} 
                                     onChange={(e) => updateStudentAnswer(idx, e.target.value)}
                                     className={`w-full text-center text-xs font-bold outline-none bg-transparent ${ans === 'Blank' || !ans ? 'text-slate-300' : ans.includes('Multiple') ? 'text-orange-500 text-[10px] leading-tight' : 'text-slate-800'}`}
                                     title="Edit extracted answer"
                                   />
                                </div>
                             ))}
                          </div>
                       </div>
                    )}
                  </motion.div>
                )}

                {/* Answer Key & Comparison (RESULT step) */}
                {workflowStep === 'RESULT' && result && (
                  <motion.div id="verification-panel" initial={{opacity:0, x:10}} animate={{opacity:1, x:0}} className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col md:overflow-hidden">
                  <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white shrink-0 z-10">
                    <h3 className="text-sm font-bold text-slate-800">Verification Panel</h3>
                    <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded font-bold uppercase">Version {editableVersionCode} Active</span>
                  </div>
                  
                  <div className="flex-1 overflow-x-auto md:overflow-y-auto custom-scrollbar p-0">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm border-b border-slate-200">
                        <tr>
                          <th className="p-3 font-bold text-slate-500">Q#</th>
                          <th className="p-3 font-bold text-slate-500">Scanned</th>
                          <th className="p-3 font-bold text-blue-700 bg-blue-50/50">Key ({editableVersionCode})</th>
                          <th className="p-3 font-bold text-slate-500 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editableStudentAnswers.map((ans, idx) => {
                          let isBlank = ans.toLowerCase().includes('blank') || !ans;
                          let isMultiple = ans.toLowerCase().includes('multiple');
                          let isCorrect = !isBlank && !isMultiple && ans === editableKey[idx];
                          
                          let bgClass = "hover:bg-slate-50/50";
                          let statusClass = "text-red-500";
                          let statusText = "WRONG";
                          let studentAnsClass = "font-bold text-red-500";
                          let numClass = "font-mono";
                          
                          if (isBlank) {
                            bgClass = "bg-amber-50/30 hover:bg-amber-50/50";
                            statusClass = "text-amber-600 uppercase";
                            statusText = "No Mark";
                            studentAnsClass = "font-bold text-slate-400";
                            numClass = "font-mono text-slate-400";
                            ans = "BLANK";
                          } else if (isMultiple) {
                             bgClass = "bg-red-50/30 hover:bg-red-50/50";
                             statusText = "MULTI";
                          } else if (isCorrect) {
                            statusClass = "text-green-600";
                            statusText = "CORRECT";
                            studentAnsClass = "font-bold text-slate-800";
                          } else {
                            bgClass = "bg-red-50/10 hover:bg-red-50/30";
                          }
                          
                          return (
                            <tr key={idx} className={`border-b border-slate-100 ${bgClass} transition-colors`}>
                              <td className={`p-3 ${numClass}`}>{(idx + 1).toString().padStart(2, '0')}</td>
                              <td className={`p-3 ${studentAnsClass}`}>{ans}</td>
                              <td className="p-2.5">
                                <input 
                                  type="text" 
                                  value={editableKey[idx] || ''} 
                                  onChange={e => updateKey(idx, e.target.value)}
                                  className="w-10 border border-slate-200 rounded text-center py-1 font-bold font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" 
                                  maxLength={1}
                                />
                              </td>
                              <td className={`p-3 text-right font-bold ${statusClass}`}>{statusText}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-3 border-t border-slate-200 bg-slate-50 flex gap-2 shrink-0">
                    {scoreSynced ? (
                      <button onClick={handleDownloadReport} disabled={downloading} className={`flex-1 bg-white border border-blue-300 text-[11px] font-bold py-2 rounded shadow-sm hover:bg-blue-50 transition-colors text-blue-700 flex justify-center items-center gap-2 focus:outline-none ${downloading ? 'opacity-50 cursor-wait' : ''}`}>
                         <Download className="w-3 h-3" />
                         {downloading ? 'GENERATING PDF...' : 'DOWNLOAD REPORT'}
                      </button>
                    ) : (
                      <button className="flex-1 bg-white border border-slate-300 text-[11px] font-bold py-2 rounded shadow-sm hover:bg-slate-50 transition-colors text-slate-400 cursor-not-allowed focus:outline-none" disabled>SAVE MANUAL KEY</button>
                    )}
                    <button onClick={handleSyncScore} className="flex-1 bg-blue-600 text-white text-[11px] font-bold py-2 rounded shadow-sm hover:bg-blue-700 transition-colors active:scale-[0.98] focus:outline-none">SYNC SCORE</button>
                  </div>
                </motion.div>
                )}
              </div>
            </>
          )}

        </section>
      </main>

      {/* Footer */}
      <footer className="h-10 bg-white border-t border-slate-200 hidden md:flex items-center px-6 justify-between shrink-0 z-20">
        <div className="flex gap-6 items-center">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-500' : 'bg-green-500'} animate-pulse`}></div>
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-tight">
              {loading ? 'Processing Queue' : 'System Online: Ready for Batch Process'}
            </span>
          </div>
          <div className="text-[10px] text-slate-400">|</div>
          <div className="text-[10px] text-slate-500 font-medium font-mono">
            {centerId ? `~/data/${centerId}.pdf Indexed` : '~/data/ Standby'}
          </div>
        </div>
        <div className="text-[10px] font-bold text-slate-400 uppercase">
          Karnataka Examination Authority © 2024
        </div>
      </footer>
    </div>
  );
}
