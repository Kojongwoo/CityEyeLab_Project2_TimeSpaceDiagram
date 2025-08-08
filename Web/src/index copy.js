import Handsontable from 'handsontable';
import * as XLSX from 'xlsx';
import 'handsontable/dist/handsontable.min.css';

let hot;

window.drawTimeSpaceDiagram = drawTimeSpaceDiagram;
window.drawCanvasFromCsv = drawCanvasFromCsv; // 필요시 사용

document.addEventListener("DOMContentLoaded", function() {
  const container = document.getElementById('hot');

  hot = new Handsontable(container, {
    data: [],
    rowHeaders: true,
    colHeaders: true,
    width: '100%',
    height: 500,
    manualRowResize: true,
    stretchH: 'all',
    copyPaste: true,
    fragmentSelection: true,
    contextMenu: true,
    licenseKey: 'non-commercial-and-evaluation',
    minSpareRows: 1,
    minRows: 0,
    viewportRowRenderingOffset: 20,
    allowInsertRow: true,
    trimWhitespace: true,
    outsideClickDeselects: false,
    pasteMode: 'overwrite',
    beforePaste: function(data, coords) {
      console.log("--- beforePaste 훅 실행 ---");
      console.log("클립보드 데이터 (원본):", data);
      console.log("붙여넣을 시작 셀 (좌표):", coords);
      console.log("------------------------");
    }
  });

  document.getElementById('FileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = function (event) {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];

        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: true
        });

        if (rows.length === 0) return;

        const headers = rows[0];
        const expectedCols = headers.length;

        const cleaned = rows.slice(1)
          .filter(row => row.some(cell => String(cell ?? "").trim() !== ""))
          .map(row => {
            while (row.length < expectedCols) row.push("");
            return row;
          });
        hot.updateSettings({
          data: cleaned,
          colHeaders: headers,
        });
      };
      reader.readAsArrayBuffer(file);
    }
  });

  document.getElementById("form").addEventListener("submit", function(e) {
    e.preventDefault();

    const direction = document.getElementById("direction").value.trim();
    const sa_num = document.getElementById("sa_num").value.trim();
    const end_time = document.getElementById("end_time").value.trim() || 400; // 기본값 400초

    console.log("[프론트] payload sa_num:", sa_num, "direction:", direction, "end_time:", end_time);

    if (!direction) {
      alert("⚠️ 방향을 입력하세요.");
      return;
    }

    // SA_num과 end_time은 선택적 입력이므로, 값이 있을 때만 유효성 검사
    if (sa_num && isNaN(sa_num)) {
      alert("⚠️ 유효한 SA_num 값을 입력하세요. (선택사항)");
      return;
    }

    if (end_time && (isNaN(end_time) || Number(end_time) <= 0)) {
      alert("⚠️ 유효한 종료 시간을 입력하세요. (선택사항)");
      return;
    }

    document.getElementById("loading").style.display = "block";

    const data = hot.getData();

    const payload = {
      data: data,
      direction: direction,
      sa_num: sa_num,
      end_time: end_time
    };

    fetch("/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
    .then(res => {
      // 서버에서 오류 응답이 오면 JSON으로 파싱하기 전에 확인
      if (!res.ok) {
        return res.json().then(error => {
            throw new Error(error.error || '시공도 생성 중 알 수 없는 오류 발생');
        });
      }
      return res.json();
    })
    .then(json => {
      document.getElementById("loading").style.display = "none";
      // json.image_url이 존재하지 않을 경우의 예외 처리 추가
      if (json.image_url) {
      // Canvas 영역 표시
      document.getElementById("canvasSection").style.display = "block";

        // Matplotlib 시공도 이미지 URL을 가져와서 표시
        // const imgTag = `
        //   <h2>Matplotlib 시공도 -> 궤적 이미지를 띄움.</h2>
        //   <img src="${json.image_url}" width="800">
        // `;
        // document.getElementById("image-result").innerHTML = imgTag;

        // (추가) canvas 자동 호출
        if(json.file_prefix) {
          drawCanvasFromCsv(json.file_prefix, payload.end_time, payload.direction, payload.sa_num);
        }
      } else {
        alert("❌ 시공도 이미지 URL을 가져오지 못했습니다.");
      }
    })
    // .catch(err => {
    //   document.getElementById("loading").style.display = "none";
    //   alert("❌ 시공도 생성 중 오류가 발생했습니다: " + err.message);
    //   console.error(err);
    // });
  });

  document.getElementById("saveExcelBtn").addEventListener("click", function(e) {
    e.preventDefault();

    const data = hot.getData();
    const headers = hot.getColHeader();
    const direction = document.getElementById("direction").value.trim();
    const sa_num = document.getElementById("sa_num").value.trim();
    const end_time = document.getElementById("end_time").value.trim();

    // 빈 배열을 전송하지 않도록 필터링
    const cleanedData = data.filter(row => row.some(cell => String(cell ?? "").trim() !== ""));

    fetch("/save_excel_csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: cleanedData, // 필터링된 데이터 사용
        headers: headers,
        direction: direction,
        sa_num: sa_num,
        end_time: end_time
      })
    })
    .then(res => res.json())
    .then(json => {
      alert("✅ CSV 파일 저장 완료!\n경로: " + json.path);
    })
    .catch(err => {
        alert("❌ CSV 파일 저장 중 오류가 발생했습니다.");
        console.error(err);
    });
  });
});

