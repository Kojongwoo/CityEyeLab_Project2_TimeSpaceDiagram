// index.js (전체 코드를 아래 내용으로 교체)

import Handsontable from 'handsontable';
import * as XLSX from 'xlsx';
import 'handsontable/dist/handsontable.min.css';
import Papa from 'papaparse';

let hot;

// === 모드 상태 관리 ===
let isDrawMode = false;
let isDeleteDrawnMode = false;
let isMoveMode = false;

// === 그리기 관련 변수 ===
let isDrawing = false;
let lineStart = null;
let currentLinePreviewEnd = null;
// ▼▼▼ 삭제: drawnTrajectories는 더 이상 사용되지 않습니다.
// let drawnTrajectories = []; 
let currentHint = null;

// === 이동 관련 변수 ===
// ▼▼▼ 수정: 모든 궤적을 selectedAutoTrajectoryId로 관리합니다.
let selectedAutoTrajectoryId = null;
let isMoving = false;
let dragStartPoint = null;

// === 데이터 및 스케일 변수 ===
let globalGreenWindows = [];
let globalEndTime = 0;
let scaleState = null;
// ▼▼▼ 수정: globalAutoTrajectories도 직접 사용하지 않고 autoTrajectoriesById로 통합됩니다.
// let globalAutoTrajectories = []; 
let autoTrajectoriesById = {}; 
let intersectionData = []; 

// 방향, SA 번호 전역 변수
let globalDirection = '';
let globalSaNum = '';

// === 고정 속도 모드 ===
let isFixedSpeedMode = false;
let fixedSpeedKph = null;

// ▼▼▼ 삭제: comparisonIndices는 더 이상 사용되지 않습니다.
// let comparisonIndices = [];

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

    document.getElementById('FileInput').addEventListener('change', handleFileUpload);
    document.getElementById("form").addEventListener("submit", handleFormSubmit);
    document.getElementById("saveExcelBtn").addEventListener("click", handleSaveExcel);
    setupModeToggles();

    // ▼▼▼ 삭제: 거리 계산 버튼 이벤트 리스너 제거
    // document.getElementById("distanceBtn").addEventListener("click", calculateAndShowDifference);
});


// ==================================================================
//  핵심 기능 핸들러 (변경 없음)
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

    globalDirection = direction;
    globalSaNum = sa_num;      

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
        if (json.file_prefix) {
            document.getElementById("canvasSection").style.display = "block";
            drawCanvasFromCsv(json.file_prefix, payload.end_time, payload.direction, payload.sa_num);
        } else {
            alert("❌ 시공도 파일 정보를 가져오지 못했습니다.");
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
//  모드 관리 (Mode Management)
// ==================================================================

const toggles = {};

function setupModeToggles() {
    toggles.draw = { input: document.getElementById("drawToggle"), label: document.getElementById("drawStateLabel") };
    toggles.delete = { input: document.getElementById("deleteDrawnToggle"), label: document.getElementById("deleteDrawnLabel") };
    toggles.move = { input: document.getElementById("moveToggle"), label: document.getElementById("moveStateLabel") };

    Object.entries(toggles).forEach(([modeName, elements]) => {
        elements.input.addEventListener("change", (e) => {
            setMode(e.target.checked ? modeName : 'none');
        });
    });

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

    // ▼▼▼ 삭제: 거리 계산 버튼은 더 이상 사용하지 않음
    // document.getElementById("distanceBtn").addEventListener("click", calculateAndShowDifference);
}

// ▼▼▼ 삭제: 거리 계산 함수는 더 이상 사용하지 않음
// function calculateAndShowDifference() { ... }

function setMode(activeMode) {
    isDrawMode = false;
    isDeleteDrawnMode = false;
    isMoveMode = false;

    Object.values(toggles).forEach(elements => {
        elements.input.checked = false;
        elements.label.textContent = "OFF";
        elements.label.style.color = "#888";
    });

    if (activeMode && toggles[activeMode]) {
        if (activeMode === 'draw') isDrawMode = true;
        if (activeMode === 'delete') isDeleteDrawnMode = true;
        if (activeMode === 'move') isMoveMode = true;

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
        // ▼▼▼ 수정: 모든 궤적 선택 로직 통합
        const clickedAutoId = findClickedAutoTrajectoryId(coords);
        if (clickedAutoId) {
            selectedAutoTrajectoryId = clickedAutoId;
            isMoving = true;
            dragStartPoint = coords;
        }
        redrawCanvas();
    } 
    // ▼▼▼ 삭제: 비교 모드 로직 제거
});

