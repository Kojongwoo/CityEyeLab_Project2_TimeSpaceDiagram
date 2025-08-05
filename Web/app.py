from flask import Flask, request, render_template, send_from_directory, jsonify, send_file
import pandas as pd
import os, io
from time_space_diagram_trajectory import draw_time_space_diagram
import datetime

# 경로 -> CityeyeLab_Intern/time_space_diagram/Web/app.py 로 실행할것 cd time_space_diagram/web

# Webpack 빌드 결과물(bundle.js)을 Flask가 서빙할 수 있도록 설정
app = Flask(__name__, static_folder='dist', static_url_path='/dist')

UPLOAD_FOLDER = 'Web/static/input'
OUTPUT_FOLDER = 'Web/static/output'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

@app.route('/', methods=['GET'])
def index():
    return render_template('index.html')

# 기존 정적 파일 서빙은 그대로 유지
@app.route('/static/output/<filename>')
def serve_output_file(filename):
    return send_from_directory(OUTPUT_FOLDER, filename)

@app.route('/generate', methods=['POST'])
def generate():
    try:    
        content = request.get_json()
        data = content['data']

        direction = content['direction']

        # sa_num과 end_time 값의 유효성 검사 및 기본값 설정
        sa_num_input = content.get('sa_num')
        if sa_num_input: # 빈 문자열이 아닌 경우에만 변환 시도
            try:
                sa_num = int(float(sa_num_input))
            except ValueError:
                sa_num = None
        else:
            sa_num = None

        end_time_input = content.get('end_time')
        if end_time_input: # 빈 문자열이 아닌 경우에만 변환 시도
            try:
                end_time = int(float(end_time_input))
            except ValueError:
                end_time = 1800 # 변환 실패 시 기본값
        else:
            end_time = 1800 # 입력값이 없으면 기본값

        columns = [
            "street_name", "order_num", "SA_num", "intersection_id", "intersection_name", "direction", "distance_from_prev_meter",
            "time_plan", "cycle_length_sec", "green_start_sec","green_duration_sec", "offset_sec", "speed_limit_kph"
        ]
        df = pd.DataFrame(data, columns=columns)
        df = df.dropna(how='all')

        # 숫자형 변환
        num_cols = ["order_num", "SA_num", "distance_from_prev_meter", "cycle_length_sec",
                    "green_start_sec", "green_duration_sec", "offset_sec", "speed_limit_kph"]
        for col in num_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        integer_cols_to_convert_nullable = [
            "order_num", "SA_num", "cycle_length_sec", "green_start_sec",
            "green_duration_sec", "offset_sec",
        ]
        for col in integer_cols_to_convert_nullable:
            if col in df.columns:
                df[col] = df[col].astype('Int64')

        # 📌 핵심: 사용자 입력 파일을 사용하는 draw 함수 실행
        import time_space_diagram_trajectory as tsd
        tsd.df = df

        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        sa_str = f"SA{sa_num}" if sa_num is not None else 'all'
        output_name = f"diagram_{direction}_{sa_str}_{timestamp}.png"
        output_path = os.path.join(OUTPUT_FOLDER, output_name)
        image_url = f"/static/output/{output_name}"

        # draw_time_space_diagram 함수 호출 전에 인자가 올바른지 다시 확인
        tsd.draw_time_space_diagram(direction, output_name, sa_num, end_time, with_trajectory=True)
        
        return jsonify({"image_url": image_url})
    except Exception as e:
        print(f"❌ 시공도 생성 중 오류 발생: {e}")
        # 오류 발생 시 클라이언트에 명확한 메시지를 전달
        return jsonify({"error": f"시공도 생성 실패. 오류: {str(e)}"}), 500
    
@app.route('/save_excel_csv', methods=['POST'])
def save_excel():
    content = request.get_json()
    rows = content["rows"]
    headers = content.get("headers")
    direction = content.get("direction", "방향미지정")
    sa_num = content.get("sa_num", "전체")
    end_time = content.get("end_time", "시간미지정")

    df = pd.DataFrame(rows, columns=headers)
    df = df.fillna("")

    # 현재 시간
    now = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    sa_str = f"SA{sa_num}" if sa_num else "전체"
    filename = f"{direction}_{sa_str}_{end_time}초_{now}.csv"
    full_path = os.path.join("Web", "static", "output", filename) # 'static' 폴더 경로 수정

    df.to_csv(full_path, index=False, encoding="utf-8-sig")

    return jsonify({"path": full_path})

if __name__ == '__main__':
    app.run(debug=True)