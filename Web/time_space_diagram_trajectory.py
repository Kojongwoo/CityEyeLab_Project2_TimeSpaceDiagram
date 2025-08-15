import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import os

# plt.rcParams["font.family"] = "Malgun Gothic"

df = None
order_col = "order_num"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
output_folder = os.path.join(SCRIPT_DIR, "static", "output")
# os.makedirs(output_folder, exist_ok=True)


def draw_time_space_diagram(direction, filename, sa_num=None, end_time=1800, with_trajectory=True):
    global df

    df["speed_mps"] = df["speed_limit_kph"] / 3.6
    df["green_start_time"] = df["offset_sec"] + df["green_start_sec"]
    df["green_end_time"] = df["green_start_time"] + df["green_duration_sec"]
    
    filtered_all = df[df["direction"] == direction].copy()
    filtered_all = filtered_all.sort_values(order_col)
    filtered_all["cumulative_distance"] = filtered_all["distance_from_prev_meter"].cumsum().fillna(0)

    if sa_num is not None:
        sa_range = 2
        sa_min, sa_max = sa_num - sa_range, sa_num + sa_range
        filtered = filtered_all[(filtered_all["SA_num"] >= sa_min) & (filtered_all["SA_num"] <= sa_max)].copy()
    else:
        filtered = filtered_all.copy()

    if filtered.empty:
        print(f"❗ [{direction}] 방향, SA_num={sa_num} 교차로 없음")
        return

    # filtered["cumulative_distance"] = filtered["distance_from_prev_meter"].cumsum().fillna(0)

    green_windows_data = []
    for _, row in filtered.iterrows():
        cycle = row["cycle_length_sec"]
        offset = row["offset_sec"]
        green_start = row["green_start_sec"]
        green_dur = row["green_duration_sec"]
        y = row["cumulative_distance"]
        intersec = row["intersection_name"]
        sa = row["SA_num"]
        dirc = row["direction"]
        dist_prev = row["distance_from_prev_meter"]
        speed_kph = row["speed_limit_kph"]
        
        for t in range(-2 * cycle, end_time + 2 * cycle, cycle):
            start = t + offset + green_start
            end = start + green_dur
            if end <= 0 or start >= end_time:
                continue

            green_windows_data.append(
                {
                    "intersection_name": intersec, "direction": dirc, "SA_num": sa,
                    "green_start_time": start, "green_end_time": end, "cycle": cycle,
                    "cumulative_distance": y, "distance_from_prev_meter": dist_prev,
                    "speed_limit_kph": speed_kph, "offset_sec": offset,
                    "green_start_sec": green_start, "green_duration_sec": green_dur,
                }
            )

    green_df = pd.DataFrame(green_windows_data)
    csv_name = filename.replace(".png", "_green_windows.csv")
    csv_path = os.path.join(output_folder, csv_name)
    green_df.to_csv(csv_path, index=False)
    print(f"✅ 녹색 시간대 CSV 저장 완료: {csv_path}")

    if with_trajectory:
        trajectories = []
        for veh_id in range(1, end_time + 1, 53):
            # ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
            # 궤적 생성 로직을 JavaScript와 동일하게 전면 수정
            
            current_time = float(veh_id)
            if filtered.empty: continue
            
            # 시작점 설정
            current_pos = filtered.iloc[0]["cumulative_distance"]
            trajectories.append({
                "vehicle_id": veh_id, "time": current_time, "position": round(current_pos, 2),
                "speed": 0, "intersection": filtered.iloc[0]["intersection_name"],
            })

            for _, row in filtered.iterrows():
                dist = row["distance_from_prev_meter"]
                if dist <= 0: continue
                
                speed = row["speed_limit_kph"] / 3.6
                if speed <= 0: continue

                # 이동 구간 처리
                travel_time = dist / speed
                arrival_time = current_time + travel_time
                next_pos = row["cumulative_distance"]
                
                # 이동 구간 보간
                total_time_segment = max(1, arrival_time - current_time)
                for sec in range(int(current_time) + 1, int(arrival_time) + 1):
                    frac = (sec - current_time) / total_time_segment
                    pos = current_pos + (next_pos - current_pos) * frac
                    trajectories.append({
                        "vehicle_id": veh_id, "time": sec, "position": round(pos, 2),
                        "speed": round(speed, 2), "intersection": row["intersection_name"],
                    })

                current_time = arrival_time
                current_pos = next_pos
                
                # 대기 구간 처리
                intersec_name = row["intersection_name"]
                green_ok = green_df[
                    (green_df["intersection_name"] == intersec_name) &
                    (green_df["green_start_time"] <= arrival_time + 1e-3) &
                    (green_df["green_end_time"] >= arrival_time - 1e-3)
                ]

                if green_ok.empty:
                    future_green = green_df[
                        (green_df["intersection_name"] == intersec_name) &
                        (green_df["green_start_time"] >= arrival_time - 5)
                    ].sort_values("green_start_time")

                    if future_green.empty: break

                    wait_end_time = future_green.iloc[0]["green_start_time"]
                    
                    # 대기 구간 보간
                    for sec in range(int(current_time), int(wait_end_time) + 1):
                        trajectories.append({
                            "vehicle_id": veh_id, "time": sec, "position": round(current_pos, 2),
                            "speed": 0, "intersection": intersec_name,
                        })
                    
                    current_time = wait_end_time # 대기 후 시간 갱신
            # ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        if trajectories:
            # 중복 제거 및 정렬
            traj_df = pd.DataFrame(trajectories)
            traj_df = traj_df.drop_duplicates(subset=['vehicle_id', 'time']).sort_values(["vehicle_id", "time"])
            traj_csv = filename.replace(".png", "_trajectories.csv")
            traj_path = os.path.join(output_folder, traj_csv)
            traj_df.to_csv(traj_path, index=False)
            print(f"✅ 차량 궤적 CSV 저장 완료: {traj_path}")