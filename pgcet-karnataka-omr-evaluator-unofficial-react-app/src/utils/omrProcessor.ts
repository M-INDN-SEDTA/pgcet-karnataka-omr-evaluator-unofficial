import * as pdfjsLib from 'pdfjs-dist';

// Initialize PDF.js worker via CDN to avoid Vite cross-chunk worker parsing issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface OMRExtractionResult {
    success: boolean;
    versionCode: string;
    studentAnswers: string[];
    message?: string;
    debugImageUrl?: string;
    debugParts?: { name: string; dataUrl: string; extractedAnswers: string[] }[];
}

export async function processOMR(pdfUrl: string, pageNumber: number): Promise<OMRExtractionResult> {
  try {
    // Load the PDF
    const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
    const pdf = await loadingTask.promise;
    if (pageNumber > pdf.numPages || pageNumber < 1) {
      throw new Error(`Page ${pageNumber} out of bounds.`);
    }
    const page = await pdf.getPage(pageNumber);
  
    // Set scale exactly as in Python (150 DPI / 72 DPI)
    const scale = 150 / 72;
    const viewport = page.getViewport({ scale });
  
    // original pdf size in points
    const pdf_width = viewport.width / scale;
    const pdf_height = viewport.height / scale;
  
    // Create canvas and render
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error("Could not get canvas context");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
  
    // Ensure white background! PDF sometimes renders transparent, making RGB all 0s (black)
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // @ts-ignore
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
  
    const img_width = canvas.width;
    const img_height = canvas.height;
  
    // Function to extract grayscale crop
    function getCropImage(x: number, y: number, w: number, h: number) {
      return context!.getImageData(x, y, w, h);
    }
  
    // Define regions
    const crop_top_left = { x: 410, y: 493 };
    const crop_bottom_right = { x: 555, y: 545 };
  
    const px0 = Math.floor(crop_top_left.x * img_width / pdf_width);
    const px1 = Math.floor(crop_bottom_right.x * img_width / pdf_width);
    const py0 = Math.floor(crop_top_left.y * img_height / pdf_height);
    const py1 = Math.floor(crop_bottom_right.y * img_height / pdf_height);
  
    const vData = getCropImage(px0, py0, px1 - px0, py1 - py0);
    const v_w = vData.width;
    const v_h = vData.height;
  
    // Create 2D array of L (grayscale)
    const v: number[][] = [];
    for (let y = 0; y < v_h; y++) {
      const row: number[] = [];
      for (let x = 0; x < v_w; x++) {
        const i = (y * v_w + x) * 4;
        const r = vData.data[i];
        const g = vData.data[i + 1];
        const b = vData.data[i + 2];
        const L = Math.floor(r * 0.299 + g * 0.587 + b * 0.114);
        row.push(L);
      }
      v.push(row);
    }
  
    // 1. VERSION SHIFT CALCULATION
    const col_start = Math.floor(v_w * 0.28);
    const col_end = Math.floor(v_w * 0.32);
  
    const profile: number[] = [];
    for (let y = 0; y < v_h; y++) {
      let sum = 0;
      for (let x = col_start; x < col_end; x++) {
        sum += v[y][x];
      }
      profile.push(sum / (col_end - col_start));
    }
  
    const grad: number[] = [];
    for (let i = 0; i < profile.length - 1; i++) {
      grad.push(profile[i + 1] - profile[i]);
    }
  
    let peak = 0;
    let maxGrad = -Infinity;
    for (let i = 0; i < grad.length; i++) {
      if (grad[i] > maxGrad) {
        maxGrad = grad[i];
        peak = i;
      }
    }
  
    let white_y = peak;
    for (let i = peak; i < profile.length; i++) {
      if (i < grad.length && grad[i] <= 1.0) {
        white_y = i;
        break;
      }
    }
  
    const pixel_shift = Math.max(0, white_y - 105);
    const pdf_shift = pixel_shift * (pdf_height / img_height);
  
    // 2. VERSION CODE DETECTION (WITH SHIFT)
    const shifted_v_py0 = Math.floor((crop_top_left.y + pdf_shift) * img_height / pdf_height);
    console.log(pdf_shift);
    const shifted_v_py1 = Math.floor((crop_bottom_right.y + pdf_shift) * img_height / pdf_height);
    const shiftedVData = getCropImage(px0, shifted_v_py0, px1 - px0, shifted_v_py1 - shifted_v_py0);
    const sv_w = shiftedVData.width;
    const sv_h = shiftedVData.height;

    // Create 2D array of L (grayscale)
    const sv: number[][] = [];
    for (let y = 0; y < sv_h; y++) {
      const row: number[] = [];
      for (let x = 0; x < sv_w; x++) {
        const i = (y * sv_w + x) * 4;
        const r = shiftedVData.data[i];
        const g = shiftedVData.data[i + 1];
        const b = shiftedVData.data[i + 2];
        const L = Math.floor(r * 0.299 + g * 0.587 + b * 0.114);
        row.push(L);
      }
      sv.push(row);
    }

    const top_labels = ["A", "B", "C", "D"];
    const bottom_labels = ["1", "2", "3", "4"];
  
    const top_scores: number[] = [];
    const bottom_scores: number[] = [];
  
    for (let i = 0; i < 4; i++) {
      const x_s = Math.floor(i * sv_w / 4);
      const x_e = Math.floor((i + 1) * sv_w / 4);
      
      let top_sum = 0, top_count = 0;
      let btm_sum = 0, btm_count = 0;
      
      for (let y = 0; y < Math.floor(sv_h / 2); y++) {
        for (let x = x_s; x < x_e; x++) {
          top_sum += sv[y][x];
          top_count++;
        }
      }
      for (let y = Math.floor(sv_h / 2); y < sv_h; y++) {
        for (let x = x_s; x < x_e; x++) {
          btm_sum += sv[y][x];
          btm_count++;
        }
      }
      top_scores.push(top_sum / top_count);
      bottom_scores.push(btm_sum / btm_count);
    }
  
    const top_idx = top_scores.indexOf(Math.min(...top_scores));
    const btm_idx = bottom_scores.indexOf(Math.min(...bottom_scores));
    const version_code = `${top_labels[top_idx]}${bottom_labels[btm_idx]}`;

    // Create debug image for Version Code
    const vcCanvas = document.createElement('canvas');
    vcCanvas.width = sv_w;
    vcCanvas.height = sv_h;
    const vcCtx = vcCanvas.getContext('2d');
    if (vcCtx) {
        vcCtx.putImageData(shiftedVData, 0, 0);

        // draw horizontal guide line
        vcCtx.strokeStyle = "rgba(255, 0, 0, 0.4)";
        vcCtx.lineWidth = 2;
        vcCtx.setLineDash([5, 5]);
        vcCtx.beginPath();
        vcCtx.moveTo(0, sv_h / 2);
        vcCtx.lineTo(sv_w, sv_h / 2);
        vcCtx.stroke();

        // draw vertical splits
        vcCtx.strokeStyle = "rgba(0, 0, 255, 0.4)";
        for (let i = 1; i < 4; i++) {
            const vx = Math.floor(i * sv_w / 4);
            vcCtx.beginPath();
            vcCtx.moveTo(vx, 0);
            vcCtx.lineTo(vx, sv_h);
            vcCtx.stroke();
        }
        vcCtx.setLineDash([]);
    }
  
    const parts_base = [
      ["Part 1 (Q1-25)", {x: 305, y: 580}, {x: 383, y: 1050}, 1],
      ["Part 2 (Q26-50)", {x: 418, y: 580}, {x: 498, y: 1050}, 26],
      ["Part 3 (Q51-75)", {x: 550, y: 580}, {x: 625, y: 1050}, 51],
      ["Part 4 (Q76-100)", {x: 664, y: 580}, {x: 740, y: 1050}, 76],
    ] as const;
  
    const optionBounds = [
      { start: 0, end: 38 },
      { start: 38.01, end: 77.50 },
      { start: 77.51, end: 120.00 },
      { start: 120.01, end: 177.00 }
    ];

    const option_labels = ["1", "2", "3", "4"];
    const evaluation_results: Record<number, string> = {};
    const debugParts: { name: string; dataUrl: string; extractedAnswers: string[] }[] = [];

    // Add version code debug image to debugParts
    if (vcCtx) {
        debugParts.push({
            name: "Version Code",
            dataUrl: vcCanvas.toDataURL("image/jpeg", 0.6),
            extractedAnswers: [`Detected Code: ${version_code}`]
        });
    }
    
  
    for (const part of parts_base) {
      const part_name = part[0] as string;
      const start_q_no = part[3] as number;
      const top_left = part[1] as {x: number, y: number};
      const btm_right = part[2] as {x: number, y: number};
  
      const shifted_y0 = top_left.y + pdf_shift;
      const shifted_y1 = btm_right.y + pdf_shift;
  
      const px0_part = Math.floor(top_left.x * img_width / pdf_width);
      const px1_part = Math.floor(btm_right.x * img_width / pdf_width);
      const py0_part = Math.floor(shifted_y0 * img_height / pdf_height);
      const py1_part = Math.floor(shifted_y1 * img_height / pdf_height);
      
  
      const partData = getCropImage(px0_part, py0_part, px1_part - px0_part, py1_part - py0_part);
      const w2 = partData.width;
      const h2 = partData.height;
  
      const row_step = h2 / 25;
      
      const partCanvas = document.createElement('canvas');
      partCanvas.width = partData.width;
      partCanvas.height = partData.height;
      const partCtx = partCanvas.getContext('2d');
      if (partCtx) partCtx.putImageData(partData, 0, 0);

      const partExtracted: string[] = [];
  
      for (let r = 0; r < 25; r++) {
        const q = start_q_no + r;
        const y_s = Math.floor(r * row_step);
        const y_e = Math.floor((r + 1) * row_step);
  
        const detected: string[] = [];
        const row_cells: any[] = [];
  
        for (let c = 0; c < 4; c++) {
          const col_step = w2 / 4;

          const x_s = Math.floor(c * col_step);
          const x_e = Math.floor((c + 1) * col_step);
  
          const ch = y_e - y_s;
          const cw = x_e - x_s;
  
          let r_sum = 0;
          let b_sum = 0;
          let count = 0;
  
          const inner_y_start = Math.floor(ch * 0.15);
          const inner_y_end = Math.floor(ch * 0.85);
          const inner_x_start = Math.floor(cw * 0.15);
          const inner_x_end = Math.floor(cw * 0.85);
  
          for (let inner_y = inner_y_start; inner_y < inner_y_end; inner_y++) {
            for (let inner_x = inner_x_start; inner_x < inner_x_end; inner_x++) {
              const py = y_s + inner_y;
              const px = x_s + inner_x;
              
              if (px < w2 && py < h2) {
                const i = (py * w2 + px) * 4;
                r_sum += partData.data[i];     // Red
                b_sum += partData.data[i + 2]; // Blue
                count++;
              }
            }
          }
  
          const r_val = count > 0 ? r_sum / count : 0;
          const b_val = count > 0 ? b_sum / count : 0;
          const darkness = r_val;
  
          row_cells.push({
            index: c,
            r_val,
            b_val,
            darkness,
            x_s, y_s, cw, ch, inner_x_start, inner_y_start, inner_w: inner_x_end - inner_x_start, inner_h: inner_y_end - inner_y_start
          });
        }
  
        const darknesses = row_cells.map(cell => cell.darkness);
        const max_r = Math.max(...darknesses);
        const min_r = Math.min(...darknesses);
        const row_delta = max_r - min_r;
  
        if (row_delta > 20) { // relaxed from 35 for pdfjs
          for (const cell of row_cells) {
            const is_black_ink = cell.darkness < 155 || cell.darkness < (max_r * 0.85); // slightly relaxed
            const is_blue_ink = (cell.b_val - cell.r_val > 15) && (cell.r_val < 185);
            
            if (is_black_ink || is_blue_ink) {
              detected.push(option_labels[cell.index]);
              cell.marked = true;
            } else {
              cell.marked = false;
            }
          }
        }
  
        if (partCtx) {
            // Draw row separator
            partCtx.strokeStyle = "rgba(255, 0, 0, 0.4)";
            partCtx.lineWidth = 1;
            partCtx.beginPath();
            partCtx.moveTo(0, y_e);
            partCtx.lineTo(w2, y_e);
            partCtx.stroke();
            
            for (const cell of row_cells) {
                const abs_x = cell.x_s;
                const abs_y = cell.y_s;
                const abs_inner_x = abs_x + cell.inner_x_start;
                const abs_inner_y = abs_y + cell.inner_y_start;
                
                // Draw inner box
                partCtx.strokeStyle = cell.marked ? "rgba(0, 255, 0, 0.8)" : "rgba(255, 0, 0, 0.3)";
                partCtx.lineWidth = cell.marked ? 2 : 1;
                partCtx.strokeRect(abs_inner_x, abs_inner_y, cell.inner_w, cell.inner_h);
                
                // Draw col separator
                partCtx.strokeStyle = "rgba(0, 0, 255, 0.4)";
                partCtx.lineWidth = 1;
                partCtx.beginPath();
                partCtx.moveTo(abs_x, 0);
                partCtx.lineTo(abs_x, h2);
                partCtx.stroke();
                
                // Text values
                partCtx.fillStyle = cell.marked ? "rgba(0, 150, 0, 1)" : "rgba(50, 50, 50, 0.8)";
                partCtx.font = "14px monospace"; 
                partCtx.fillText(cell.darkness.toFixed(0), abs_inner_x, abs_inner_y - 2);
            }
        }

        if (detected.length === 1) {
          evaluation_results[q] = detected[0];
        } else if (detected.length > 1) {
          evaluation_results[q] = `Multiple (${detected.join(',')})`;
        } else {
          evaluation_results[q] = "Blank";
        }

        partExtracted.push(`Q${q}: ${evaluation_results[q]}`);
      }

      if (partCtx) {
          debugParts.push({
              name: part_name,
              dataUrl: partCanvas.toDataURL("image/jpeg", 0.6),
              extractedAnswers: partExtracted
          });
      }
    }
  
    const studentAnswers: string[] = [];
    for (let i = 1; i <= 100; i++) {
      studentAnswers.push(evaluation_results[i] || 'Blank');
    }
  
    // DRAW DEBUG OVERLAYS
    context.strokeStyle = "rgba(255, 0, 0, 0.7)";
    context.lineWidth = 2;
    
    // Draw version box with dotted line (original)
    context.strokeStyle = "rgba(0, 0, 255, 0.4)"; // Blue for original version
    context.setLineDash([5, 5]); // Dotted line
    context.strokeRect(px0, py0, px1 - px0, py1 - py0);
    
    // Draw shifted version box with dotted line
    context.strokeStyle = "rgba(0, 255, 0, 0.8)"; // Green for shifted version
    context.strokeRect(px0, shifted_v_py0, px1 - px0, shifted_v_py1 - shifted_v_py0);
    context.setLineDash([]); // Reset to solid
    
    // Draw part boxes
    context.strokeStyle = "rgba(255, 0, 0, 0.7)"; // Red for parts
    for (const part of parts_base) {
      const top_left = part[1] as {x: number, y: number};
      const btm_right = part[2] as {x: number, y: number};
      const shifted_y0 = top_left.y + pdf_shift;
      const shifted_y1 = btm_right.y + pdf_shift;
      const px0_part = Math.floor(top_left.x * img_width / pdf_width);
      const px1_part = Math.floor(btm_right.x * img_width / pdf_width);
      const py0_part = Math.floor(shifted_y0 * img_height / pdf_height);
      const py1_part = Math.floor(shifted_y1 * img_height / pdf_height);
      context.strokeRect(px0_part, py0_part, px1_part - px0_part, py1_part - py0_part);
    }

    const debugImageUrl = canvas.toDataURL("image/jpeg", 0.6);

    return {
      success: true,
      versionCode: version_code,
      studentAnswers,
      debugImageUrl,
      debugParts,
      message: `Extraction complete. Shift: ${pdf_shift.toFixed(2)} pts (peak: ${peak}, white_y: ${white_y})`
    };
  } catch (error: any) {
    console.error("OMR process error:", error);
    return {
      success: false,
      versionCode: '',
      studentAnswers: [],
      message: error.message || 'Error processing OMR'
    };
  }
}


