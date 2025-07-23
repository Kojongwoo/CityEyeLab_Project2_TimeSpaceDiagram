import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import os

# 한글 폰트 설정
plt.rcParams['font.family'] = 'Malgun Gothic'

# 엑셀 파일 불러오기
file_path = "./intersection_info.xlsx"
df = pd.read_excel(file_path)

# 컬럼명 지정
order_col = "order_num"

# 전처리
df["speed_mps"] = df["speed_limit_kph"] / 3.6
df["green_start_time"] = df["offset_sec"] + df["green_start_sec"]
df["green_end_time"] = df["green_start_time"] + df["green_duration_sec"]

# 저장 폴더 생성
output_folder = "시공도_결과_녹색만"
os.makedirs(output_folder, exist_ok=True)

# ✅ 시공도 생성 함수
def draw_time_space_diagram(direction, filename, sa_num=None, end_time=1800):
    # 방향 필터링
    filtered = df[df["direction"] == direction].copy()

    # SA 그룹 필터링 (선택적)
    if sa_num is not None:
        filtered = filtered[filtered["SA_num"] == sa_num]

    if filtered.empty:
        print(f"❗ [{direction}] 방향, SA_num={sa_num} 교차로 없음")
        return

    # ✅ 전체 order_num 기준 정렬 후 거리 누적 (SA 구분 없이)
    filtered = filtered.sort_values(order_col)
    filtered["cumulative_distance"] = filtered["distance_from_prev_meter"].cumsum().fillna(0)

    # 교차로 정보 정리
    intersections = (
        filtered[["intersection_name", "cumulative_distance", "distance_from_prev_meter"]]
        .drop_duplicates()
        .sort_values("cumulative_distance")
        .reset_index(drop=True)
    )

    # Y축 라벨 구성
    y_ticks = []
    y_labels = []

    for i in range(len(intersections)):
        name = intersections.loc[i, "intersection_name"]
        y = intersections.loc[i, "cumulative_distance"]
        y_ticks.append(y)
        y_labels.append(name)

        # 교차로 간 거리 라벨 추가
        if i < len(intersections) - 1:
            next_y = intersections.loc[i + 1, "cumulative_distance"]
            dist = int(next_y - y)
            if dist > 0:
                mid_y = (y + next_y) / 2
                y_ticks.append(mid_y)
                y_labels.append(f"↕ {dist}m")

    # 그래프 생성
    plt.figure(figsize=(15, 15))

    # ✅ 녹색 신호 반복 표시
    for _, row in filtered.iterrows():
        cycle = row["cycle_length_sec"]
        offset = row["offset_sec"]
        green_start = row["green_start_sec"]
        green_dur = row["green_duration_sec"]
        y = row["cumulative_distance"]

        for t in range(-cycle, end_time + cycle, cycle):
            start = t + offset + green_start
            end = start + green_dur
            if end <= 0 or start >= end_time:
                continue
            plt.hlines(y=y, xmin=max(0, start), xmax=min(end_time, end),
                       color='green', linewidth=2)

    # X축 설정
    plt.xlim(0, end_time)

    # Y축 범위 (거리 기준, 방향 무관)
    plt.ylim(filtered["cumulative_distance"].min() - 20,
             filtered["cumulative_distance"].max() + 20)

    # 축 및 제목
    plt.xlabel("시간 (초)")
    plt.ylabel("거리 기준 교차로 위치 (m)")
    title = f"시공도 (방향: {direction}"
    if sa_num is not None:
        title += f", SA_num={sa_num}"
    title += f", 0~{end_time}초)"
    plt.title(title)

    plt.grid(False)
    plt.yticks(ticks=y_ticks, labels=y_labels)
    plt.tight_layout()

    # 저장
    full_path = os.path.join(output_folder, filename)
    plt.savefig(full_path, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"✅ 저장 완료: {full_path}")

# ✅ 실행 예시
draw_time_space_diagram("서동", "시공도_서동_전체_녹색만.png", end_time=250)
draw_time_space_diagram("동서", "시공도_동서_전체_녹색만.png", end_time=250)
draw_time_space_diagram("서동", "시공도_서동_SA26_녹색만.png", sa_num=26, end_time=250)
draw_time_space_diagram("동서", "시공도_동서_SA26_녹색만.png", sa_num=26, end_time=250)