document.getElementById("diagramCanvas").addEventListener("click", function(event) {
  const canvas = event.target;
  const rect = canvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;

  // 가장 가까운 궤적 찾기
  let foundVehicle = null;
  let minDist = 10; // px 이내만 허용 (더 늘릴 수 있음)
  Object.entries(trajectoryPaths).forEach(([vid, path]) => {
    for (let i = 0; i < path.length; i++) {
      const pt = path[i];
      const dx = pt.x - clickX;
      const dy = pt.y - clickY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        foundVehicle = vid;
        minDist = dist;
      }
    }
  });
  if (foundVehicle) {
    // 선택 로직: 이미 있으면 해제, 아니면 2개까지만 선택
    const idx = selectedTrajectories.indexOf(foundVehicle);
    if (idx >= 0) {
      selectedTrajectories.splice(idx, 1);
    } else if (selectedTrajectories.length < 2) {
      selectedTrajectories.push(foundVehicle);
    } else {
      // 이미 2개 선택 중이면 첫 번째 해제, 새로 추가
      selectedTrajectories.shift();
      selectedTrajectories.push(foundVehicle);
    }
    // 선택 즉시 다시 그리기!
    if (lastTrajectoryData && lastGreenWindowData && lastEndTime) {
      drawOnCanvas(lastTrajectoryData, lastGreenWindowData, lastEndTime);
    }
  }
});


// ✅ Canvas 시공도 그리기
async function drawTimeSpaceDiagram() {
  const direction = document.getElementById("direction").value.trim();
  const sa_num = document.getElementById("sa_num").value.trim();
  const end_time = document.getElementById("end_time").value.trim(); // ❗ end_time을 가져옵니다.

  if (!direction) {
    alert("⚠️ 방향을 입력하세요.");
    return;
  }

  const data = hot.getData();

  const payload = {
    data: data,
    direction: direction,
    sa_num: sa_num,
    end_time: end_time
  };

  const response = await fetch("/generate_json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (result.error) {
    alert("❌ 시공도 생성 오류: " + result.error);
    return;
  }
  // 👇 이 한 줄만 추가 (자동 canvas 호출)
  drawCanvasFromCsv(result.file_prefix, end_time, direction, sa_num);

}

async function drawCanvasFromCsv(filePrefix, end_time, direction, sa_num) {
  if (!filePrefix) {
    alert("파일명이 지정되지 않았습니다!");
    return;
  }

  if (direction && typeof direction !== "string") direction = direction.value || "";
  if (sa_num && typeof sa_num !== "string") sa_num = sa_num.value || "";

  const trajUrl = `/static/output/${filePrefix}_trajectories.csv`;
  const greenUrl = `/static/output/${filePrefix}_green_windows.csv`;

  const trajData = await loadCSV(trajUrl);
  const greenData = await loadCSV(greenUrl);
  drawOnCanvas(trajData, greenData, parseFloat(end_time), direction, sa_num);
}

async function loadCSV(url) {
  const res = await fetch(url);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true });
  return parsed.data;
}

