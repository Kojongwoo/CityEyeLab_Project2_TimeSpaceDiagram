import pandas as pd
import numpy as np
import os

# Matplotlib 및 한글 폰트 설정은 웹 백엔드에서 직접 사용하지 않으므로 주석 처리합니다.
# import matplotlib.pyplot as plt
# plt.rcParams["font.family"] = "Malgun Gothic"

# 전역 DataFrame 변수
df = None
order_col = "order_num"

# 파일 경로 설정
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
output_folder = os.path.join(SCRIPT_DIR, "static", "output")
# 웹 서버 시작 시 폴더가 생성되도록 app.py에서 관리하는 것이 더 안정적입니다.
# os.makedirs(output_folder, exist_ok=True)


def recalculate_trajectory(start_time, start_pos, intersections_df, green_windows_df):
    """
    JavaScript의 recalculateTrajectory 로직을 Python으로 구현한 함수.
    특정 시작 시간과 위치에서부터의 차량 궤적을 계산합니다.
    """
    path = []
    current_time = float(start_time)
    current_pos = float(start_pos)
    path.append({'time': current_time, 'position': current_pos})

    # 시작 위치가 교차로인지 확인 (부동소수점 오차 감안)
    starting_intersection_df = intersections_df[abs(intersections_df['cumulative_distance'] - current_pos) < 1e-6]
    if not starting_intersection_df.empty:
        intersection_name = starting_intersection_df.iloc[0]['intersection_name']
        green_windows = green_windows_df[green_windows_df['intersection_name'] == intersection_name]

        can_start = any(
            (current_time >= row['green_start_time'] - 1e-6) and (current_time <= row['green_end_time'] + 1e-6)
            for _, row in green_windows.iterrows()
        )

        if not can_start:
            # 출발할 수 없다면, 가장 가까운 미래의 녹색 신호까지 대기
            future_greens = green_windows[green_windows['green_start_time'] >= current_time].sort_values('green_start_time')
            if not future_greens.empty:
                next_green_start = future_greens.iloc[0]['green_start_time']

                wait_points = np.linspace(current_time, next_green_start, num=int(next_green_start - current_time) + 2)
                for t in wait_points:
                    path.append({'time': t, 'position': current_pos})

                current_time = next_green_start # 대기 후 현재 시간 업데이트
    
    # DataFrame을 순회를 위해 dictionary 리스트로 변환
    intersections = intersections_df.to_dict('records')
    
    # 현재 위치보다 앞서거나 같은 첫 번째 교차로 인덱스를 찾습니다.
    try:
        start_idx = next(i for i, inter in enumerate(intersections) if inter['cumulative_distance'] >= current_pos)
    except StopIteration:
        return [] # 경로 상에 더 이상 교차로가 없으면 빈 리스트 반환
        
    # JS 로직과 동일하게, 시작 위치를 이전 교차로에 맞춥니다.
    # 이렇게 하면 루프가 항상 교차로 '간' 이동을 계산하게 됩니다.
    if start_idx > 0:
        current_pos = intersections[start_idx - 1]['cumulative_distance']

    # 찾은 시작 인덱스부터 모든 교차로를 순회합니다.
    for i in range(start_idx, len(intersections)):
        intersection = intersections[i]
        
        dist = intersection['cumulative_distance'] - current_pos
        if dist <= 0:
            continue

        speed_mps = intersection['speed_mps']
        if speed_mps <= 0:
            continue
            
        # 1. 이동 구간 계산 및 보간
        travel_time = dist / speed_mps
        arrival_time = current_time + travel_time
        next_pos = intersection['cumulative_distance']
        
        # 1초 단위로 점을 생성 (JS의 Array.from 로직과 동일)
        # np.linspace를 사용해 시작과 끝점 포함, 일정한 간격의 점들을 생성
        time_points = np.linspace(current_time, arrival_time, num=int(travel_time) + 2)
        for t in time_points:
            fraction = (t - current_time) / travel_time
            inter_pos = current_pos + (next_pos - current_pos) * fraction
            path.append({'time': t, 'position': inter_pos})

        current_time = arrival_time
        current_pos = next_pos
        
        # 2. 교차로 도착 후, 신호 대기 여부 판단
        intersection_name = intersection['intersection_name']
        
        # 현재 교차로의 녹색 신호 시간대 필터링
        green_windows = green_windows_df[green_windows_df['intersection_name'] == intersection_name]
        
        # 도착 시간에 통과 가능한지 확인 (오차 감안)
        can_pass = any(
            (arrival_time >= row['green_start_time'] - 1e-6) and (arrival_time <= row['green_end_time'] + 1e-6)
            for _, row in green_windows.iterrows()
        )

        # 3. 신호 대기 시 처리 및 보간
        if not can_pass:
            # 통과할 수 없다면, 가장 가까운 미래의 녹색 신호 시작 시간을 찾음
            future_greens = green_windows[green_windows['green_start_time'] >= arrival_time].sort_values('green_start_time')
            
            if not future_greens.empty:
                next_green_start = future_greens.iloc[0]['green_start_time']
                
                # 대기 시간 동안 1초 단위로 점을 생성
                wait_points = np.linspace(arrival_time, next_green_start, num=int(next_green_start - arrival_time) + 2)
                for t in wait_points:
                    path.append({'time': t, 'position': current_pos})
                
                current_time = next_green_start # 대기 후, 현재 시간을 녹색 신호 시작 시간으로 업데이트
            else:
                # 더 이상 통과할 녹색 신호가 없으면 궤적 생성 중단
                break
    
    # JS의 `new Map(path.map(p => [Math.round(p.time), p]))` 와 동일한 로직
    # 시간을 반올림한 값을 키로 사용하여 중복된 시간대의 점들을 제거하고 마지막 값만 남김
    unique_path_dict = {round(p['time']): p for p in path}
    
    # 시간 순으로 정렬하여 최종 경로 반환
    unique_path = sorted(list(unique_path_dict.values()), key=lambda p: p['time'])
    
    return unique_path


