#!/usr/bin/env python3

import os
import pdfplumber
import numpy as np
import pandas as pd

# =====================================================
# CONFIGURATION
# =====================================================

PDF_PATH = "pdf/102.pdf"
PAGE_NUMBER = 1
RESOLUTION = 150
CSV_KEY_PATH = "answerkey.csv"

PARTS_BASE = [
    ("Part 1 (Q1-25)", (305, 580), (383, 1050), 1),
    ("Part 2 (Q26-50)", (418, 580), (498, 1050), 26),
    ("Part 3 (Q51-75)", (550, 580), (625, 1050), 51),
    ("Part 4 (Q76-100)", (664, 580), (740, 1050), 76),
]

OPTION_LABELS = ["1", "2", "3", "4"]

CROP_TOP_LEFT = (410, 493)
CROP_BOTTOM_RIGHT = (555, 545)


def calculate_version_shift(page, pil_img):
    pdf_width, pdf_height = page.width, page.height
    img_width, img_height = pil_img.size

    x0, y0 = CROP_TOP_LEFT
    x1, y1 = CROP_BOTTOM_RIGHT

    px0 = int(x0 * img_width / pdf_width)
    px1 = int(x1 * img_width / pdf_width)
    py0 = int(y0 * img_height / pdf_height)
    py1 = int(y1 * img_height / pdf_height)

    version_crop = pil_img.crop((px0, py0, px1, py1))
    v = np.array(version_crop.convert("L"))

    h, w = v.shape

    col_start = int(w * 0.28)
    col_end = int(w * 0.32)

    profile = np.mean(v[:, col_start:col_end], axis=1)
    grad = np.diff(profile)

    peak = np.argmax(grad)

    white_y = peak

    for i in range(peak, len(profile)):
        if i < len(grad) and grad[i] <= 1.0:
            white_y = i
            break

    pixel_shift = max(0, white_y - 6)
    pdf_shift = pixel_shift * (pdf_height / img_height)

    return pdf_shift, v


def detect_version_code(v):
    h, w = v.shape

    top_labels = ["A", "B", "C", "D"]
    bottom_labels = ["1", "2", "3", "4"]

    top_scores = []
    bottom_scores = []

    for i in range(4):
        x_s = int(i * w / 4)
        x_e = int((i + 1) * w / 4)

        top_box = v[0:int(h / 2), x_s:x_e]
        bottom_box = v[int(h / 2):h, x_s:x_e]

        top_scores.append(np.mean(top_box))
        bottom_scores.append(np.mean(bottom_box))

    top_idx = np.argmin(top_scores)
    bottom_idx = np.argmin(bottom_scores)

    return f"{top_labels[top_idx]}{bottom_labels[bottom_idx]}"


def evaluate_omr(page, pil_img, pdf_shift):
    pdf_width, pdf_height = page.width, page.height
    img_width, img_height = pil_img.size

    evaluation_results = {}

    parts_shifted = []

    for name, (x0, y0), (x1, y1), start_q in PARTS_BASE:
        parts_shifted.append(
            (name, (x0, y0 + pdf_shift), (x1, y1 + pdf_shift), start_q)
        )

    for part_name, start_pt, end_pt, start_q_no in parts_shifted:

        x0, y0 = start_pt
        x1, y1 = end_pt

        px0 = int(x0 * img_width / pdf_width)
        px1 = int(x1 * img_width / pdf_width)
        py0 = int(y0 * img_height / pdf_height)
        py1 = int(y1 * img_height / pdf_height)

        crop = pil_img.crop((px0, py0, px1, py1))
        rgb = np.array(crop.convert("RGB"))

        h2, w2 = rgb.shape[:2]

        col_step = w2 / 4
        row_step = h2 / 25

        for r in range(25):

            q = start_q_no + r

            y_s = int(r * row_step)
            y_e = int((r + 1) * row_step)

            detected = []
            row_cells = []

            for c in range(4):

                x_s = int(c * col_step)
                x_e = int((c + 1) * col_step)

                cell_rgb = rgb[y_s:y_e, x_s:x_e]

                ch, cw, _ = cell_rgb.shape

                inner_cell = cell_rgb[
                    int(ch * 0.15):int(ch * 0.85),
                    int(cw * 0.15):int(cw * 0.85)
                ]

                r_channel = inner_cell[:, :, 0]
                b_channel = inner_cell[:, :, 2]

                r_mean = np.mean(r_channel)
                b_mean = np.mean(b_channel)

                row_cells.append({
                    "index": c,
                    "r_val": r_mean,
                    "b_val": b_mean,
                    "darkness": r_mean
                })

            max_r = max(cell["darkness"] for cell in row_cells)
            min_r = min(cell["darkness"] for cell in row_cells)

            row_delta = max_r - min_r

            if row_delta > 35:

                for cell in row_cells:

                    is_black_ink = (
                        cell["darkness"] < 145
                        or cell["darkness"] < (max_r * 0.80)
                    )

                    is_blue_ink = (
                        (cell["b_val"] - cell["r_val"] > 15)
                        and (cell["r_val"] < 175)
                    )

                    if is_black_ink or is_blue_ink:
                        detected.append(
                            OPTION_LABELS[cell["index"]]
                        )

            if len(detected) == 1:
                evaluation_results[q] = detected[0]
            elif len(detected) > 1:
                evaluation_results[q] = (
                    f"Multiple ({','.join(detected)})"
                )
            else:
                evaluation_results[q] = "Blank"

    return evaluation_results


