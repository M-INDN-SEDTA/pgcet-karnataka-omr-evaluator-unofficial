# Unofficial OMR Verification Portal & Computer Vision Engine

> **⚠️ Legal Notice & Disclaimer:** Unofficial OMR Verification Portal — For Technical and Educational Purposes Only. This project is an independent developer prototype built exclusively for algorithmic analysis, matrix layout optimization, and document computer vision research. It is not affiliated with, authorized by, or endorsed by the Karnataka Examinations Authority (KEA) or any government entity.

An advanced, dual-engine document evaluation workspace. This repository pairs a high-performance frontend client-side extraction app with an offline Python/Data Science research notebook capable of detecting complex bubble responses, resolving structural alignment skews, and evaluating exam datasets efficiently.

---

<div align="center">

  <!-- Core Status & Type Badges -->
  <img src="https://img.shields.io/badge/Status-Active-success?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Project-Computer%20Vision-purple?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Scope-Educational%20Only-red?style=for-the-badge" />

  <br />

  <!-- Python / Data Science Stack -->
  <img src="https://img.shields.io/badge/Python-3.10+-blue?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/NumPy-Numerical-013243?style=for-the-badge&logo=numpy&logoColor=white" />
  <img src="https://img.shields.io/badge/Pandas-Data%20Analysis-150458?style=for-the-badge&logo=pandas&logoColor=white" />
  <img src="https://img.shields.io/badge/Jupyter-Notebook-F37626?style=for-the-badge&logo=jupyter&logoColor=white" />

  <br />

  <!-- React / Frontend Web Stack -->
  <img src="https://img.shields.io/badge/React-18+-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-007ACC?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-Bundler-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-UI%20Layout-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" />

</div>

---


## 📁 Repository Structure

```text
pgcet-karnataka-omr-evaluator-unofficial/
├── python-omr-engine/       # Data Science Core (Jupyter Pipeline)
│   ├── pdf/                 # Target pdf directories(please upload/add your center wise pdf in here ex: 102.pdf)
│   ├── answerkey.csv        # Relational dataset matching exam answer keys
│   └── omr_processor.ipynb  # Core computer vision alignment & evaluation script
│
└── pgcet-karnataka-omr-evaluator-unofficial-react-app/               # Asynchronous Web Production Framework (Vite + React)
    ├── assets/
    ├── public/
    │   └── pdf/             # Storage for relational center-wise mapping indexes
    │       ├── 102_answersheet_pages_indexed.csv
    │       ├── 106_answersheet_pages_indexed.csv
    │       └── [please upload/add your center wise pdf in here ex: 102.pdf]
    ├── src/
    │   ├── data/
    │   │   ├── answerKey.ts # Structured TypeScript master keys
    │   │   └── districts.ts # District lookup collections
    │   ├── utils/
    │   │   └── omrProcessor.ts # In-browser canvas processing engine
    │   ├── App.tsx
    │   ├── index.css
    │   ├── main.tsx
    │   └── types.ts
    ├── index.html
    ├── metadata.json
    ├── server.ts
    ├── tsconfig.json
    └── vite.config.ts

```

---

## 📥 Document Requirements & User Instructions

To ensure strict data privacy compliance and remove heavy server overhead liabilities, **this repository does not host or distribute official student OMR sheets.** ### How to use your documents:

1. Navigate to the official KEA portal and download your center-wise scanned response document.
2. Provide the local file stream path inside the Python environment or upload the PDF directly to the web dashboard interface.
3. The processing pipeline isolates the bubble grid and discards personal identifier metadata immediately upon scoring.

---

## 🧠 Core Technical Highlights

### 1. Dynamic Shift Alignment via Profile Density Gradients

Physical document feeders introduce inevitable vertical translation variances and slight rotational shifts, throwing off static layout bounding boxes. To dynamically realign the target grid arrays, the computer vision engine maps an image density profile across the vertical axis utilizing a sliced matrix mean:

$$\text{profile} = \frac{1}{W} \sum_{x} V[y, x]$$

By calculating the discrete first-order difference vector ($\Delta V$) across this matrix string, the system instantly identifies the target anchor boundaries:

$$\Delta V = \frac{d}{dy}(\text{profile})$$

The script uses $\text{argmax}(\Delta V)$ to track the primary white-to-dark gradient peak, calculating global pixel displacement down to micro-point units to shift all answer part boxes (`parts_base`) into pixel-perfect registration.

### 2. Multi-Channel Color Separation Logic

Relying on standard grayscale thresholds often causes the system to drop lighter blue ink selections or faint black pen marks. This extraction pipeline evaluates raw RGB tensors directly, isolating luminance channels to verify marks reliably while isolating overlapping multi-bubble collisions:

```python
# Sliced target from: python-omr-engine/omr_processor.ipynb
max_r = max(cell['darkness'] for cell in row_cells)
min_r = min(cell['darkness'] for cell in row_cells)
row_delta = max_r - min_r

if row_delta > 35:
    for cell in row_cells:
        # Evaluate dark graphite / black ink thresholds
        is_black_ink = cell['darkness'] < 145 or cell['darkness'] < (max_r * 0.80)
        # Evaluate blue pen spectrum offsets against red light channel wavelengths
        is_blue_ink = (cell['b_val'] - cell['r_val'] > 15) and (cell['r_val'] < 175)
        
        if is_black_ink or is_blue_ink:
            detected.append(option_labels[cell['index']])

```

---

## 🛠️ Installation & Quick Start

### 🐍 running the Python Data Science Engine
```bash
git clone https://github.com/M-INDN-SEDTA/pgcet-karnataka-omr-evaluator-unofficial.git
cd pgcet-karnataka-omr-evaluator-unofficial
```

Navigate to the engine directory, configure your localized environment dependencies, and run the notebook to evaluate target sheets locally:

```bash
cd python-omr-engine
pip install pdfplumber matplotlib numpy pandas
jupyter notebook omr_processor.ipynb

```

### ⚛️ Launching the Web Client Dashboard

Spin up the fast client environment to interact with the visual interface wrapper:

```bash
cd pgcet-karnataka-omr-evaluator-unofficial-react-app
npm install
npm run dev
```
>Open in browswer below link
```bash
 http://localhost:3000
 ```

# Note: Before you run above please upload/add your center wise pdf in public/pdf fodler for ex: public/pdf/102.pdf
---

## 🛡️ Security & Privacy Guardrails

* **Client-Side Sanitation:** The React web workspace runs exclusively within browser memory using `pdfjs`. Uploaded documents never traverse a network or store on external remote storage vectors.
* **PII Redaction:** The processing logic strictly clips processing bounds to response matrices, completely cropping out names, registration tracking signatures, and handwritten records.