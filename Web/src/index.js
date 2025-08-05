// import { Handsontable } from 'handsontable';
import Handsontable from 'handsontable';
import * as XLSX from 'xlsx';
import 'handsontable/dist/handsontable.min.css';

let hot;

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
    const end_time = document.getElementById("end_time").value.trim();

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
            <h2>결과 시공도</h2>
            <img src="${json.image_url}" width="800">
          `;
          document.getElementById("image-result").innerHTML = imgTag;
      } else {
          alert("❌ 시공도 이미지 URL을 가져오지 못했습니다.");
      }
    })
    .catch(err => {
      document.getElementById("loading").style.display = "none";
      alert("❌ 시공도 생성 중 오류가 발생했습니다: " + err.message);
      console.error(err);
    });
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