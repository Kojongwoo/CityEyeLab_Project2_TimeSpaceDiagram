from flask import Flask, request, render_template, send_from_directory, jsonify, send_file
import pandas as pd
import os, io
from time_space_diagram_trajectory import draw_time_space_diagram
import datetime

# 경로 -> CityeyeLab_Intern/time_space_diagram/Web/app.py 로 실행할것 cd time_space_diagram/web
# 프론트: 수정 후 npx webpack --mode=development
# 코드 수정할 경우, Dockerbuild를 통해 컨테이너를 재빌드해야 합니다. docker build -t timespace-diag-app .
# docker 빌드 후 실행 : docker run -p 8000:8000 timespace-diag-app

# 현재 파일(app.py)의 위치를 기준으로 절대 경로 설정
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
OUTPUT_DIR = os.path.join(STATIC_DIR, 'output')

# Webpack 빌드 결과물(bundle.js)을 Flask가 서빙할 수 있도록 설정
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='/static') 

# 번들 JS는 따로 dist 폴더에서 서빙
@app.route('/dist/<path:filename>')
def serve_dist(filename):
    # ▼▼▼ 수정: dist 폴더의 경로를 app.py와 같은 위치로 수정합니다.
    dist_dir = os.path.join(BASE_DIR, 'dist')
    return send_from_directory(dist_dir, filename)

def preprocess_df(data):
    columns = [
        "street_name", "order_num", "SA_num", "intersection_id", "intersection_name", "direction",
        "distance_from_prev_meter", "time_plan", "cycle_length_sec", "green_start_sec",
        "green_duration_sec", "offset_sec", "speed_limit_kph"
    ]

    df = pd.DataFrame(data, columns=columns)
    df = df.dropna(how='all')

    num_cols = ["order_num", "SA_num", "distance_from_prev_meter", "cycle_length_sec",
                "green_start_sec", "green_duration_sec", "offset_sec", "speed_limit_kph"]
    for col in num_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    integer_cols = ["order_num", "SA_num", "cycle_length_sec", "green_start_sec",
                    "green_duration_sec", "offset_sec"]
    for col in integer_cols:
        if col in df.columns:
            df[col] = df[col].astype('Int64')

    return df


@app.route('/', methods=['GET'])
def index():
    return render_template('index.html')

@app.route('/static/output/<filename>')
def serve_output_file(filename):
    return send_from_directory(OUTPUT_DIR, filename)

@app.route('/generate', methods=['POST'])
def generate():
    try:    
        content = request.get_json()
        data = content['data']
        direction = content['direction']
        
        sa_num_input = content.get('sa_num')
        if sa_num_input:
            try:
                sa_num = int(float(sa_num_input))
            except (ValueError, TypeError):
                sa_num = None
        else:
            sa_num = None

        # ▼▼▼ 1. 이 위치에 코드를 추가합니다 ▼▼▼
        sa_range_input = content.get('sa_range', '2') 
        try:
            sa_range = int(sa_range_input)
        except (ValueError, TypeError):
            sa_range = 2   
            
        end_time_input = content.get('end_time')
        if end_time_input:
            try:
                end_time = int(float(end_time_input))
            except (ValueError, TypeError):
                end_time = 1800
        else:
            end_time = 1800

        import time_space_diagram_trajectory as tsd
        df = preprocess_df(data)
        tsd.df = df

        # ▼▼▼ [추가] 필터링된 데이터에서 실제 사용된 SA 번호 목록을 추출합니다. ▼▼▼
        filtered_all = df[df["direction"] == direction].copy()

        # [2단계] if 블록 내부의 'sa_range = 2'는 삭제하고, else는 그대로 둡니다.
        if sa_num is not None:
            # 위에서 받아온 sa_range 변수를 사용합니다.
            sa_min, sa_max = sa_num - sa_range, sa_num + sa_range
            filtered = filtered_all[(filtered_all["SA_num"] >= sa_min) & (filtered_all["SA_num"] <= sa_max)]
            used_sa_nums = sorted([int(n) for n in filtered["SA_num"].unique()])
        else:
            # 이 else 블록은 수정하지 않습니다.
            used_sa_nums = []    

        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")

        sa_str = f"SA{sa_num}" if sa_num is not None else 'all'

        output_name = f"diagram_{direction}_{sa_str}_{timestamp}.png"
        
        # sa_range 변수를 함수 호출에 추가합니다.
        tsd.draw_time_space_diagram(direction, output_name, sa_num, sa_range, end_time, with_trajectory=True)
        
        image_url = f"/static/output/{output_name}"
        return jsonify({
            "image_url": image_url, 
            "file_prefix": output_name.replace('.png',''), 
            "used_sa_nums": used_sa_nums
        })
    
    except Exception as e:
        print(f"❌ 시공도 생성 중 오류 발생: {e}")
        return jsonify({"error": f"시공도 생성 실패. 오류: {str(e)}"}), 500
        
    