canvas.addEventListener("mousemove", (e) => {
    const coords = getCanvasCoords(e);

    if (isDrawMode && isDrawing) {
        currentLinePreviewEnd = coords;
        updateDrawingHint(coords);
        redrawCanvas();
    } else if (isMoveMode && isMoving) {
        // ▼▼▼ 수정: 이동 로직 통합
        if (selectedAutoTrajectoryId) {
            const dx = coords.x - dragStartPoint.x;
            const dy = coords.y - dragStartPoint.y;
            const dTime = pxToTime(coords.x) - pxToTime(dragStartPoint.x);
            const dPos = pxToPos(dragStartPoint.y + dy) - pxToPos(dragStartPoint.y);

            const pathToMove = autoTrajectoriesById[selectedAutoTrajectoryId];
            if (pathToMove) {
                pathToMove.forEach(point => {
                    point.time += dTime;
                    point.position += dPos;
                });
            }
            dragStartPoint = coords;
            redrawCanvas();
        }
    }
});

canvas.addEventListener("mouseup", (e) => {
    // ▼▼▼ 수정: 그리기 모드 종료 시 재계산 로직 호출
    if (isDrawMode && isDrawing) {
        const startTime = pxToTime(lineStart.x);
        const startPosition = pxToPos(lineStart.y);

        // 새 궤적 생성
        const newPath = recalculateTrajectory(startTime, startPosition);
        
        // 고유 ID 부여 및 저장
        const newId = `manual_${Date.now()}`;
        autoTrajectoriesById[newId] = newPath;

        isDrawing = false;
        lineStart = null;
        currentLinePreviewEnd = null;
        currentHint = null;
        redrawCanvas();

    } else if (isMoveMode && isMoving) {
        if (selectedAutoTrajectoryId) {
            const movedPath = autoTrajectoriesById[selectedAutoTrajectoryId];
            if (movedPath && movedPath.length > 0) {
                const newStartTime = movedPath[0].time;
                const newStartPosition = movedPath[0].position;
                const newPath = recalculateTrajectory(newStartTime, newStartPosition);
                autoTrajectoriesById[selectedAutoTrajectoryId] = newPath;
            }
        }
        isMoving = false;
        dragStartPoint = null;
        redrawCanvas();
    }
});

canvas.addEventListener("click", (e) => {
    // ▼▼▼ 수정: 삭제 로직 통합
    if (isDeleteDrawnMode) {
        const coords = getCanvasCoords(e);
        const idToDelete = findClickedAutoTrajectoryId(coords);
        if (idToDelete) {
            delete autoTrajectoriesById[idToDelete];
            // 선택 상태 초기화
            if (selectedAutoTrajectoryId === idToDelete) {
                selectedAutoTrajectoryId = null;
            }
            redrawCanvas();
        }
    }
});

// ==================================================================
//  헬퍼 및 계산 함수
// ==================================================================

function recalculateTrajectory(startTime, startPosition) {
    const newPath = [];
    let currentTime = startTime;
    let currentPos = startPosition;

    newPath.push({ time: currentTime, position: currentPos });

    let startIntersectionIndex = intersectionData.findIndex(i => i.cumulative_distance >= currentPos);
    if (startIntersectionIndex === -1) startIntersectionIndex = 0;
    
    // 시작 교차로에서 이전 교차로까지의 거리는 0으로 처리
    if (startIntersectionIndex > 0) {
        currentPos = intersectionData[startIntersectionIndex -1].cumulative_distance;
    }


    for (let i = startIntersectionIndex; i < intersectionData.length; i++) {
        const intersection = intersectionData[i];
        
        // 현재 위치에서 다음 교차로까지의 거리
        const dist = intersection.cumulative_distance - currentPos;
        if (dist <= 0) continue;

        const speed = intersection.speed_limit_kph / 3.6;
        if (speed <= 0) continue;

        const travelTime = dist / speed;
        let arrivalTime = currentTime + travelTime;
        const nextPos = intersection.cumulative_distance;

        // 이동 구간(경사) 보간
        const timePoints = Array.from({length: Math.round(travelTime) + 1}, (_, j) => currentTime + j);
        timePoints.push(arrivalTime);
        for(const t of timePoints) {
            const fraction = (t - currentTime) / travelTime;
            newPath.push({
                time: t,
                position: currentPos + (nextPos - currentPos) * fraction,
            });
        }
        
        currentTime = arrivalTime;
        currentPos = nextPos;
        
        const greenWindowsForIntersection = globalGreenWindows.filter(
            w => w.intersection_name === intersection.intersection_name
        );
        
        let canPass = greenWindowsForIntersection.some(
            w => arrivalTime >= w.green_start_time && arrivalTime <= w.green_end_time
        );

        if (!canPass) {
            const futureGreens = greenWindowsForIntersection
                .filter(w => w.green_start_time >= arrivalTime)
                .sort((a, b) => a.green_start_time - b.green_start_time);

            if (futureGreens.length > 0) {
                const nextGreenStart = futureGreens[0].green_start_time;
                // 대기 구간(수평) 보간
                const waitPoints = Array.from({length: Math.round(nextGreenStart - arrivalTime) + 1}, (_, j) => arrivalTime + j);
                for(const t of waitPoints) {
                    if (t <= nextGreenStart) newPath.push({ time: t, position: currentPos });
                }
                currentTime = nextGreenStart;
            } else {
                break;
            }
        }
    }
    const uniquePath = Array.from(new Map(newPath.map(p => [Math.round(p.time), p])).values());
    return uniquePath.sort((a,b) => a.time - b.time);
}

