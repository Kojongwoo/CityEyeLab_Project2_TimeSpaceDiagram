# 1. 베이스 이미지 선택 (가벼운 파이썬 3.9 이미지)
FROM python:3.10-slim

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 요구사항 파일 복사 및 설치 (코드보다 먼저 설치하여 캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 프로젝트 전체 파일 복사
COPY . .

# 5. 컨테이너 실행 시 Gunicorn 서버 구동
# 0.0.0.0:8000 주소로 요청을 받고, app.py 파일 안에 있는 app 객체를 실행
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "app:app"]