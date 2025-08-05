from flask import Flask, request, render_template, send_from_directory, jsonify, send_file
import pandas as pd
import os, io
from time_space_diagram_trajectory import draw_time_space_diagram
import datetime # datetime 모듈 추가

app = Flask(__name__)
UPLOAD_FOLDER = 'static/input'
OUTPUT_FOLDER = 'static/output'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

@app.route('/', methods=['GET'])
def index():
    return render_template('index.html')

# ✅ 이 부분을 추가해야 합니다.
@app.route('/static/output/<filename>')
def serve_output_file(filename):
    return send_from_directory(OUTPUT_FOLDER, filename) #

@app.route('/generate', methods=['POST'])
def generate():
    try:    
        content = request.get_json()
        data = content['data']

        # 수정 코드 ✅
        direction = content['direction']
        sa_num = content.get('sa_num', None)
        end_time = int(content.get('end_time', 1800))

        columns = [
            "street_name", "order_num", "SA_num", "intersection_id", "intersection_name", "direction", "distance_from_prev_meter",
            "time_plan", "cycle_length_sec", "green_start_sec","green_duration_sec", "offset_sec", "speed_limit_kph"
        ]
        df = pd.DataFrame(data, columns=columns)
        df = df.dropna(how='all')  # ✅ 모든 값이 비어있는 행 제거

        # 숫자형 변환
        num_cols = ["order_num", "SA_num", "distance_from_prev_meter", "cycle_length_sec",
                    "green_start_sec", "green_duration_sec", "offset_sec", "speed_limit_kph"]
        for col in num_cols:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        # 📌 핵심: 사용자 입력 파일을 사용하는 draw 함수 실행
        # time_space_diagram_trajectory의 df에 할당
        import time_space_diagram_trajectory as tsd
        tsd.df = df

        if sa_num == "" or sa_num is None:
            sa_num = None
        else:
            sa_num = int(sa_num)

        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        output_name = f"diagram_{direction}_sa{sa_num if sa_num else 'all'}_{timestamp}.png"
        output_path = os.path.join(OUTPUT_FOLDER, output_name)
        # image_url = '/' + output_path.replace('\\', '/')
        image_url = f"/static/output/{output_name}"
        tsd.draw_time_space_diagram(direction, output_name, sa_num, end_time, with_trajectory=True)
        return jsonify({"image_url": image_url})
    except Exception as e:
        print(f"❌ 시공도 생성 중 오류 발생: {e}")
        return jsonify({"error": "시공도 생성 실패. 입력값을 확인해주세요."}), 500
    
@app.route('/save_excel_csv', methods=['POST'])
def save_excel():
    content = request.get_json()
    rows = content["rows"]
    headers = content.get("headers")  # ✅ 새로 추가
    direction = content.get("direction", "방향미지정")
    sa_num = content.get("sa_num", "전체")
    end_time = content.get("end_time", "시간미지정")

    df = pd.DataFrame(rows, columns=headers)
    df = df.fillna("")

    # 임시 메모리 버퍼에 저장
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name="교차로정보")

    output.seek(0)

    # 현재 시간
    now = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    sa_str = f"SA{sa_num}" if sa_num else "전체"
    # filename = f"{direction}_{sa_str}_{end_time}초_{today}.xlsx"
    filename = f"{direction}_{sa_str}_{end_time}초_{now}.csv"
    full_path = os.path.join("static", "output", filename)

    # return send_file(output,
    #                  as_attachment=True,
    #                  download_name=filename,
    #                  mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    df.to_csv(full_path, index=False, encoding="utf-8-sig")

    return jsonify({"path": full_path})

if __name__ == '__main__':
    app.run(debug=True)