def compare_with_answer_key(version_code, evaluation_results):
    print("\n==============================")
    print("OMR PERFORMANCE GRADE SUMMARY")
    print("==============================")

    key_df = pd.read_csv(CSV_KEY_PATH)

    target_column = (
        version_code
        if version_code in key_df.columns
        else "A1"
    )

    print(f"Loading Key Column from CSV: [{target_column}]")

    correct_answers = key_df[target_column].tolist()

    total_correct = 0
    total_wrong = 0
    total_blank = 0
    total_multiple = 0

    print(f"\n{'Q.No':<6}{'Extracted':<15}{'Correct Key':<15}{'Status'}")
    print("-" * 52)

    for q in sorted(evaluation_results):

        student_ans = evaluation_results[q]
        correct_ans = str(correct_answers[q - 1])

        if student_ans == "Blank":
            status = "BLANK"
            total_blank += 1

        elif "Multiple" in student_ans:
            status = "MULTIPLE (WRONG)"
            total_multiple += 1
            total_wrong += 1

        elif student_ans == correct_ans:
            status = "CORRECT"
            total_correct += 1

        else:
            status = "WRONG"
            total_wrong += 1

        print(
            f"Q{q:<5}"
            f"{student_ans:<15}"
            f"{correct_ans:<15}"
            f"{status}"
        )

    print("=" * 52)
    print(f"TOTAL SCORE CALCULATION      : {total_correct} / 100")
    print(f"-> Total Correct Answers     : {total_correct}")
    print(
        f"-> Total Incorrect Answers   : {total_wrong} "
        f"(including {total_multiple} multi-mark instances)"
    )
    print(f"-> Total Blanks              : {total_blank}")
    print("=" * 52)


def main():

    if not os.path.exists(PDF_PATH):
        print(f"PDF not found: {PDF_PATH}")
        return

    if not os.path.exists(CSV_KEY_PATH):
        print(f"Answer key CSV not found: {CSV_KEY_PATH}")
        return

    with pdfplumber.open(PDF_PATH) as pdf:

        page = pdf.pages[PAGE_NUMBER - 1]

        page_image = page.to_image(resolution=RESOLUTION)
        pil_img = page_image.original

        pdf_shift, version_array = calculate_version_shift(
            page,
            pil_img
        )

        print("\n==============================")
        print(f"GLOBAL SHIFT: {pdf_shift:.2f} PDF points")
        print("==============================\n")

        version_code = detect_version_code(version_array)

        print(
            f"DETECTED LAYOUT VERSION CODE: {version_code}"
        )

        evaluation_results = evaluate_omr(
            page,
            pil_img,
            pdf_shift
        )

        compare_with_answer_key(
            version_code,
            evaluation_results
        )


if __name__ == "__main__":
    main()