// index.js (전체 코드를 아래 내용으로 교체)

import Handsontable from 'handsontable';
import * as XLSX from 'xlsx';
import 'handsontable/dist/handsontable.min.css';

let hot;

// === 모드 상태 관리 ===
let isDrawMode = false;
let isDeleteDrawnMode = false;
let isMoveMode = false; // (신규) 이동 모드 상태 변수

// === 그리기 관련 변수 ===
let isDrawing = false;
let lineStart = null;
let currentLinePreviewEnd = null;
let drawnTrajectories = [];
let currentHint = null;

// === 이동 관련 변수 ===
let selectedTrajectoryIndex = -1;
let isMoving = false;
let dragStartPoint = null;

// === 데이터 및 스케일 변수 ===
let globalGreenWindows = [];
let globalTrajectories = [];
let globalEndTime = 0;
let scaleState = null;

// 방향, SA 번호 전역 변수
let globalDirection = '';
let globalSaNum = '';

// === 고정 속도 모드 ===
let isFixedSpeedMode = false;
let fixedSpeedKph = null;

let comparisonIndices = []; // 비교를 위해 선택된 궤적의 인덱스 2개를 저장합니다.

// ==================================================================
//  DOM 로드 후 초기 설정
// ==================================================================
document.addEventListener("DOMContentLoaded", function () {
    const container = document.getElementById('hot');
    hot = new Handsontable(container, {
        data: [], rowHeaders: true, colHeaders: true, width: '100%', height: 500,
        manualRowResize: true, stretchH: 'all', copyPaste: true, fragmentSelection: true,
        contextMenu: true, licenseKey: 'non-commercial-and-evaluation', minSpareRows: 1,
        minRows: 0, viewportRowRenderingOffset: 20, allowInsertRow: true,
        trimWhitespace: true, outsideClickDeselects: false, pasteMode: 'overwrite',
    });

    // 파일 업로드 이벤트
    document.getElementById('FileInput').addEventListener('change', handleFileUpload);
    // 폼 제출(시공도 생성) 이벤트
    document.getElementById("form").addEventListener("submit", handleFormSubmit);
    // 엑셀 저장 이벤트
    document.getElementById("saveExcelBtn").addEventListener("click", handleSaveExcel);

    // 모드 토글 스위치 설정
    setupModeToggles();
});


// ==================================================================
//  핵심 기능 핸들러
// ==================================================================

function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (event) {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
        if (rows.length === 0) return;
        const headers = rows[0];
        const cleaned = rows.slice(1).filter(row => row.some(cell => String(cell ?? "").trim() !== ""));
        hot.updateSettings({ data: cleaned, colHeaders: headers });
    };
    reader.readAsArrayBuffer(file);
}

