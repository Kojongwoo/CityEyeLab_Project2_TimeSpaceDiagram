import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import os

plt.rcParams["font.family"] = "Malgun Gothic"

# file_path = "./intersection_info.csv"
# df = pd.read_excel(file_path)
df = None
order_col = "order_num"

# output_folder = "static/output"
output_folder = os.path.join("Web", "static", "output")
os.makedirs(output_folder, exist_ok=True)


def draw_time_space_diagram(direction, filename, sa_num=None, end_time=1800, with_trajectory=True):
    global df

    df["speed_mps"] = df["speed_limit_kph"] / 3.6
    df["green_start_time"] = df["offset_sec"] + df["green_start_sec"]
    df["green_end_time"] = df["green_start_time"] + df["green_duration_sec"]
    # 전체 경로 기반 궤적 계산용
    filtered_all = df[df["direction"] == direction].copy()
    filtered_all = filtered_all.sort_values(order_col)
    filtered_all["cumulative_distance"] = filtered_all["distance_from_prev_meter"].cumsum().fillna(0)

    # sa_num 필터
    if sa_num is not None:
        sa_range = 2
        sa_min, sa_max = sa_num - sa_range, sa_num + sa_range
        filtered = filtered_all[(filtered_all["SA_num"] >= sa_min) & (filtered_all["SA_num"] <= sa_max)].copy()
    else:
        filtered = filtered_all.copy()

    if filtered.empty:
        print(f"❗ [{direction}] 방향, SA_num={sa_num} 교차로 없음")
        return

    # filtered = filtered.sort_values(order_col)
    filtered["cumulative_distance"] = filtered["distance_from_prev_meter"].cumsum().fillna(0)

    intersections = (
        filtered[["intersection_name", "cumulative_distance", "distance_from_prev_meter"]]
        .drop_duplicates()
        .sort_values("cumulative_distance")
        .reset_index(drop=True)
    )

    y_ticks, y_labels = [], []
    for i in range(len(intersections)):
        name = intersections.loc[i, "intersection_name"]
        y = intersections.loc[i, "cumulative_distance"]
        y_ticks.append(y)
        y_labels.append(name)
        if i < len(intersections) - 1:
            next_y = intersections.loc[i + 1, "cumulative_distance"]
            dist = int(next_y - y)
            if dist > 0:
                mid_y = (y + next_y) / 2
                y_ticks.append(mid_y)
                y_labels.append(f"↕ {dist}m")

    plt.figure(figsize=(15, 15))

    # ✅ 녹색 신호 반복 표시 + green_windows 저장용
    green_windows_data = []
    for _, row in filtered_all.iterrows():
        cycle = row["cycle_length_sec"]
        offset = row["offset_sec"]
        green_start = row["green_start_sec"]
        green_dur = row["green_duration_sec"]
        y = row["cumulative_distance"]
        intersec = row["intersection_name"]
        sa = row["SA_num"]
        dirc = row["direction"]

        for t in range(-2 * cycle, end_time + 2 * cycle, cycle):
            start = t + offset + green_start
            end = start + green_dur
            if end <= 0 or start >= end_time:
                continue
            plt.hlines(y=y, xmin=max(0, start), xmax=min(end_time, end), color="green", linewidth=2)
            green_windows_data.append(
                {
                    "intersection_name": intersec,
                    "direction": dirc,
                    "SA_num": sa,
                    # "green_start_time": max(0, start),
                    # "green_end_time": min(end_time, end),
                    "green_start_time": start,
                    "green_end_time": end,
                    "cycle": cycle,
                    "cumulative_distance": y
                }
            )

    # ✅ CSV 저장
    green_df = pd.DataFrame(green_windows_data)
    csv_name = filename.replace(".png", "_green_windows.csv")
    csv_path = os.path.join(output_folder, csv_name)
    green_df.to_csv(csv_path, index=False)
    print(f"✅ 녹색 시간대 CSV 저장 완료: {csv_path}")

    # ✅ 궤적 생성
    trajectories = []

    for veh_id in range(1, end_time + 1, 53):
        t = veh_id
        log = []
        curr_pos = filtered_all.iloc[0]["cumulative_distance"]

        for _, row in filtered_all.iterrows():
            dist = row["distance_from_prev_meter"]
            if dist <= 0:
                continue
            intersec = row["intersection_name"]
            speed = row["speed_limit_kph"] / 3.6
            next_pos = row["cumulative_distance"]
            travel_time = dist / speed
            arrival = t + travel_time

            # 이동 구간 기록은 신호 상태와 무관하게 먼저 저장한다.
            log.append((t, curr_pos, arrival, next_pos, intersec))
            t = arrival
            curr_pos = next_pos

            green_ok = green_df[
                (green_df["intersection_name"] == intersec)
                & (green_df["green_start_time"] <= arrival + 1e-3)
                & (green_df["green_end_time"] >= arrival - 1e-3)
            ]

            # if not green_ok.empty:
            #     # 이동
            #     log.append((t, curr_pos, arrival, next_pos, intersec))
            #     t = arrival
            #     curr_pos = next_pos
            # else:
            if green_ok.empty:  
                future_green = green_df[
                    (green_df["intersection_name"] == intersec) & (green_df["green_start_time"] >= arrival - 5)
                ].sort_values("green_start_time")

                if future_green.empty:
                    break

                wait_start = arrival
                wait_end = future_green.iloc[0]["green_start_time"]

                # ✅ 수평선 구간: 대기
                for sec in range(int(wait_start), int(wait_end) + 1):
                    trajectories.append(
                        {
                            "vehicle_id": veh_id,
                            "time": sec,
                            "position": round(next_pos, 2),
                            "speed": 0,
                            "intersection": intersec,
                        }
                    )

                # 통과 후 현재 시간 갱신
                t = wait_end
                # curr_pos = next_pos

        # ✅ 이동 구간 보간
        for t0, p0, t1, p1, intersec in log:
            total_time = max(1, t1 - t0)
            for sec in range(int(t0), int(t1) + 1):
                frac = (sec - t0) / total_time
                pos = p0 + (p1 - p0) * frac
                trajectories.append(
                    {
                        "vehicle_id": veh_id,
                        "time": sec,
                        "position": round(pos, 2),
                        "speed": round((pos - p0) / total_time, 2),
                        "intersection": intersec,
                    }
                )

    # ✅ CSV 저장
    traj_df = pd.DataFrame(trajectories)
    traj_df = traj_df.sort_values(["vehicle_id", "time"])
    traj_csv = filename.replace(".png", "_trajectories.csv")
    traj_path = os.path.join(output_folder, traj_csv)
    traj_df.to_csv(traj_path, index=False)
    print(f"✅ 차량 궤적 CSV 저장 완료: {traj_path}")

    # ✅ 시공도 위에 궤적 선(line)으로 시각화
    visible_positions = filtered["cumulative_distance"].values
    margin = 10

    visible_min = filtered["cumulative_distance"].min() - 5
    visible_max = filtered["cumulative_distance"].max() + 5

    for vehicle_id, group in traj_df.groupby("vehicle_id"):
        group = group.sort_values("time")
        plt.plot(
            group["time"],
            group["position"],
            linewidth=1,
            alpha=0.6,
            # ✅ 밖에 나간 구간은 안 보이게 처리
            solid_capstyle="round",
            clip_on=True,
        )

    # 기본 설정
    plt.xlim(0, end_time + 10)
    plt.ylim(visible_min, visible_max)
    plt.xlabel("시간 (초)")
    plt.ylabel("거리 기준 교차로 위치 (m)")
    title = f"시공도 + 궤적 (방향: {direction}"
    # 시각화용 교차로 필터
    if sa_num is not None:
        # ✅ SA_num 전후 여유 범위 확보 (±2)
        sa_range = 2
        sa_min, sa_max = sa_num - sa_range, sa_num + sa_range
        filtered = filtered_all[(filtered_all["SA_num"] >= sa_min) & (filtered_all["SA_num"] <= sa_max)].copy()
    else:
        filtered = filtered_all.copy()
    title += f", SA_num={sa_num}"
    title += f", 0~{end_time}초)"
    plt.title(title)
    plt.grid(False)
    plt.yticks(ticks=y_ticks, labels=y_labels)
    plt.tight_layout()

    full_path = os.path.join(output_folder, filename)
    plt.savefig(full_path, dpi=300, bbox_inches="tight")
    plt.close()
    print(f"✅ 시공도 + 궤적 저장 완료: {full_path}")

# ✅ 실행 예시
# draw_time_space_diagram("서동", "시공도_서동_전체_tra.png", end_time=3600)
# draw_time_space_diagram("동서", "시공도_동서_전체_tra.png", end_time=3600)
# draw_time_space_diagram("서동", "시공도_서동_SA26_tra.png", sa_num=26, end_time=400)
# draw_time_space_diagram("동서", "시공도_동서_SA26_tra.png", sa_num=26, end_time=400)