function findClickedAutoTrajectoryId(coords) {
    if (!autoTrajectoriesById) return null;
    for (const vehicleId in autoTrajectoriesById) {
        const path = autoTrajectoriesById[vehicleId];
        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i+1];
            const p1_px = { x: timeToPx(p1.time), y: posToPx(p1.position) };
            const p2_px = { x: timeToPx(p2.time), y: posToPx(p2.position) };
            const distance = pointToLineDistance(coords.x, coords.y, p1_px.x, p1_px.y, p2_px.x, p2_px.y);
            if (distance < 5) {
                return vehicleId;
            }
        }
    }
    return null;
}

// ▼▼▼ 삭제: findClickedTrajectoryIndex는 더 이상 사용하지 않음
// function findClickedTrajectoryIndex(coords) { ... }

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

// ▼▼▼ 삭제: updateTrajectoryData는 더 이상 사용하지 않음
// function updateTrajectoryData(traj) { ... }

function updateDrawingHint(coords) {
    // 힌트 기능은 단순화하여 위치만 표시
    currentHint = { x: coords.x + 10, y: coords.y - 10 };
}

// ==================================================================
//  캔버스 렌더링
// ==================================================================

function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawOnCanvas(globalGreenWindows, globalEndTime, globalDirection, globalSaNum);

    if (autoTrajectoriesById) {
        const trajectoryColors = ['#E6194B', '#3CB44B', '#4363D8', '#F58231', '#911EB4', '#000000', '#F032E6'];
        let colorIndex = 0;

        for (const id in autoTrajectoriesById) {
            const path = autoTrajectoriesById[id].sort((a, b) => a.time - b.time);

            if (id === selectedAutoTrajectoryId) {
                ctx.strokeStyle = "#e91e63"; 
                ctx.lineWidth = 2.5;
            } else {
                ctx.strokeStyle = trajectoryColors[colorIndex % trajectoryColors.length];
                ctx.lineWidth = 1.5; // 선 굵기 1.5로 일괄 조정
            }
            ctx.setLineDash([]);
            
            if (path.length > 1) {
                ctx.beginPath();
                ctx.moveTo(timeToPx(path[0].time), posToPx(path[0].position));
                for (let i = 1; i < path.length; i++) {
                    ctx.lineTo(timeToPx(path[i].time), posToPx(path[i].position));
                }
                ctx.stroke();
            }
            colorIndex++;
        }
    }
    
    // ▼▼▼ 삭제: drawnTrajectories 그리기 로직 제거
    
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
    if (currentHint) {
        drawHintBadge(currentHint);
    }
}

// ▼▼▼ 삭제: drawTextOnTrajectory는 더 이상 사용하지 않음
// function drawTextOnTrajectory(traj) { ... }

function drawHintBadge(hint) {
    // 힌트 뱃지는 더 이상 속도/각도를 표시하지 않음
    const text = `궤적 시작점`;
    drawInfoBadge(text, hint.x, hint.y);
}

function drawInfoBadge(text, x, y) {
    ctx.save();
    ctx.font = "12px 'Malgun Gothic'";
    const pad = 6;
    const w = ctx.measureText(text).width + pad * 2;
    const h = 20;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(text, x + pad, y - 5);
    ctx.restore();
}

function timeToPx(t) { return scaleState ? scaleState.plotLeft + (t / scaleState.end_time) * scaleState.plotWidth : 0; }
function posToPx(pos) { return scaleState ? scaleState.plotBottom - ((pos - scaleState.minPos) / scaleState.posRange) * scaleState.plotHeight : 0; }
function pxToTime(x) { return scaleState ? ((x - scaleState.plotLeft) / scaleState.plotWidth) * scaleState.end_time : 0; }
function pxToPos(y) { return scaleState ? scaleState.minPos + ((scaleState.plotBottom - y) / scaleState.plotHeight) * scaleState.posRange : 0; }


// ==================================================================
//  CSV 로드 및 Canvas 배경 그리기
// ==================================================================