function handleFormSubmit(e) {
    e.preventDefault();
    const direction = document.getElementById("direction").value.trim();
    const sa_num = document.getElementById("sa_num").value.trim();
    const end_time = document.getElementById("end_time").value.trim() || 400;

    // ▼ 아래 두 줄을 새로 추가합니다.
    globalDirection = direction; // 방향 정보 전역 변수에 저장
    globalSaNum = sa_num;       // SA 번호 정보 전역 변수에 저장

    if (!direction) return alert("⚠️ 방향을 입력하세요.");
    document.getElementById("loading").style.display = "block";

    const payload = { data: hot.getData(), direction, sa_num, end_time };
    fetch("/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(res => res.ok ? res.json() : res.json().then(err => { throw new Error(err.error) }))
    .then(json => {
        document.getElementById("loading").style.display = "none";
        if (json.image_url && json.file_prefix) {
            document.getElementById("canvasSection").style.display = "block";
            drawCanvasFromCsv(json.file_prefix, payload.end_time, payload.direction, payload.sa_num);
        } else {
            alert("❌ 시공도 이미지 URL을 가져오지 못했습니다.");
        }
    }).catch(err => {
        document.getElementById("loading").style.display = "none";
        alert(`❌ 시공도 생성 실패: ${err.message}`);
    });
}

function handleSaveExcel(e) {
    e.preventDefault();
    const payload = {
        rows: hot.getData().filter(row => row.some(cell => String(cell ?? "").trim() !== "")),
        headers: hot.getColHeader(),
        direction: document.getElementById("direction").value.trim(),
        sa_num: document.getElementById("sa_num").value.trim(),
        end_time: document.getElementById("end_time").value.trim(),
    };
    fetch("/save_excel_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(json => alert("✅ CSV 파일 저장 완료!\n경로: " + json.path))
    .catch(err => alert("❌ CSV 파일 저장 중 오류가 발생했습니다."));
}


// ==================================================================
//  모드 관리 (Mode Management) - 핵심 수정사항
// ==================================================================

const toggles = {}; // 토글 UI 요소들을 담을 객체

/** 모든 모드 토글 스위치를 초기화하고 이벤트를 연결합니다. */
function setupModeToggles() {
    toggles.draw = { input: document.getElementById("drawToggle"), label: document.getElementById("drawStateLabel") };
    toggles.delete = { input: document.getElementById("deleteDrawnToggle"), label: document.getElementById("deleteDrawnLabel") };
    toggles.move = { input: document.getElementById("moveToggle"), label: document.getElementById("moveStateLabel") }; // (신규)

    // 각 토글 스위치에 change 이벤트 리스너 추가
    Object.entries(toggles).forEach(([modeName, elements]) => {
        elements.input.addEventListener("change", (e) => {
            // 스위치가 켜지면 해당 모드를 활성화, 꺼지면 모든 모드를 비활성화
            setMode(e.target.checked ? modeName : 'none');
        });
    });

    // 고정 속도 모드 토글
    const fixedSpeedToggle = document.getElementById("fixedSpeedToggle");
    fixedSpeedToggle.addEventListener("change", (e) => {
        isFixedSpeedMode = e.target.checked;
        document.getElementById("fixedSpeedLabel").textContent = isFixedSpeedMode ? "ON" : "OFF";
        document.getElementById("fixedSpeedLabel").style.color = isFixedSpeedMode ? "#2e7d32" : "#888";
    });
    document.getElementById("fixedSpeedValue").addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        fixedSpeedKph = !isNaN(val) && val > 0 ? val : null;
    });
    document.getElementById("distanceBtn").addEventListener("click", calculateAndShowDifference);
}

/**
 * 선택된 두 궤적의 시간/거리 차이를 계산하고 결과를 표시하는 함수
 */
function calculateAndShowDifference() {
    // 1. 궤적이 2개 선택되었는지 확인
    if (comparisonIndices.length !== 2) {
        alert("⚠️ 비교할 두 개의 궤적을 먼저 선택해주세요.");
        return;
    }

    // 2. 선택된 두 궤적 정보 가져오기
    const traj1 = drawnTrajectories[comparisonIndices[0]];
    const traj2 = drawnTrajectories[comparisonIndices[1]];

    // 3. 각 궤적의 시작점을 기준으로 시간과 거리(위치) 값 계산
    const t1 = pxToTime(traj1.start.x);
    const p1 = pxToPos(traj1.start.y);

    const t2 = pxToTime(traj2.start.x);
    const p2 = pxToPos(traj2.start.y);

    // 4. 시간 차이와 거리 차이 계산 (절대값)
    const timeDiff = Math.abs(t1 - t2);
    const posDiff = Math.abs(p1 - p2);

    // 5. 결과를 화면에 표시
    const resultEl = document.getElementById("distanceResult");
    resultEl.textContent = `결과: ⏱️시간 차이 ${timeDiff.toFixed(1)}초, 📏거리 차이 ${posDiff.toFixed(1)}m`;
}

/**
 * 특정 모드를 활성화하고 나머지 모드는 모두 비활성화합니다.
 * @param {string} activeMode - 활성화할 모드 이름 ('draw', 'delete', 'move', 또는 'none')
 */