def draw_time_space_diagram(direction, filename, sa_num=None, sa_range=2, end_time=1800, with_trajectory=True):
    global df

    # 데이터 전처리 (기존 코드와 동일)
    df["speed_mps"] = df["speed_limit_kph"] / 3.6
    
    filtered_all = df[df["direction"] == direction].copy()
    if filtered_all.empty:
        print(f"❗ [{direction}] 방향에 해당하는 데이터가 없습니다.")
        return
        
    filtered_all = filtered_all.sort_values(order_col)
    filtered_all["cumulative_distance"] = filtered_all["distance_from_prev_meter"].cumsum().fillna(0)

    if sa_num is not None:
        # sa_range = 2
        sa_min, sa_max = sa_num - sa_range, sa_num + sa_range
        filtered = filtered_all[(filtered_all["SA_num"] >= sa_min) & (filtered_all["SA_num"] <= sa_max)].copy()
    else:
        filtered = filtered_all.copy()

    if filtered.empty:
        print(f"❗ [{direction}] 방향, SA_num={sa_num}에 해당하는 교차로가 없습니다.")
        return

    # 녹색 신호 시간 계산 및 CSV 저장 (기존 코드와 동일)
    green_windows_data = []
    for _, row in filtered.iterrows():
        cycle = row["cycle_length_sec"]
        offset = row["offset_sec"]
        green_start = row["green_start_sec"]
        green_dur = row["green_duration_sec"]
        
        for t in range(-2 * cycle, end_time + 2 * cycle, cycle):
            start = t + offset + green_start
            end = start + green_dur
            if end <= 0 or start >= end_time: continue
            green_windows_data.append({
                "intersection_name": row["intersection_name"], "direction": row["direction"], "SA_num": row["SA_num"],
                "green_start_time": start, "green_end_time": end, "cycle": cycle,
                "cumulative_distance": row["cumulative_distance"], "distance_from_prev_meter": row["distance_from_prev_meter"],
                "speed_limit_kph": row["speed_limit_kph"], "speed_mps": row["speed_mps"],
                "offset_sec": offset, "green_start_sec": green_start, "green_duration_sec": green_dur
            })

    green_df = pd.DataFrame(green_windows_data)
    csv_name = filename.replace(".png", "_green_windows.csv")
    csv_path = os.path.join(output_folder, csv_name)
    green_df.to_csv(csv_path, index=False)
    print(f"✅ 녹색 시간대 CSV 저장 완료: {csv_path}")

    # 궤적 생성 로직 (JavaScript 로직과 통합)
    if with_trajectory:
        all_trajectories = []

        # 0초에 궤적 하나만 생성
        start_time = 0
        if not filtered.empty:
            # 첫 번째 교차로의 위치를 시작 위치로 설정
            start_pos = filtered.iloc[0]["cumulative_distance"]
            
            # JS 로직을 이식한 함수를 호출하여 궤적 계산
            vehicle_path = recalculate_trajectory(start_time, start_pos, filtered, green_df)
            
            for point in vehicle_path:
                all_trajectories.append({
                    "vehicle_id": f"manual_{start_time}", # ID를 수동 생성과 유사하게 변경
                    "time": round(point['time'], 2),
                    "position": round(point['position'], 2)
                })
        
        # # 100초 간격으로 차량 생성 (기존 로직 유지)
        # for start_time in range(1, end_time + 1, 100):
        #     if filtered.empty: continue
            
        #     # 첫 번째 교차로의 위치를 시작 위치로 설정
        #     start_pos = filtered.iloc[0]["cumulative_distance"]
            
        #     # JS 로직을 이식한 함수를 호출하여 궤적 계산
        #     vehicle_path = recalculate_trajectory(start_time, start_pos, filtered, green_df)
            
        #     for point in vehicle_path:
        #         all_trajectories.append({
        #             "vehicle_id": start_time,
        #             "time": round(point['time'], 2),
        #             "position": round(point['position'], 2)
        #         })

        if all_trajectories:
            traj_df = pd.DataFrame(all_trajectories)
            # 최종적으로 한 번 더 중복 제거 및 정렬
            traj_df = traj_df.drop_duplicates().sort_values(["vehicle_id", "time"])
            
            traj_csv = filename.replace(".png", "_trajectories.csv")
            traj_path = os.path.join(output_folder, traj_csv)
            traj_df.to_csv(traj_path, index=False)
            print(f"✅ 차량 궤적 CSV 저장 완료: {traj_path}")