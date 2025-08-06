// import { Handsontable } from 'handsontable';
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
    // let title = `시공도 + 궤적 (방향: ${direction}`;
    // if (sa_num) title += `, SA_num=${sa_num}`;
    // title += `, 0~${end_time}초)`;
    // ctx.fillText(title, canvas.width / 2, 30);
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
        const imgTag = `
          <h2>Matplotlib 시공도 -> 궤적 이미지를 띄움.</h2>
          <img src="${json.image_url}" width="800">
        `;
        document.getElementById("image-result").innerHTML = imgTag;
        // (추가) canvas 자동 호출
        if(json.file_prefix) {
          drawCanvasFromCsv(json.file_prefix, payload.end_time);
        }
      } 
      else {
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
  drawCanvasFromCsv(result.file_prefix, end_time);

}
async function drawCanvasFromCsv(filePrefix, end_time) {
  if (!filePrefix) {
    alert("파일명이 지정되지 않았습니다!");
    return;
  }
  const trajUrl = `/static/output/${filePrefix}_trajectories.csv`;
  const greenUrl = `/static/output/${filePrefix}_green_windows.csv`;

  const trajData = await loadCSV(trajUrl);
  const greenData = await loadCSV(greenUrl);
  drawOnCanvas(trajData, greenData, parseFloat(end_time));
}

async function loadCSV(url) {
  const res = await fetch(url);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true });
  return parsed.data;
}

function drawOnCanvas(trajectory, green_windows, end_time) {
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
  const grouped = groupBy(trajectory, "vehicle_id");
  Object.entries(grouped).forEach(([vid, traj], idx) => {
    traj.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
    ctx.beginPath();
    ctx.strokeStyle = COLORS[idx % COLORS.length];
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    traj.forEach((row, i) => {
      const x = convertX(parseFloat(row.time));
      const y = convertY(parseFloat(row.position));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1.0;
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
  ctx.fillText("시공도 + 궤적 (방향: 동서, SA_num=13, 0~" + end_time + "초)", (plotLeft + plotRight) / 2, 32);

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