function setMode(activeMode) {
    // 1. 모든 모드 상태를 false로 초기화
    isDrawMode = false;
    isDeleteDrawnMode = false;
    isMoveMode = false;

    // 2. 모든 토글 UI를 'OFF' 상태로 초기화
    Object.values(toggles).forEach(elements => {
        elements.input.checked = false;
        elements.label.textContent = "OFF";
        elements.label.style.color = "#888";
    });

    // 3. 지정된 모드만 활성화
    if (activeMode && toggles[activeMode]) {
        if (activeMode === 'draw') isDrawMode = true;
        if (activeMode === 'delete') isDeleteDrawnMode = true;
        if (activeMode === 'move') isMoveMode = true;

        // 해당 모드의 토글 UI를 'ON' 상태로 변경
        toggles[activeMode].input.checked = true;
        toggles[activeMode].label.textContent = "ON";
        toggles[activeMode].label.style.color = "#2e7d32";
    }
}


// ==================================================================
//  캔버스 및 마우스 이벤트
// ==================================================================

const canvas = document.getElementById("diagramCanvas");
const ctx = canvas.getContext("2d");

function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener("mousedown", (e) => {
    const coords = getCanvasCoords(e);
    
    if (isDrawMode) {
        lineStart = coords;
        isDrawing = true;

    } else if (isMoveMode) {
        const clickedIndex = findClickedTrajectoryIndex(coords);
        if (clickedIndex !== -1 && clickedIndex === selectedTrajectoryIndex) {
            isMoving = true;
            dragStartPoint = coords;
        } else {
            selectedTrajectoryIndex = clickedIndex;
            isMoving = false;
        }
        redrawCanvas();
    } else { // 그리기, 이동 모드가 아닐 때 -> 비교 대상 선택 로직
        const clickedIndex = findClickedTrajectoryIndex(coords);
        
        if (clickedIndex !== -1) {
            const posInArray = comparisonIndices.indexOf(clickedIndex);
            
            if (posInArray > -1) {
                // 이미 선택된 궤적이면 배열에서 제거 (선택 해제)
                comparisonIndices.splice(posInArray, 1);
            } else if (comparisonIndices.length < 2) {
                // 새로 선택하고, 선택된 궤적이 2개 미만이면 배열에 추가
                comparisonIndices.push(clickedIndex);
            }
        }
        // 선택 상태가 변경되었으므로 캔버스를 다시 그림
        redrawCanvas();
    }
});

canvas.addEventListener("mousemove", (e) => {
    const coords = getCanvasCoords(e);

    if (isDrawMode && isDrawing) {
        currentLinePreviewEnd = coords;
        updateDrawingHint(coords);
        redrawCanvas();
    } else if (isMoveMode && isMoving && selectedTrajectoryIndex !== -1) {
        const dx = coords.x - dragStartPoint.x;
        const dy = coords.y - dragStartPoint.y;

        const trajectory = drawnTrajectories[selectedTrajectoryIndex];
        trajectory.start.x += dx;
        trajectory.start.y += dy;
        trajectory.end.x += dx;
        trajectory.end.y += dy;
        
        updateTrajectoryData(trajectory); // 속도, 각도 등 재계산

        dragStartPoint = coords;
        redrawCanvas();
    }
});

canvas.addEventListener("mouseup", (e) => {
    if (isDrawMode && isDrawing) {
        const lineEnd = getCanvasCoords(e);
        let finalEnd = lineEnd;
        
        if (isFixedSpeedMode && fixedSpeedKph) {
            const vMps = fixedSpeedKph / 3.6;
            const t0 = pxToTime(lineStart.x);
            const p0 = pxToPos(lineStart.y);
            const dx_time = pxToTime(lineEnd.x) - t0;
            const dp_dist = vMps * dx_time;
            const p1 = p0 + dp_dist;
            const t1 = t0 + dx_time;
            finalEnd = { x: timeToPx(t1), y: posToPx(p1) };
        }
        
        const newTraj = { start: lineStart, end: finalEnd };
        updateTrajectoryData(newTraj); // 초기 데이터 계산
        drawnTrajectories.push(newTraj);

        isDrawing = false;
        lineStart = null;
        currentLinePreviewEnd = null;
        currentHint = null;
        redrawCanvas();
    } else if (isMoveMode && isMoving) {
        isMoving = false;
        dragStartPoint = null;
    }
});

canvas.addEventListener("click", (e) => {
    if (isDeleteDrawnMode) {
        const coords = getCanvasCoords(e);
        const indexToDelete = findClickedTrajectoryIndex(coords);
        if (indexToDelete !== -1) {
            drawnTrajectories.splice(indexToDelete, 1);
            redrawCanvas();
        }
    }
});