@app.route('/generate_json', methods=['POST'])
def generate_json():
    try:
        content = request.get_json()
        data = content['data']
        direction = content['direction']
        
        sa_num_input = content.get('sa_num')
        if sa_num_input:
            try:
                sa_num = int(float(sa_num_input))
            except (ValueError, TypeError):
                sa_num = None
        else:
            sa_num = None

        end_time_input = content.get('end_time')
        if end_time_input:
            try:
                end_time = int(float(end_time_input))
            except (ValueError, TypeError):
                end_time = 1800
        else:
            end_time = 1800

        df = preprocess_df(data)

        import time_space_diagram_trajectory as tsd
        tsd.df = df

        import datetime
        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        sa_str = f"SA{sa_num}" if sa_num is not None else 'all'
        output_basename = f"diagram_{direction}_{sa_str}_{timestamp}"

        tsd.draw_time_space_diagram(direction, f"{output_basename}.png", sa_num, end_time, with_trajectory=True)

        file_prefix = output_basename.replace('.png', '')
        traj_csv_url = f"/static/output/{output_basename}_trajectories.csv"
        green_csv_url = f"/static/output/{output_basename}_green_windows.csv"

        return jsonify({
            "trajectory_csv": traj_csv_url,
            "green_window_csv": green_csv_url,
            "file_prefix": output_basename
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# @app.route('/save_excel_csv', methods=['POST'])
# def save_excel():
#     content = request.get_json()
#     rows = content["rows"]
#     headers = content.get("headers")
#     direction = content.get("direction", "방향미지정")
#     sa_num = content.get("sa_num", "전체")
#     end_time = content.get("end_time", "시간미지정")

#     df = pd.DataFrame(rows, columns=headers)
#     df = df.fillna("")

#     now = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
#     sa_str = f"SA{sa_num}" if sa_num else "전체"
#     filename = f"{direction}_{sa_str}_{end_time}초_{now}.csv"
    
#     full_path = os.path.join(OUTPUT_DIR, filename)

#     df.to_csv(full_path, index=False, encoding="utf-8-sig")

#     return jsonify({"path": full_path})

@app.route('/save_excel_csv', methods=['POST'])
def save_excel_csv(): # 함수 이름을 좀 더 명확하게 변경
    try:
        content = request.get_json()
        rows = content["rows"]
        headers = content.get("headers")
        direction = content.get("direction", "방향미지정")
        sa_num = content.get("sa_num", "전체")
        end_time = content.get("end_time", "시간미지정")

        df = pd.DataFrame(rows, columns=headers)
        df = df.fillna("")

        now = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        sa_str = f"SA{sa_num}" if sa_num else "전체"
        filename = f"수정_{direction}_{sa_str}_{end_time}초_{now}.csv"
        
        # --- ▼▼▼ 핵심 수정 부분 ▼▼▼ ---
        
        # 1. 데이터를 파일이 아닌 메모리 내의 텍스트 버퍼에 저장
        buffer = io.StringIO()
        df.to_csv(buffer, index=False, encoding="utf-8-sig")
        
        # 2. 버퍼의 내용을 BytesIO로 감싸서 send_file로 전달 준비
        mem = io.BytesIO()
        mem.write(buffer.getvalue().encode('utf-8-sig'))
        mem.seek(0) # 버퍼의 커서를 맨 앞으로 이동
        
        # 3. send_file을 사용해 브라우저에 파일 다운로드 응답을 보냄
        return send_file(
            mem,
            as_attachment=True,      # 첨부 파일로 처리하도록 설정
            download_name=filename,  # 다운로드될 파일의 이름 지정
            mimetype='text/csv'      # 파일 형식을 CSV로 지정
        )

    except Exception as e:
        print(f"❌ CSV 생성/전송 중 오류 발생: {e}")
        return jsonify({"error": f"CSV 생성 실패. 오류: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)