let trajectoryPaths = {};         // 궤적별 [캔버스좌표] 배열
let selectedTrajectories = [];    // 선택된 vehicle_id(문자열!) 최대 2개 저장

// 캔버스, 데이터 최신값을 기억하기 위한 변수
let lastTrajectoryData = null;
let lastGreenWindowData = null;
let lastEndTime = null;

// 캔버스에 그리기
// trajectory: 궤적 데이터, green_windows: 신호등 데이터, end_time: 종료 시간
function drawOnCanvas(trajectory, green_windows, end_time, direction = '', sa_num = '') {
  lastTrajectoryData = trajectory;
  lastGreenWindowData = green_windows;
  lastEndTime = end_time;
  const canvas = document.getElementById("diagramCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // === [1] margin, plot 영역 선언 ===
  const leftMargin = 80, rightMargin = 30, topMargin = 60, bottomMargin = 70;
  const plotLeft = leftMargin, plotRight = canvas.width - rightMargin;
  const plotTop = topMargin, plotBottom = canvas.height - bottomMargin;
  const plotWidth = plotRight - plotLeft, plotHeight = plotBottom - plotTop;
  const x_axis = plotLeft + 0.5;

  // *** 이 부분에 로그 추가 ***
  console.log("plotLeft:", plotLeft, "convertX(0):", convertX(0), "plotRight:", plotRight);

  // (1) Y축: 전체 위치 데이터에서 min/max 찾기
  let minPos = Infinity, maxPos = -Infinity;
  trajectory.forEach(row => {
    const pos = parseFloat(row.position);
    if (!isNaN(pos)) {
      minPos = Math.min(minPos, pos);
      maxPos = Math.max(maxPos, pos);
    }
  });
  green_windows.forEach(row => {
    const pos = parseFloat(row.cumulative_distance ?? row.position ?? 0);
    if (!isNaN(pos)) {
      minPos = Math.min(minPos, pos);
      maxPos = Math.max(maxPos, pos);
    }

  });
  console.log("[Canvas] 불러온 green_windows 샘플:", green_windows.slice(0, 5));
  console.log("[Canvas] 불러온 trajectory 샘플:", trajectory.slice(0, 5));
    // (궤적 컬러 팔레트)
  const COLORS = [
    "#1f77b4","#ff7f0e","#2ca02c","#d62728",
    "#9467bd","#8c564b","#e377c2","#7f7f7f",
    "#bcbd22","#17becf"
  ];

  // 서버에서와 동일하게 Y축 마진을 적용
  const yMargin = 20;
  minPos -= yMargin;
  maxPos += yMargin;

  // (2) scaleY, scaleX 계산 (서버와 동일하게)
  const diagramHeight = canvas.height; // (캔버스 전체 사용)
  const posRange = maxPos - minPos || 1;

  function convertX(t) {
    return plotLeft + (t / end_time) * plotWidth;
  }
  function convertY(pos) {
    return plotBottom - ((pos - minPos) / posRange) * plotHeight;
  }

  // (3) 신호등 선
  green_windows.forEach(row => {
    const y = convertY(parseFloat(row.cumulative_distance ?? row.position ?? 0));
    let greenStart = parseFloat(row.green_start_time);
    let greenEnd = parseFloat(row.green_end_time);
    if (greenStart < 0) greenStart = 0;  // x=0 이하 막대 시작점 보정
    let x1 = convertX(greenStart);
    if (greenStart === 0) x1 = x_axis; // 강제로 x_axis로 붙임!
    let x2 = convertX(greenEnd);
    x1 = Math.max(x_axis, x1);
    x2 = Math.min(plotRight, x2);

    ctx.strokeStyle = "green";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();

  });

  // (4) 궤적 선
  trajectoryPaths = {};  // 매번 새로 만듭니다
  const grouped = groupBy(trajectory, "vehicle_id");
  Object.entries(grouped).forEach(([vid, traj], idx) => {
    traj.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
    let pathPoints = [];
    ctx.beginPath();

    // 궤적 하이라이트 색상/굵기 처리
    let color = COLORS[idx % COLORS.length];
    if (selectedTrajectories.includes(vid)) {
      color = (selectedTrajectories[0] === vid) ? "#e53935" : "#1976d2"; // 빨강/파랑
      ctx.lineWidth = 3;
      ctx.globalAlpha = 1.0;
    } else {
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
    }
    ctx.strokeStyle = color;

    traj.forEach((row, i) => {
      const x = convertX(parseFloat(row.time));
      const y = convertY(parseFloat(row.position));
      pathPoints.push({ x, y, t: row.time, pos: row.position });
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // 저장!
    trajectoryPaths[vid] = pathPoints;
  });

  // === [4] 축선 그리기 ===
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1.5;
  // y축선
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotTop);
  ctx.lineTo(plotLeft, plotBottom);
  ctx.stroke();
  // x축선
  ctx.beginPath();
  ctx.moveTo(x_axis, plotBottom);
  ctx.lineTo(plotRight, plotBottom);
  ctx.stroke();

  // === [Y축: 교차로명 및 중간 거리(↕)] ===
  const intersections = [];
  const seen = new Set();
  green_windows.forEach(row => {
    const y = parseFloat(row.cumulative_distance);
    const key = row.intersection_name + '_' + y;
    if (row.intersection_name && !isNaN(y) && !seen.has(key)) {
      intersections.push({ name: row.intersection_name, y: y });
      seen.add(key);
    }
  });
  intersections.sort((a, b) => a.y - b.y);

  // yTick(교차로), yLabels(이름/↕거리) 생성
  let yTicks = [], yLabels = [];
  for (let i = 0; i < intersections.length; i++) {
    const curr = intersections[i];
    yTicks.push(curr.y);
    yLabels.push(curr.name);

    // 중간 ↕거리 라벨
    if (i < intersections.length - 1) {
      const next = intersections[i+1];
      const dist = Math.round(next.y - curr.y);
      if (dist > 0) {
        const midY = (curr.y + next.y) / 2;
        yTicks.push(midY);
        yLabels.push(`↕ ${dist}m`);
      }
    }
  }

  // Y축 이름
  ctx.save();
  ctx.font = "14px 'Malgun Gothic'";
  ctx.fillStyle = "#222";
  ctx.translate(leftMargin - 65, (plotTop + plotBottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("거리 기준 교차로 위치 (m)", 0, 0);
  ctx.restore();

  // X축 이름
  ctx.font = "14px 'Malgun Gothic'";
  ctx.fillStyle = "#222";
  ctx.textAlign = "center";
  ctx.fillText("시간 (초)", (plotLeft + plotRight) / 2, canvas.height - 25);

  // 타이틀
  ctx.font = "18px 'Malgun Gothic'";
  ctx.textAlign = "center";
  let title = `시공도 + 궤적 (방향: ${direction}`;
  if (sa_num) title += `, SA_num=${sa_num}`;
  title += `, 0~${end_time}초)`;
  ctx.fillText(title, (plotLeft + plotRight) / 2, 32);
  // ctx.fillText("시공도 + 궤적 (방향: 동서, SA_num=13, 0~" + end_time + "초)", (plotLeft + plotRight) / 2, 32);

  // y축 눈금/라벨(플롯 왼쪽)
  ctx.font = "12px 'Malgun Gothic'";
  ctx.fillStyle = "#222";
  ctx.textAlign = "right";
  let prevY = -1000;
  for (let i = 0; i < yTicks.length; i++) {
    const pos = yTicks[i];
    const label = yLabels[i];
    const y = convertY(pos);
    if (Math.abs(y - prevY) < 18) continue; // 18px 간격 미만이면 스킵
    ctx.fillText(label, plotLeft - 10, y + 4);
    prevY = y;
  }

  // X축 눈금/라벨(플롯 아래)
  ctx.textAlign = "center";
  ctx.font = "14px 'Malgun Gothic'";
  for (let t = 0; t <= end_time; t += 100) {
    const x = convertX(t);
    ctx.fillText(`${t}`, x, plotBottom + 28); // plotBottom + 28 (네모 아래쪽 바깥에)
  }
}

function groupBy(array, key) {
  return array.reduce((result, item) => {
    const groupKey = item[key];
    if (!result[groupKey]) result[groupKey] = [];
    result[groupKey].push(item);
    return result;
  }, {});
}

function interpolateTimeForPosition(traj, pos) {
  // traj: [{time, position}, ...] (time과 position 모두 parseFloat 필요)
  for (let i = 1; i < traj.length; i++) {
    const prev = traj[i - 1];
    const curr = traj[i];
    if ((prev.position <= pos && curr.position >= pos) ||
        (prev.position >= pos && curr.position <= pos)) {
      const ratio = (pos - prev.position) / (curr.position - prev.position);
      return parseFloat(prev.time) + ratio * (parseFloat(curr.time) - parseFloat(prev.time));
    }
  }
  return null;
}

function calcTimeDiffByPosition(traj1, traj2) {
  // position 오름차순 정렬
  traj1 = traj1.slice().sort((a, b) => parseFloat(a.position) - parseFloat(b.position));
  traj2 = traj2.slice().sort((a, b) => parseFloat(a.position) - parseFloat(b.position));

  // 공통 위치 구간 추출
  const minPos = Math.max(parseFloat(traj1[0].position), parseFloat(traj2[0].position));
  const maxPos = Math.min(parseFloat(traj1[traj1.length - 1].position), parseFloat(traj2[traj2.length - 1].position));

  const step = 1; // 1m 간격
  const diffs = [];
  for (let pos = minPos; pos <= maxPos; pos += step) {
    const t1 = interpolateTimeForPosition(traj1, pos);
    const t2 = interpolateTimeForPosition(traj2, pos);
    if (t1 !== null && t2 !== null) {
      diffs.push(Math.abs(t1 - t2));
    }
  }
  if (diffs.length === 0) return null;
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const min = Math.min(...diffs);
  const max = Math.max(...diffs);
  return { avg, min, max };
}

// === 거리 계산 버튼 클릭 이벤트 ===
document.getElementById("distanceBtn").addEventListener("click", function() {
  if (selectedTrajectories.length !== 2) {
    document.getElementById("distanceResult").textContent = "궤적을 2개 선택하세요!";
    return;
  }
  // 궤적 데이터 가져오기
  const traj1 = lastTrajectoryData.filter(row => row.vehicle_id === selectedTrajectories[0]);
  const traj2 = lastTrajectoryData.filter(row => row.vehicle_id === selectedTrajectories[1]);
  if (traj1.length === 0 || traj2.length === 0) {
    document.getElementById("distanceResult").textContent = "선택된 궤적 데이터가 없습니다!";
    return;
  }

  // === "가장 가까운 시점" 거리 차이를 예시로 계산 ===
  // 1. 모든 시간(초)에 대해, 같은 시간대의 위치(거리)를 찾아서 차이
  // 2. 둘 중 공통되는 시간만 비교(즉, time이 일치하는 구간만)

  const posMap1 = {};  // time: position
  traj1.forEach(row => { posMap1[row.time] = parseFloat(row.position); });
  const posMap2 = {};
  traj2.forEach(row => { posMap2[row.time] = parseFloat(row.position); });

  // 공통 time만 추출
  const commonTimes = Object.keys(posMap1).filter(t => t in posMap2);
  if (commonTimes.length === 0) {
    document.getElementById("distanceResult").textContent = "두 궤적의 공통 시간이 없습니다!";
    return;
  }

  // 각 시간별 거리 차이 절댓값 구해서 평균/최소/최대 등 구하기, 두 궤적 간 시간 차이
  const diffs = commonTimes.map(t => Math.abs(posMap1[t] - posMap2[t]));
  const minDiff = Math.min(...diffs);
  const maxDiff = Math.max(...diffs);
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const timeDiffStats = calcTimeDiffByPosition(traj1, traj2);

  let html = 
  `<div> 거리 차이 (공통 시간대 기준): 평균 ${avgDiff.toFixed(2)} m, 최소 ${minDiff.toFixed(2)} m, 최대 ${maxDiff.toFixed(2)} m</div>`;
  
  if (timeDiffStats) {
    html += `<div>시간 차이 (공통 위치 기준): 평균 ${timeDiffStats.avg.toFixed(2)}초, 최소 ${timeDiffStats.min.toFixed(2)}초, 최대 ${timeDiffStats.max.toFixed(2)}초</div>`;
  }
  // 결과 출력
  document.getElementById("distanceResult").innerHTML = html;
});