// ==================================================================
//  헬퍼 및 계산 함수
// ==================================================================

/** 주어진 좌표에서 가장 가까운 궤적의 인덱스를 찾습니다. */
function findClickedTrajectoryIndex(coords) {
    return drawnTrajectories.findIndex(traj =>
        pointToLineDistance(coords.x, coords.y, traj.start.x, traj.start.y, traj.end.x, traj.end.y) < 5
    );
}

/** 점과 선분 사이의 최단 거리를 계산합니다. */
function pointToLineDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq !== 0 ? dot / lenSq : -1;
    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }
    return Math.sqrt((px - xx) ** 2 + (py - yy) ** 2);
}

/** 궤적 객체의 각도, 속도 등의 데이터를 계산하여 업데이트합니다. */
function updateTrajectoryData(traj) {
    const t0 = pxToTime(traj.start.x), p0 = pxToPos(traj.start.y);
    const t1 = pxToTime(traj.end.x), p1 = pxToPos(traj.end.y);
    const dt = t1 - t0;
    const dp = p1 - p0;
    traj.vMps = dt !== 0 ? dp / dt : 0;
    traj.vKph = traj.vMps * 3.6;
    let angle = Math.atan2(dp, dt) * 180 / Math.PI;
    traj.angleDeg = angle < 0 ? angle + 360 : angle;
}

/** 그리기 중 속도/각도 힌트를 업데이트합니다. */
function updateDrawingHint(coords) {
    const t0 = pxToTime(lineStart.x), p0 = pxToPos(lineStart.y);
    const t1 = pxToTime(coords.x), p1 = pxToPos(coords.y);
    const dt = t1 - t0;
    const dp = p1 - p0;
    const vMps = dt !== 0 ? dp / dt : 0;
    const vKph = vMps * 3.6;
    let angleDeg = Math.atan2(dp, dt) * 180 / Math.PI;
    if (angleDeg < 0) angleDeg += 360;
    currentHint = { angleDeg, vMps, vKph, x: coords.x + 10, y: coords.y - 10 };
}

// ==================================================================
//  캔버스 렌더링
// ==================================================================

