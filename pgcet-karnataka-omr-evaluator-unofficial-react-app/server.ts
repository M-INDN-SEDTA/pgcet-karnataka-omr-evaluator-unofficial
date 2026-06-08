import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API endpoint to lookup page number from CSV
  app.post('/api/lookup-page', (req, res) => {
    const { centerId, answerSheetNo } = req.body;
    const publicPdfDir = path.join(process.cwd(), 'public', 'pdf');
    const csvPath = path.join(publicPdfDir, `${centerId}_answersheet_pages_indexed.csv`);
    
    if (fs.existsSync(csvPath)) {
      try {
        const content = fs.readFileSync(csvPath, 'utf-8');
        const lines = content.split('\n');
        // Assuming format: page_no,answersheet_no
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const [page_no, sheet_no] = line.split(/[,;\t]+/); // handle basic delimiters
          if (sheet_no && sheet_no.trim() === answerSheetNo.trim()) {
            return res.json({ success: true, pageNo: parseInt(page_no.trim()), isMock: false });
          }
        }
        return res.status(404).json({ success: false, message: 'Answer sheet not found in the CSV index for this center.' });
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Error reading CSV mapping file.' });
      }
    } else {
      // Simulation mode if files aren't uploaded yet
      return res.json({ 
        success: true, 
        pageNo: Math.floor(Math.random() * 10) + 1, 
        isMock: true,
        message: `File ${centerId}_answersheet_pages_indexed.csv not found in public/pdf/. Using simulation mode.` 
      });
    }
  });

  // API endpoint to simulate evaluation
  app.post('/api/evaluate', async (req, res) => {
    const { centerId, answerSheetNo, pageNo } = req.body;
    
    // In a real environment with python, we would spawn:
    // child_process.exec(`python3 data/process_omr.py public/pdf/${centerId}.pdf public/pdf/${centerId}_answersheet_pages_indexed.csv ${pageNo} ${answerSheetNo}`)
    
    // We simulate a 2.5 second delay for OMR processing effect
    setTimeout(() => {
      // Simulate student answers (mostly correct, some mistakes)
      const mockAnswers = Array.from({length: 100}, (_, index) => {
        // Randomly set a few to wrong answers or "Blank" / "Multiple"
        const num = Math.random();
        if (num > 0.95) return "Blank";
        if (num > 0.90) return "Multiple (1,2)";
        return ["1","2","3","4"][Math.floor(Math.random() * 4)];
      });

      res.json({
        success: true,
        versionCode: 'A1',
        studentAnswers: mockAnswers,
        message: 'Extraction complete.'
      });
    }, 2000);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