async function drawCanvasFromCsv(filePrefix, end_time, direction, sa_num) {
    if (!filePrefix) {
        alert("파일명이 지정되지 않았습니다!");
        return;
    }

    globalEndTime = parseFloat(end_time);
    autoTrajectoriesById = {};
    selectedAutoTrajectoryId = null;
    
    const greenUrl = `/static/output/${filePrefix}_green_windows.csv`;
    const trajUrl = `/static/output/${filePrefix}_trajectories.csv`;

    try {
        const [greenData, trajData] = await Promise.all([
            loadCSV(greenUrl),
            loadCSV(trajUrl).catch(err => {
                console.warn("자동 궤적 데이터 로드 실패.", err);
                return [];
            })
        ]);

        globalGreenWindows = greenData;
        const globalAutoTrajectories = trajData;

        if (globalGreenWindows.length > 0) {
            const uniqueIntersections = new Map();
            globalGreenWindows.forEach(row => {
                if (!uniqueIntersections.has(row.intersection_name)) {
                    uniqueIntersections.set(row.intersection_name, row);
                }
            });
            intersectionData = [...uniqueIntersections.values()].sort((a,b) => a.cumulative_distance - b.cumulative_distance);
        }

        if (globalAutoTrajectories.length > 0) {
            autoTrajectoriesById = globalAutoTrajectories.reduce((acc, row) => {
                const id = row.vehicle_id;
                if (!acc[id]) acc[id] = [];
                acc[id].push(row);
                return acc;
            }, {});
        }

        redrawCanvas();

    } catch (error) {
        alert("필수 데이터(녹색 신호) 로드에 실패했습니다. " + error.message);
        console.error("필수 데이터 로드 실패:", error);
    }
}


async function loadCSV(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load CSV from ${url}: ${res.statusText}`);
    }
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
    return parsed.data;
}


function drawOnCanvas(green_windows, end_time, direction = '', sa_num = '') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const leftMargin = 80, rightMargin = 30, topMargin = 60, bottomMargin = 70;
    const plotLeft = leftMargin, plotRight = canvas.width - rightMargin;
    const plotTop = topMargin, plotBottom = canvas.height - bottomMargin;
    const plotWidth = plotRight - plotLeft, plotHeight = plotBottom - plotTop;
    let minPos = 0, maxPos = 0;
    if (intersectionData && intersectionData.length > 0) {
        const positions = intersectionData.map(row => parseFloat(row.cumulative_distance));
        minPos = Math.min(...positions);
        maxPos = Math.max(...positions);
    } else {
        minPos = 0; maxPos = 1000;
    }
    const yMargin = 20;
    minPos -= yMargin;
    maxPos += yMargin;
    const posRange = maxPos - minPos || 1;
    scaleState = {
        plotLeft, plotRight, plotTop, plotBottom, plotWidth, plotHeight,
        minPos, posRange, end_time
    };
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
    drawAxesAndLabels(direction, sa_num);
}

function drawAxesAndLabels(direction, sa_num) {
    if (!scaleState) return;
    const { plotLeft, plotRight, plotTop, plotBottom, end_time } = scaleState;
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotTop);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.moveTo(plotLeft, plotBottom);
    ctx.lineTo(plotRight, plotBottom);
    ctx.stroke();

    ctx.font = "12px 'Malgun Gothic'";
    ctx.fillStyle = "#222";
    ctx.textAlign = "right";

    if(intersectionData) {
        intersectionData.forEach((current, i) => {
            ctx.fillText(current.intersection_name, plotLeft - 10, posToPx(current.cumulative_distance) + 4);
            if (i < intersectionData.length - 1) {
                const next = intersectionData[i+1];
                const dist = Math.round(next.cumulative_distance - current.cumulative_distance);
                if (dist > 0) {
                    const midY = (current.cumulative_distance + next.cumulative_distance) / 2;
                    ctx.fillStyle = "#666";
                    ctx.fillText(`↕ ${dist}m`, plotLeft - 10, posToPx(midY) + 4);
                    ctx.fillStyle = "#222";
                }
            }
        });
    }

    ctx.textAlign = "center";
    ctx.font = "14px 'Malgun Gothic'";
    for (let t = 0; t <= end_time; t += 10) {
        const x = timeToPx(t);
        if (t % 100 === 0) {
            ctx.fillText(`${t}`, x, plotBottom + 28);
            ctx.beginPath();
            ctx.moveTo(x, plotBottom);
            ctx.lineTo(x, plotBottom + 8);
            ctx.stroke();
        } else if (t % 50 === 0) {
            ctx.beginPath();
            ctx.moveTo(x, plotBottom);
            ctx.lineTo(x, plotBottom + 4);
            ctx.stroke();
        }
    }
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