/** 메인 캔버스 렌더링 함수 */
function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 배경(축, 녹색 신호) 그리기
    drawOnCanvas(globalTrajectories, globalGreenWindows, globalEndTime, globalDirection, globalSaNum);

    // 저장된 궤적들 그리기
    drawnTrajectories.forEach((traj, index) => {
        ctx.beginPath();

        // ▼ 선택 상태에 따라 스타일을 다르게 적용하는 로직 수정
        if (isMoveMode && index === selectedTrajectoryIndex) {
            ctx.strokeStyle = "#e91e63"; // 이동을 위해 선택 (핑크)
            ctx.lineWidth = 4;
        } else if (comparisonIndices.includes(index)) {
            ctx.strokeStyle = "#0d01af"; // 비교를 위해 선택 (파랑)
            ctx.lineWidth = 4;
        } else {
            ctx.strokeStyle = "#ff9800"; // 기본 (주황)
            ctx.lineWidth = 2;
        }
        
        ctx.moveTo(traj.start.x, traj.start.y);
        ctx.lineTo(traj.end.x, traj.end.y);
        ctx.stroke();
        drawTextOnTrajectory(traj);
    });

    // 그리기 미리보기
    if (isDrawMode && isDrawing && lineStart && currentLinePreviewEnd) {
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "#ff9800";
        ctx.lineWidth = 2;
        ctx.moveTo(lineStart.x, lineStart.y);
        ctx.lineTo(currentLinePreviewEnd.x, currentLinePreviewEnd.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    // 그리기 힌트
    if (currentHint) {
        drawHintBadge(currentHint);
    }

}

/** 궤적 위에 속도/각도 텍스트를 그립니다. */
function drawTextOnTrajectory(traj) {
    const text = `θ ${traj.angleDeg.toFixed(1)}° | v ${traj.vMps.toFixed(2)} m/s (${traj.vKph.toFixed(1)} km/h)`;
    const midX = (traj.start.x + traj.end.x) / 2;
    const midY = (traj.start.y + traj.end.y) / 2;
    drawInfoBadge(text, midX, midY);
}

/** 그리기 중 힌트 배지를 그립니다. */
function drawHintBadge(hint) {
    const text = `θ ${hint.angleDeg.toFixed(1)}° | v ${hint.vMps.toFixed(2)} m/s (${hint.vKph.toFixed(1)} km/h)`;
    drawInfoBadge(text, hint.x, hint.y);
}

/** 정보 배지(검은 배경 + 흰 글씨)를 그립니다. */
function drawInfoBadge(text, x, y) {
    ctx.save();
    ctx.font = "12px 'Malgun Gothic'";
    const pad = 6;
    const w = ctx.measureText(text).width + pad * 2;
    const h = 20;
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(text, x + pad, y - 5);
    ctx.restore();
}

// 캔버스 좌표 <-> 시공도 단위 변환
function timeToPx(t) { return scaleState ? scaleState.plotLeft + (t / scaleState.end_time) * scaleState.plotWidth : 0; }
function posToPx(pos) { return scaleState ? scaleState.plotBottom - ((pos - scaleState.minPos) / scaleState.posRange) * scaleState.plotHeight : 0; }
function pxToTime(x) { return scaleState ? ((x - scaleState.plotLeft) / scaleState.plotWidth) * scaleState.end_time : 0; }
function pxToPos(y) { return scaleState ? scaleState.minPos + ((scaleState.plotBottom - y) / scaleState.plotHeight) * scaleState.posRange : 0; }


// ==================================================================
//  CSV 로드 및 Canvas 배경 그리기
// ==================================================================

/**
 * 서버에서 생성된 CSV 파일들을 불러와 캔버스 그리기를 시작하는 메인 함수입니다.
 * @param {string} filePrefix - 서버에서 전달받은 파일의 기본 이름
 * @param {number} end_time - 종료 시간
 * @param {string} direction - 방향
 * @param {string} sa_num - SA 번호
 */
async function drawCanvasFromCsv(filePrefix, end_time, direction, sa_num) {
    if (!filePrefix) {
        alert("파일명이 지정되지 않았습니다!");
        return;
    }

    // 전역 변수에 데이터 저장
    globalEndTime = parseFloat(end_time);
    
    // 백엔드에서 생성된 궤적과 녹색신호 CSV를 불러옵니다.
    // 현재는 사용자가 직접 그리므로 globalTrajectories는 비어있을 수 있습니다.
    const trajUrl = `/static/output/${filePrefix}_trajectories.csv`;
    const greenUrl = `/static/output/${filePrefix}_green_windows.csv`;
    
    try {
        // globalTrajectories = await loadCSV(trajUrl);
        globalGreenWindows = await loadCSV(greenUrl);
    } catch (error) {
        console.warn("궤적 또는 녹색신호 데이터 로드 실패. 사용자가 직접 그리는 기능은 정상 작동합니다.", error);
        // 녹색신호 데이터 로드 실패 시, 빈 배열로 초기화하여 오류 방지
        if (!globalGreenWindows) globalGreenWindows = [];
    }


    // 캔버스에 기본 배경을 그립니다.
    drawOnCanvas(globalTrajectories, globalGreenWindows, globalEndTime, direction, sa_num);
}

/**
 * URL로부터 CSV 파일을 fetch하고 파싱하는 유틸리티 함수입니다.
 * @param {string} url - CSV 파일의 URL
 * @returns {Promise<Array>} - 파싱된 데이터 배열
 */
async function loadCSV(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load CSV from ${url}: ${res.statusText}`);
    }
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    return parsed.data;
}

/**
 * 캔버스의 기본 배경(축, 라벨, 녹색 신호 등)을 그리는 핵심 함수입니다.
 * @param {Array} trajectory - 궤적 데이터 (현재는 사용하지 않을 수 있음)
 * @param {Array} green_windows - 녹색 신호 데이터
 * @param {number} end_time - 종료 시간
 * @param {string} direction - 방향
 * @param {string} sa_num - SA 번호
 */
function drawOnCanvas(trajectory, green_windows, end_time, direction = '', sa_num = '') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. 그리기 영역(plot) 설정
    const leftMargin = 80, rightMargin = 30, topMargin = 60, bottomMargin = 70;
    const plotLeft = leftMargin, plotRight = canvas.width - rightMargin;
    const plotTop = topMargin, plotBottom = canvas.height - bottomMargin;
    const plotWidth = plotRight - plotLeft, plotHeight = plotBottom - plotTop;

    // 2. Y축(거리) 범위 계산
    let minPos = 0, maxPos = 0;
    if (green_windows && green_windows.length > 0) {
        const positions = green_windows.map(row => parseFloat(row.cumulative_distance)).filter(p => !isNaN(p));
        minPos = Math.min(...positions);
        maxPos = Math.max(...positions);
    } else {
        // 데이터가 없을 경우 기본값
        minPos = 0; maxPos = 1000;
    }
    
    const yMargin = 20;
    minPos -= yMargin;
    maxPos += yMargin;
    const posRange = maxPos - minPos || 1;

    // 3. 스케일 상태 전역 변수에 저장 (좌표 변환 함수들이 사용)
    scaleState = {
        plotLeft, plotRight, plotTop, plotBottom, plotWidth, plotHeight,
        minPos, posRange, end_time
    };

    // 4. 녹색 신호 그리기
    if (green_windows) {
        green_windows.forEach(row => {
            const y = posToPx(parseFloat(row.cumulative_distance));
            const start = Math.max(0, parseFloat(row.green_start_time));
            const end = parseFloat(row.green_end_time);
            const x1 = timeToPx(start);
            const x2 = timeToPx(end);
            
            ctx.strokeStyle = "green";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.lineTo(x2, y);
            ctx.stroke();
        });
    }

    // 5. 축, 라벨, 타이틀 그리기
    drawAxesAndLabels(direction, sa_num);
}

/** 축, 라벨, 타이틀 등 정적 요소를 그립니다. */
function drawAxesAndLabels(direction, sa_num) {
    if (!scaleState) return;
    const { plotLeft, plotRight, plotTop, plotBottom, end_time } = scaleState;
    
    // 축선
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotTop);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.moveTo(plotLeft, plotBottom);
    ctx.lineTo(plotRight, plotBottom);
    ctx.stroke();

    // ==========================================================
    // ▼ 1. 세로축(Y축) 수정: 교차로 이름 및 교차로 간 거리 표시
    // ==========================================================
    const intersections = [];
    const seen = new Set();
    if(globalGreenWindows) {
        globalGreenWindows.forEach(row => {
            const y = parseFloat(row.cumulative_distance);
            const key = row.intersection_name + '_' + y;
            if (row.intersection_name && !isNaN(y) && !seen.has(key)) {
                intersections.push({ 
                    name: row.intersection_name, 
                    y: y 
                });
                seen.add(key);
            }
        });
    }
    intersections.sort((a, b) => a.y - b.y);
    
    ctx.font = "12px 'Malgun Gothic'";
    ctx.fillStyle = "#222";
    ctx.textAlign = "right";

    intersections.forEach((current, i) => {
        // 교차로 이름 그리기
        ctx.fillText(current.name, plotLeft - 10, posToPx(current.y) + 4);

        // 다음 교차로와의 거리 계산 및 그리기
        if (i < intersections.length - 1) {
            const next = intersections[i+1];
            const dist = Math.round(next.y - current.y);
            if (dist > 0) {
                // 두 교차로의 중간 지점에 거리 정보 표시
                const midY = (current.y + next.y) / 2;
                ctx.fillStyle = "#666"; // 거리 라벨은 다른 색으로 표시
                ctx.fillText(`↕ ${dist}m`, plotLeft - 10, posToPx(midY) + 4);
                ctx.fillStyle = "#222"; // 다음 라벨을 위해 색상 복원
            }
        }
    });

    // ==========================================================
    // ▼ 2. 가로축(X축) 수정: 시간 눈금 더 촘촘하게 표시
    // ==========================================================
    ctx.textAlign = "center";
    ctx.font = "14px 'Malgun Gothic'";
    // 10초 간격으로 눈금을 그리도록 수정
    for (let t = 0; t <= end_time; t += 10) {
        const x = timeToPx(t);
        
        // 100초 단위는 숫자와 함께 긴 눈금으로 표시 (주 눈금)
        if (t % 100 === 0) {
            ctx.fillText(`${t}`, x, plotBottom + 28);
            ctx.beginPath();
            ctx.moveTo(x, plotBottom);
            ctx.lineTo(x, plotBottom + 8); // 눈금 길이 8px
            ctx.stroke();
        } else { // 50초 단위는 짧은 눈금만 표시 (보조 눈금)
            ctx.beginPath();
            ctx.moveTo(x, plotBottom);
            ctx.lineTo(x, plotBottom + 4); // 눈금 길이 4px
            ctx.stroke();
        }
    }

    // 타이틀 및 축 제목
    ctx.font = "18px 'Malgun Gothic'";
    ctx.textAlign = "center";
    ctx.fillText(`시공도 (방향: ${direction}, SA: ${sa_num || '전체'}, 0~${end_time}초)`, (plotLeft + plotRight) / 2, 32);
    ctx.font = "14px 'Malgun Gothic'";
    ctx.fillText("시간 (초)", (plotLeft + plotRight) / 2, canvas.height - 25);
    ctx.save();
    ctx.translate(plotLeft - 65, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("거리 기준 교차로 위치 (m)", 0, 0);
    ctx.restore();
}

// /** 축, 라벨, 타이틀 등 정적 요소를 그립니다. */
// function drawAxesAndLabels(direction, sa_num) {
//     if (!scaleState) return;
//     const { plotLeft, plotRight, plotTop, plotBottom, end_time } = scaleState;
    
//     // 축선
//     ctx.strokeStyle = "#222";
//     ctx.lineWidth = 1.5;
//     ctx.beginPath();
//     ctx.moveTo(plotLeft, plotTop);
//     ctx.lineTo(plotLeft, plotBottom);
//     ctx.moveTo(plotLeft, plotBottom);
//     ctx.lineTo(plotRight, plotBottom);
//     ctx.stroke();

//     // Y축 라벨 (교차로명)
//     const intersections = [];
//     const seen = new Set();
//     if(globalGreenWindows) {
//         globalGreenWindows.forEach(row => {
//             const y = parseFloat(row.cumulative_distance);
//             const key = row.intersection_name + '_' + y;
//             if (row.intersection_name && !isNaN(y) && !seen.has(key)) {
//                 intersections.push({ name: row.intersection_name, y: y });
//                 seen.add(key);
//             }
//         });
//     }
//     intersections.sort((a, b) => a.y - b.y);
    
//     ctx.font = "12px 'Malgun Gothic'";
//     ctx.fillStyle = "#222";
//     ctx.textAlign = "right";
//     intersections.forEach(({ name, y }) => {
//         ctx.fillText(name, plotLeft - 10, posToPx(y) + 4);
//     });

//     // X축 눈금 및 라벨
//     ctx.textAlign = "center";
//     ctx.font = "14px 'Malgun Gothic'";
//     for (let t = 0; t <= end_time; t += 100) {
//         const x = timeToPx(t);
//         ctx.fillText(`${t}`, x, plotBottom + 28);
//         ctx.beginPath();
//         ctx.moveTo(x, plotBottom);
//         ctx.lineTo(x, plotBottom + 6);
//         ctx.stroke();
//     }

//     // 타이틀 및 축 제목
//     ctx.font = "18px 'Malgun Gothic'";
//     ctx.textAlign = "center";
//     ctx.fillText(`시공도 (방향: ${direction}, SA: ${sa_num || '전체'}, 0~${end_time}초)`, (plotLeft + plotRight) / 2, 32);
//     ctx.font = "14px 'Malgun Gothic'";
//     ctx.fillText("시간 (초)", (plotLeft + plotRight) / 2, canvas.height - 25);
//     ctx.save();
//     ctx.translate(plotLeft - 65, (plotTop + plotBottom) / 2);
//     ctx.rotate(-Math.PI / 2);
//     ctx.fillText("거리 기준 교차로 위치 (m)", 0, 0);
//     ctx.restore();
// }